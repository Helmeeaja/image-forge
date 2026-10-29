#!/usr/bin/env python3
"""Image Forge — CLI upscale & konversi gambar.

Contoh:
  python3 forge.py foto.jpg -s 2 -f webp
  python3 forge.py *.png -s 4 -f jpeg -q 90 -o hasil
  python3 forge.py folder/ -r -w 3000 -f avif
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import forge_core as core

INPUT_EXTS = {
    ".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff",
    ".ico", ".avif", ".heic", ".heif", ".ppm", ".pgm", ".pnm", ".tga",
}


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def collect(inputs: list[str], recursive: bool) -> list[Path]:
    found: list[Path] = []
    for raw in inputs:
        p = Path(raw).expanduser()
        if p.is_dir():
            pattern = "**/*" if recursive else "*"
            found += sorted(
                f for f in p.glob(pattern)
                if f.is_file() and f.suffix.lower() in INPUT_EXTS
            )
        elif p.is_file():
            found.append(p)
        else:
            print(f"! Tidak ditemukan: {raw}", file=sys.stderr)
    # buang duplikat, pertahankan urutan
    seen: set[Path] = set()
    unique = []
    for f in found:
        key = f.resolve()
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="forge",
        description="Upscale resolusi & konversi format gambar (lokal, tanpa upload).",
    )
    parser.add_argument("inputs", nargs="+", help="File gambar atau folder.")
    parser.add_argument("-o", "--out", default="output", help="Folder hasil (default: output).")
    parser.add_argument("-s", "--scale", type=float, default=2, help="Faktor perbesaran (default: 2).")
    parser.add_argument("-w", "--width", type=int, help="Lebar hasil dalam piksel (menimpa skala).")
    parser.add_argument("--height", type=int, help="Tinggi hasil dalam piksel.")
    parser.add_argument(
        "-f", "--format", default="auto",
        choices=["auto", *core.FORMATS],
        help="Format output (default: auto = ikuti format asli).",
    )
    parser.add_argument("-q", "--quality", type=int, default=92, help="Kualitas 1-100 (JPEG/WebP/AVIF).")
    parser.add_argument("--sharpen", type=int, default=35, help="Ketajaman 0-250 (default: 35).")
    parser.add_argument(
        "--method", default="lanczos",
        choices=["lanczos", "bicubic", "bilinear", "nearest"],
        help="Metode resize (default: lanczos).",
    )
    parser.add_argument("--bg", default="#ffffff", help="Warna latar untuk transparansi (default: #ffffff).")
    parser.add_argument("--strip", action="store_true", help="Hapus metadata EXIF/ICC.")
    parser.add_argument("-r", "--recursive", action="store_true", help="Telusuri folder secara rekursif.")
    args = parser.parse_args(argv)

    files = collect(args.inputs, args.recursive)
    if not files:
        print("Tidak ada gambar yang bisa diproses.", file=sys.stderr)
        return 1

    opts = core.Options(
        scale=args.scale,
        width=args.width,
        height=args.height,
        method=args.method,
        sharpen=args.sharpen,
        format=args.format,
        quality=args.quality,
        background=args.bg,
        keep_metadata=not args.strip,
    )

    out_dir = Path(args.out).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n  Image Forge · {len(files)} gambar · {opts.method} · output {out_dir}\n")

    t0 = time.perf_counter()
    ok = fail = 0
    total_bytes = 0
    for i, src in enumerate(files, 1):
        prefix = f"[{i}/{len(files)}]"
        try:
            res = core.process_image(src, out_dir, opts)
            total_bytes += res["bytes"]
            ok += 1
            print(
                f"  {prefix} ✓ {src.name} → {res['outName']}  "
                f"{res['width']}×{res['height']} · {human_size(res['bytes'])} · {res['elapsed']}s"
            )
        except Exception as exc:  # noqa: BLE001 - CLI harus tetap lanjut
            fail += 1
            print(f"  {prefix} ✗ {src.name}: {exc}", file=sys.stderr)

    elapsed = time.perf_counter() - t0
    print(f"\n  Selesai: {ok} berhasil, {fail} gagal · {human_size(total_bytes)} · {elapsed:.1f}s\n")
    return 0 if fail == 0 else (1 if ok == 0 else 0)


if __name__ == "__main__":
    raise SystemExit(main())
