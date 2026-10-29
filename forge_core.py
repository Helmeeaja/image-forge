"""Image Forge — mesin upscale & konversi gambar.

Semua proses berjalan lokal. Tidak ada upload ke internet.
"""
from __future__ import annotations

import base64
import io
import os
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageColor, ImageFilter, ImageOps, UnidentifiedImageError

# --------------------------------------------------------------------------
# Format & plugin opsional
# --------------------------------------------------------------------------
HEIF = False
AVIF = "AVIF" in Image.SAVE

try:  # HEIC/HEIF
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF = True
except Exception:  # pragma: no cover - plugin tidak wajib
    pass

try:  # AVIF
    import pillow_avif  # noqa: F401

    AVIF = True
except Exception:  # pragma: no cover
    pass

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    try:
        from PIL import features

        AVIF = AVIF or bool(features.check("avif"))
    except Exception:
        pass

# Batas aman supaya tidak menghabiskan RAM (bisa dioverride lewat env).
Image.MAX_IMAGE_PIXELS = int(os.environ.get("IMAGE_FORGE_MAX_INPUT_PIXELS", "300000000"))
MAX_PIXELS = int(os.environ.get("IMAGE_FORGE_MAX_PIXELS", "64000000"))

FORMATS: dict[str, dict[str, Any]] = {
    "jpeg": {"label": "JPEG", "ext": ".jpg", "mime": "image/jpeg", "quality": True, "alpha": False},
    "png": {"label": "PNG", "ext": ".png", "mime": "image/png", "quality": False, "alpha": True},
    "webp": {"label": "WebP", "ext": ".webp", "mime": "image/webp", "quality": True, "alpha": True},
    "avif": {"label": "AVIF", "ext": ".avif", "mime": "image/avif", "quality": True, "alpha": True},
    "tiff": {"label": "TIFF", "ext": ".tiff", "mime": "image/tiff", "quality": False, "alpha": True},
    "bmp": {"label": "BMP", "ext": ".bmp", "mime": "image/bmp", "quality": False, "alpha": False},
    "gif": {"label": "GIF", "ext": ".gif", "mime": "image/gif", "quality": False, "alpha": False},
    "ico": {"label": "ICO", "ext": ".ico", "mime": "image/x-icon", "quality": False, "alpha": True},
}

SRC_FORMAT_MAP = {
    "JPEG": "jpeg",
    "JPG": "jpeg",
    "PNG": "png",
    "WEBP": "webp",
    "GIF": "gif",
    "BMP": "bmp",
    "TIFF": "tiff",
    "ICO": "ico",
    "AVIF": "avif",
    "HEIF": "jpeg",
    "HEIC": "jpeg",
}

RESAMPLE = {
    "lanczos": Image.Resampling.LANCZOS,
    "bicubic": Image.Resampling.BICUBIC,
    "bilinear": Image.Resampling.BILINEAR,
    "nearest": Image.Resampling.NEAREST,
}


def available_formats() -> dict[str, dict[str, Any]]:
    out = {}
    for key, meta in FORMATS.items():
        if key == "avif" and not AVIF:
            continue
        out[key] = dict(meta)
    return out


# --------------------------------------------------------------------------
# Opsi
# --------------------------------------------------------------------------
@dataclass
class Options:
    scale: float = 2.0
    width: int | None = None
    height: int | None = None
    method: str = "lanczos"
    sharpen: int = 35
    format: str = "auto"
    quality: int = 92
    background: str = "#ffffff"
    keep_metadata: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "Options":
        data = data or {}
        opt = cls()

        def num(value: Any, fallback: float) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return fallback

        scale = num(data.get("scale", 2), 2)
        opt.scale = min(max(scale, 0.05), 16)
        for key in ("width", "height"):
            val = data.get(key)
            try:
                val = int(val) if val not in (None, "", 0, "0") else None
            except (TypeError, ValueError):
                val = None
            if val is not None:
                val = min(max(val, 8), 20000)
            setattr(opt, key, val)
        method = str(data.get("method", "lanczos")).lower()
        opt.method = method if method in RESAMPLE else "lanczos"
        opt.sharpen = int(min(max(num(data.get("sharpen", 35), 35), 0), 250))
        fmt = str(data.get("format", "auto")).lower()
        opt.format = fmt if fmt == "auto" or fmt in FORMATS else "auto"
        opt.quality = int(min(max(num(data.get("quality", 92), 92), 1), 100))
        bg = str(data.get("background") or "#ffffff")
        try:
            ImageColor.getrgb(bg)
        except ValueError:
            bg = "#ffffff"
        opt.background = bg
        opt.keep_metadata = bool(data.get("keep_metadata", True))
        return opt


# --------------------------------------------------------------------------
# Load & simpan
# --------------------------------------------------------------------------
def open_image(path: str | os.PathLike[str]) -> tuple[Image.Image, str]:
    """Buka gambar, perbaiki orientasi EXIF, normalisasi mode warna."""
    try:
        im = Image.open(path)
        if getattr(im, "n_frames", 1) > 1:
            im.seek(0)  # frame pertama untuk GIF/WebP animasi
        im.load()
        src_format = (im.format or "").upper()
        im = ImageOps.exif_transpose(im)
    except UnidentifiedImageError as exc:
        raise ValueError("Format gambar tidak dikenali.") from exc

    if im.mode in ("P", "PA"):
        im = im.convert("RGBA")
    elif im.mode == "LA":
        im = im.convert("RGBA")
    elif im.mode == "CMYK":
        im = im.convert("RGB")
    elif im.mode == "1":
        im = im.convert("L")
    elif im.mode == "RGBa":
        im = im.convert("RGBA")
    return im, src_format


def _flatten(im: Image.Image, background: str) -> Image.Image:
    """Ratakan transparansi ke warna latar (untuk JPEG/BMP/GIF)."""
    if im.mode == "RGB":
        return im
    if im.mode in ("RGBA", "LA", "P", "PA"):
        rgba = im.convert("RGBA")
        base = Image.new("RGB", rgba.size, ImageColor.getrgb(background))
        base.paste(rgba, mask=rgba.getchannel("A"))
        return base
    return im.convert("RGB")


def _save(im: Image.Image, path: Path, fmt: str, opts: Options, meta: dict[str, Any]) -> None:
    if fmt == "avif" and not AVIF:
        raise ValueError("AVIF belum didukung. Jalankan: .venv/bin/pip install pillow-avif-plugin")

    kwargs: dict[str, Any] = {}
    if opts.keep_metadata:
        if meta.get("exif"):
            kwargs["exif"] = meta["exif"]
        if meta.get("icc"):
            kwargs["icc_profile"] = meta["icc"]
        if meta.get("dpi"):
            kwargs["dpi"] = meta["dpi"]

    def do_save(image: Image.Image, **extra: Any) -> None:
        merged = {**kwargs, **extra}
        try:
            image.save(path, **merged)
        except (OSError, ValueError, TypeError):
            # Metadata kadang tidak kompatibel dengan format tujuan.
            clean = {k: v for k, v in merged.items() if k not in ("exif", "icc_profile", "dpi")}
            if image.mode == "P":
                image = image.convert("RGBA")
            image.save(path, **clean)

    quality = int(opts.quality)
    if fmt == "jpeg":
        do_save(_flatten(im, opts.background), format="JPEG", quality=quality,
                optimize=True, progressive=True, **({"subsampling": 0} if quality >= 90 else {}))
    elif fmt == "png":
        do_save(im, format="PNG", compress_level=6)
    elif fmt == "webp":
        if quality >= 100:
            do_save(im, format="WEBP", lossless=True, quality=100, method=4)
        else:
            do_save(im, format="WEBP", quality=quality, method=4)
    elif fmt == "avif":
        do_save(im, format="AVIF", quality=quality)
    elif fmt == "tiff":
        do_save(im, format="TIFF", compression="tiff_deflate")
    elif fmt == "bmp":
        do_save(_flatten(im, opts.background), format="BMP")
    elif fmt == "gif":
        pal = _flatten(im, opts.background).convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
        pal.save(path, format="GIF", optimize=True)
    elif fmt == "ico":
        do_save(im, format="ICO")
    else:  # pragma: no cover
        raise ValueError(f"Format output tidak dikenal: {fmt}")


# --------------------------------------------------------------------------
# Proses utama
# --------------------------------------------------------------------------
def resolve_format(fmt: str, src_format: str) -> str:
    if fmt != "auto":
        return fmt
    resolved = SRC_FORMAT_MAP.get(src_format, "png")
    if resolved == "avif" and not AVIF:
        return "jpeg"
    return resolved


def target_size(width: int, height: int, opts: Options) -> tuple[int, int]:
    if opts.width and opts.height:
        ratio = min(opts.width / width, opts.height / height)
        return max(1, round(width * ratio)), max(1, round(height * ratio))
    if opts.width:
        return opts.width, max(1, round(height * opts.width / width))
    if opts.height:
        return max(1, round(width * opts.height / height)), opts.height
    return max(1, round(width * opts.scale)), max(1, round(height * opts.scale))


def make_thumb(im: Image.Image, max_side: int = 1100, quality: int = 82) -> str:
    thumb = im.copy()
    thumb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    if thumb.mode in ("RGB", "RGBA"):
        pass
    elif thumb.mode in ("L", "I", "I;16", "F"):
        thumb = thumb.convert("RGB")
    else:
        thumb = thumb.convert("RGBA")
    buf = io.BytesIO()
    thumb.save(buf, "WEBP", quality=quality, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _unique_path(directory: Path, base: str, ext: str) -> Path:
    path = directory / f"{base}{ext}"
    i = 2
    while path.exists():
        path = directory / f"{base}-{i}{ext}"
        i += 1
    return path


def _fmt_scale(scale: float) -> str:
    return f"{scale:g}"


def process_image(
    src: str | os.PathLike[str],
    out_dir: str | os.PathLike[str],
    opts: Options,
    want_thumbs: bool = False,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    src = Path(src)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    im, src_format = open_image(src)
    orig_w, orig_h = im.size
    meta = {
        "exif": im.info.get("exif"),
        "icc": im.info.get("icc_profile"),
        "dpi": im.info.get("dpi"),
    }

    orig_thumb = make_thumb(im) if want_thumbs else None

    fmt = resolve_format(opts.format, src_format)
    if fmt not in FORMATS:
        raise ValueError(f"Format output tidak dikenal: {fmt}")
    if fmt == "avif" and not AVIF:
        raise ValueError("AVIF belum didukung di mesin ini.")

    tw, th = target_size(orig_w, orig_h, opts)
    if fmt == "ico" and max(tw, th) > 256:
        ratio = 256 / max(tw, th)
        tw, th = max(1, int(tw * ratio)), max(1, int(th * ratio))
    if tw * th > MAX_PIXELS:
        raise ValueError(
            f"Hasil akan {tw}×{th}px ({tw * th / 1_000_000:.0f} MP), "
            f"melebihi batas aman {MAX_PIXELS / 1_000_000:.0f} MP. "
            "Kurangi skala atau lebar."
        )

    resample = RESAMPLE.get(opts.method, Image.Resampling.LANCZOS)
    if (tw, th) != (orig_w, orig_h):
        im = im.resize((tw, th), resample)

    if opts.sharpen > 0:
        try:
            im = im.filter(
                ImageFilter.UnsharpMask(radius=1.4, percent=int(opts.sharpen), threshold=2)
            )
        except Exception:
            pass

    suffix = f"-{tw}px" if (opts.width or opts.height) else f"-{_fmt_scale(opts.scale)}x"
    out_path = _unique_path(out_dir, f"{src.stem}{suffix}", FORMATS[fmt]["ext"])
    _save(im, out_path, fmt, opts, meta)

    thumb_src = im if FORMATS[fmt]["alpha"] else _flatten(im, opts.background)
    result = {
        "src": str(src),
        "out": str(out_path),
        "outName": out_path.name,
        "format": fmt,
        "mime": FORMATS[fmt]["mime"],
        "width": im.width,
        "height": im.height,
        "origWidth": orig_w,
        "origHeight": orig_h,
        "bytes": out_path.stat().st_size,
        "elapsed": round(time.perf_counter() - t0, 2),
        "thumb": make_thumb(thumb_src) if want_thumbs else None,
        "origThumb": orig_thumb,
    }
    return result
