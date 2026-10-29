#!/usr/bin/env python3
"""Image Forge — server lokal (stdlib only).

Menjalankan UI web di 127.0.0.1 dan memproses gambar dengan forge_core.
Tidak ada koneksi keluar; file tidak pernah diupload ke internet.
"""
from __future__ import annotations

import base64
import binascii
import json
import mimetypes
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

import forge_core as core

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "image-forge"
OUT_ROOT = CACHE / "out"
TMP_ROOT = CACHE / "tmp"
MAX_BODY = int(os.environ.get("IMAGE_FORGE_MAX_BODY", str(160 * 1024 * 1024)))
MAX_FILE = int(os.environ.get("IMAGE_FORGE_MAX_FILE", str(60 * 1024 * 1024)))
RETENTION = 12 * 3600

STORE: dict[str, dict[str, str]] = {}
STORE_LOCK = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}


def cleanup_old() -> None:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    TMP_ROOT.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - RETENTION
    for root in (OUT_ROOT, TMP_ROOT):
        for entry in root.iterdir():
            try:
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
            except OSError:
                pass
    with STORE_LOCK:
        for key, item in list(STORE.items()):
            if not Path(item["path"]).exists():
                STORE.pop(key, None)


def safe_stem(name: str) -> str:
    stem = Path(name).stem or "image"
    stem = re.sub(r"[^\w\s.-]", "", stem, flags=re.UNICODE).strip(" ._-")
    stem = re.sub(r"\s+", " ", stem)[:60].strip()
    return stem or "image"


class Handler(BaseHTTPRequestHandler):
    server_version = "ImageForge/1.0"
    protocol_version = "HTTP/1.1"

    # ---------------------------------------------------------------- utils
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        if "/api/" in (self.path or ""):
            sys.stderr.write("  %s\n" % (fmt % args))

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message: str, status: int = 400) -> None:
        self._send_json({"error": message}, status)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            raise ValueError("Body kosong.")
        if length > MAX_BODY:
            raise ValueError("File terlalu besar untuk satu proses (maks 160 MB).")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("JSON tidak valid.") from exc

    # ---------------------------------------------------------------- GET
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            formats = [
                {"key": key, **meta}
                for key, meta in core.available_formats().items()
            ]
            self._send_json({
                "ok": True,
                "formats": formats,
                "heif": core.HEIF,
                "avif": core.AVIF,
                "maxPixels": core.MAX_PIXELS,
            })
            return

        if path.startswith("/api/file/"):
            self._serve_output(path.rsplit("/", 1)[-1], download=True)
            return

        if path == "/api/zip" or path.startswith("/api/zip"):
            self._error("Gunakan POST /api/zip.", HTTPStatus.METHOD_NOT_ALLOWED)
            return

        if path == "/":
            path = "/index.html"
        self._serve_static(path)

    def _serve_output(self, file_id: str, download: bool = False) -> None:
        if not re.fullmatch(r"[0-9a-f]{32}", file_id):
            self._error("ID tidak valid.", HTTPStatus.BAD_REQUEST)
            return
        with STORE_LOCK:
            item = STORE.get(file_id)
        if not item:
            self._error("File sudah kedaluwarsa. Proses ulang gambar.", HTTPStatus.NOT_FOUND)
            return
        file_path = Path(item["path"])
        if not file_path.is_file():
            self._error("File tidak ditemukan.", HTTPStatus.NOT_FOUND)
            return

        size = file_path.stat().st_size
        name = item["name"]
        self.send_response(200)
        self.send_header("Content-Type", item["mime"])
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if download:
            ascii_name = name.encode("ascii", "ignore").decode() or "image"
            self.send_header(
                "Content-Disposition",
                f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}",
            )
        self.end_headers()
        with file_path.open("rb") as fh:
            shutil.copyfileobj(fh, self.wfile, 1024 * 256)

    def _serve_static(self, path: str) -> None:
        rel = path.lstrip("/")
        target = (WEB / rel).resolve()
        try:
            target.relative_to(WEB.resolve())
        except ValueError:
            self._error("Tidak diizinkan.", HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self._error("Tidak ditemukan.", HTTPStatus.NOT_FOUND)
            return
        data = target.read_bytes()
        mime = MIME.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; font-src 'self' data:; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'",
        )
        self.end_headers()
        self.wfile.write(data)

    # ---------------------------------------------------------------- POST
    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/process":
            self._handle_process()
        elif parsed.path == "/api/zip":
            self._handle_zip()
        elif parsed.path == "/api/save":
            self._handle_save()
        else:
            self._error("Endpoint tidak ditemukan.", HTTPStatus.NOT_FOUND)

    def _handle_process(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._error(str(exc))
            return

        files = payload.get("files")
        if not isinstance(files, list) or not files:
            self._error("Tidak ada file yang dikirim.")
            return
        if len(files) > 60:
            self._error("Maksimal 60 gambar per batch.")
            return

        opts = core.Options.from_dict(payload.get("options") or {})

        session = uuid.uuid4().hex
        session_dir = OUT_ROOT / session
        in_dir = TMP_ROOT / session
        in_dir.mkdir(parents=True, exist_ok=True)
        results: list[dict] = []
        t_start = time.perf_counter()

        try:
            for idx, item in enumerate(files):
                name = str(item.get("name") or f"image-{idx + 1}")
                raw = item.get("data") or ""
                if not isinstance(raw, str) or not raw:
                    results.append({"name": name, "error": "Data file kosong."})
                    continue
                if raw.startswith("data:"):
                    raw = raw.split(",", 1)[-1]
                try:
                    blob = base64.b64decode(raw, validate=False)
                except (binascii.Error, ValueError):
                    results.append({"name": name, "error": "Data base64 tidak valid."})
                    continue
                if len(blob) > MAX_FILE:
                    results.append({"name": name, "error": "File melebihi 60 MB."})
                    continue
                if not blob:
                    results.append({"name": name, "error": "File kosong."})
                    continue

                suffix = Path(name).suffix.lower() or ".img"
                if not re.fullmatch(r"\.[a-z0-9]{1,6}", suffix):
                    suffix = ".img"
                src_path = in_dir / f"{idx:03d}-{uuid.uuid4().hex[:8]}{suffix}"
                src_path.write_bytes(blob)
                try:
                    out_dir = session_dir
                    res = core.process_image(src_path, out_dir, opts, want_thumbs=True)
                except Exception as exc:  # noqa: BLE001 - laporkan per file
                    results.append({"name": name, "error": str(exc)})
                    continue

                file_id = uuid.uuid4().hex
                display_stem = safe_stem(name)
                out_path = Path(res["out"])
                generated_suffix = out_path.stem[len(src_path.stem):] if out_path.stem.startswith(src_path.stem) else ""
                final_name = f"{display_stem}{generated_suffix}{out_path.suffix}"
                final_path = out_path
                if out_path.name != final_name:
                    candidate = out_path.with_name(final_name)
                    i = 2
                    while candidate.exists():
                        candidate = out_path.with_name(f"{display_stem}{generated_suffix}-{i}{out_path.suffix}")
                        i += 1
                    out_path.rename(candidate)
                    final_path = candidate
                with STORE_LOCK:
                    STORE[file_id] = {
                        "path": str(final_path),
                        "name": final_path.name,
                        "mime": res["mime"],
                    }
                results.append({
                    "id": file_id,
                    "name": name,
                    "outName": final_path.name,
                    "width": res["width"],
                    "height": res["height"],
                    "origWidth": res["origWidth"],
                    "origHeight": res["origHeight"],
                    "bytes": final_path.stat().st_size,
                    "format": res["format"],
                    "mime": res["mime"],
                    "elapsed": res["elapsed"],
                    "thumb": res["thumb"],
                    "origThumb": res["origThumb"],
                })
        finally:
            shutil.rmtree(in_dir, ignore_errors=True)
            if session_dir.exists() and not any(session_dir.iterdir()):
                shutil.rmtree(session_dir, ignore_errors=True)

        ok = sum(1 for r in results if "error" not in r)
        self._send_json({
            "results": results,
            "ok": ok,
            "failed": len(results) - ok,
            "elapsed": round(time.perf_counter() - t_start, 2),
        })

    def _handle_save(self) -> None:
        """Salin hasil ke folder pilihan user (langsung di disk lokal)."""
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._error(str(exc))
            return

        ids = payload.get("ids")
        folder_raw = payload.get("folder")
        if not isinstance(ids, list) or not ids:
            self._error("Tidak ada file untuk disimpan.")
            return
        if not isinstance(folder_raw, str) or not folder_raw.strip():
            self._error("Folder tujuan belum diisi.")
            return
        if len(folder_raw) > 1000:
            self._error("Path folder terlalu panjang.")
            return

        folder = Path(folder_raw.strip()).expanduser()
        if not folder.is_absolute():
            folder = Path.home() / folder
        try:
            folder = folder.resolve()
            if folder.exists() and not folder.is_dir():
                self._error(f"{folder} bukan sebuah folder.")
                return
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self._error(f"Tidak bisa membuat folder: {exc}")
            return
        if not os.access(folder, os.W_OK):
            self._error(f"Folder {folder} tidak bisa ditulis.")
            return

        items = []
        with STORE_LOCK:
            for file_id in ids[:80]:
                item = STORE.get(str(file_id))
                if item and Path(item["path"]).is_file():
                    items.append(item)
        if not items:
            self._error("Semua file sudah kedaluwarsa. Proses ulang gambar.", HTTPStatus.NOT_FOUND)
            return

        saved: list[str] = []
        try:
            for item in items:
                name = Path(item["name"]).name
                target = folder / name
                stem, ext = os.path.splitext(name)
                i = 2
                while target.exists():
                    target = folder / f"{stem}-{i}{ext}"
                    i += 1
                shutil.copy2(item["path"], target)
                saved.append(str(target))
        except OSError as exc:
            self._error(f"Gagal menyimpan ke folder: {exc}")
            return

        shown = str(folder)
        try:
            home = str(Path.home())
            if shown == home or shown.startswith(home + os.sep):
                shown = "~" + shown[len(home):]
        except Exception:
            pass
        self._send_json({"ok": True, "count": len(saved), "folder": shown, "saved": saved})

    def _handle_zip(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._error(str(exc))
            return
        ids = payload.get("ids")
        if not isinstance(ids, list) or not ids:
            self._error("Tidak ada file untuk diunduh.")
            return

        items = []
        with STORE_LOCK:
            for file_id in ids[:80]:
                item = STORE.get(str(file_id))
                if item and Path(item["path"]).is_file():
                    items.append(item)
        if not items:
            self._error("Semua file sudah kedaluwarsa. Proses ulang gambar.", HTTPStatus.NOT_FOUND)
            return

        TMP_ROOT.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix="zip-", suffix=".zip", dir=TMP_ROOT)
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
                used: set[str] = set()
                for item in items:
                    name = item["name"]
                    if name in used:
                        stem, ext = os.path.splitext(name)
                        i = 2
                        while f"{stem}-{i}{ext}" in used:
                            i += 1
                        name = f"{stem}-{i}{ext}"
                    used.add(name)
                    zf.write(item["path"], arcname=name)
            size = tmp_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", 'attachment; filename="image-forge.zip"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with tmp_path.open("rb") as fh:
                shutil.copyfileobj(fh, self.wfile, 1024 * 256)
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def pick_port(host: str, preferred: int, tries: int = 20) -> ThreadingHTTPServer:
    last: Exception | None = None
    for port in range(preferred, preferred + tries):
        try:
            return ThreadingHTTPServer((host, port), Handler)
        except OSError as exc:
            last = exc
    raise SystemExit(f"Tidak bisa bind port {preferred}-{preferred + tries}: {last}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Image Forge — server lokal.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("IMAGE_FORGE_PORT", "8765")))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    cleanup_old()
    server = pick_port(args.host, args.port)
    port = server.server_address[1]
    url = f"http://{args.host}:{port}"

    print("\n  ┌─────────────────────────────────────────────┐")
    print("  │  IMAGE FORGE · upscale & convert · lokal    │")
    print(f"  │  {url:<43}│")
    print("  └─────────────────────────────────────────────┘")
    print(f"  Format    : {', '.join(core.available_formats())}")
    print("  Ctrl+C untuk berhenti.\n")

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Sampai jumpa.\n")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
