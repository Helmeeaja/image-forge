# Image Forge

Aplikasi lokal untuk **memperbesar resolusi gambar** (upscale) dan **mengonversi format** — batch, drag & drop, tanpa upload ke internet.

![lokal](https://img.shields.io/badge/100%25-lokal-c9f75a) ![python](https://img.shields.io/badge/python-3.10%2B-3776AB) ![tanpa GPU](https://img.shields.io/badge/tanpa-GPU-8d948a) ![tanpa framework](https://img.shields.io/badge/tanpa-framework-8d948a)

---

## Mulai cepat

```bash
git clone https://github.com/Helmeeaja/image-forge.git
cd image-forge

python3 -m venv --system-site-packages .venv
./.venv/bin/pip install pillow pillow-avif-plugin pillow-heif

./run.sh
```

Browser terbuka otomatis di **http://127.0.0.1:8765**. Kalau tidak terbuka, buka alamat itu manual.

Hentikan server dengan `Ctrl+C` di terminal.

---

## Fitur

- **Upscale 1×–4×** atau lebar/tinggi khusus (hingga 20.000 px).
- **Metode resize**: Lanczos (default), Bicubic, Bilinear, Nearest.
- **Konversi format**: JPEG, PNG, WebP, AVIF, TIFF, BMP, GIF, ICO — atau **Auto** mengikuti format asli.
- **Batch** sampai 60 gambar sekali proses, dengan progress dan estimasi hasil.
- **Tiga cara menyimpan hasil**:
  1. Unduh per gambar.
  2. Unduh semua sebagai ZIP.
  3. **Simpan ke folder** — ditulis langsung ke `~/Downloads`, `~/Pictures`, `~/Desktop`, atau path pilihanmu.
- **Perbandingan sebelum/sesudah** dengan slider di setiap hasil.
- **Transparansi** dipertahankan untuk format yang mendukung; warna latar bisa diatur untuk JPEG/BMP/GIF.
- **EXIF orientation** diperbaiki otomatis; metadata bisa dipertahankan atau dihapus.
- **CLI** untuk otomasi dan pemrosesan folder.
- Tanpa GPU, tanpa cloud, tanpa framework. Server hanya listen di `127.0.0.1`.

---

## Persyaratan

- **Python 3.10+**
- **Pillow** (mesin gambar)
- Opsional: `pillow-avif-plugin` dan `pillow-heif` untuk AVIF/HEIC

Virtualenv **tidak disertakan** di repo (`.venv/` masuk `.gitignore`). Buat sekali setelah clone:

```bash
python3 -m venv --system-site-packages .venv
./.venv/bin/pip install pillow pillow-avif-plugin pillow-heif
```

Kalau `pillow-avif-plugin` atau `pillow-heif` gagal dipasang, aplikasi tetap jalan — hanya format AVIF/HEIC yang tidak tersedia.

---

## Launcher `run.sh`

`run.sh` adalah script launcher yang menyiapkan cara menjalankan server, supaya tidak perlu mengingat path Python atau mengaktifkan virtualenv manual:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  PY="python3"
fi

exec "$PY" server.py "$@"
```

- Pindah ke folder tempat script berada → bisa dijalankan dari mana pun.
- Pakai `.venv/bin/python` kalau ada (agar plugin AVIF/HEIC terbaca), kalau tidak pakai `python3`.
- Semua argumen diteruskan ke `server.py` (mis. `./run.sh --port 9000`).

Setara dengan:

```bash
cd ~/image-forge
./.venv/bin/python server.py
```

Opsi server:

```bash
./run.sh --port 9000      # ganti port awal
./run.sh --no-browser     # jangan buka browser otomatis
./run.sh --host 0.0.0.0   # akses dari perangkat lain di jaringan (hati-hati)
```

Kalau port sudah dipakai, server otomatis mencoba port berikutnya (8765–8784) dan menampilkan alamat yang dipakai di terminal.

---

## Cara pakai (UI)

1. **Tarik gambar** ke area drop, atau klik untuk memilih file. Bisa juga menambah file ke batch yang sudah ada.
2. Atur **Perbesaran** (1×–4×) atau centang **Lebar khusus** lalu isi target px.
3. Pilih **Metode**, **Format output**, **Kualitas**, dan **Pertajam** sesuai kebutuhan.
4. Untuk PNG transparan yang dikonversi ke JPEG/BMP/GIF, atur **Latar transparansi**.
5. Klik **Proses gambar** dan tunggu progress selesai.
6. Di bagian **Hasil**, gunakan slider untuk membandingkan sebelum/sesudah, lalu simpan dengan salah satu dari tiga cara di bawah.

Pengaturan terakhir disimpan di `localStorage` browser, jadi tidak perlu diatur ulang setiap membuka aplikasi.

---

## Menyimpan hasil

Setelah proses selesai, di bagian **Hasil** ada tiga tombol:

| Cara | Perilaku |
| --- | --- |
| **Unduh** (tiap kartu) | Masuk ke folder download browser, lewat dialog/unduhan biasa. |
| **Unduh ZIP** | Semua hasil dibungkus satu arsip `image-forge.zip`. |
| **Simpan ke folder** | Server lokal menulis file langsung ke folder tujuan. Ada tombol cepat Downloads/Pictures/Desktop/Project. |

Default folder simpan: `~/Downloads/image-forge` (dibuat otomatis). Path mendukung `~` dan path absolut. **Nama file yang sudah ada tidak ditimpa** — Image Forge menambahkan akhiran `-2`, `-3`, dst.

Contoh nama hasil:

```
foto liburan.jpg        → foto liburan-2x.jpg
logo.png                → logo-640px.png
stiker alpha.png        → stiker alpha-2x.png
```

---

## CLI

```bash
cd ~/image-forge

# upscale 2x, simpan sebagai WebP
./.venv/bin/python forge.py foto.jpg -s 2 -f webp

# banyak file sekaligus + kualitas JPEG 90
./.venv/bin/python forge.py *.jpg -s 4 -f jpeg -q 90 -o hasil

# lebar tertentu, semua file dalam folder (rekursif)
./.venv/bin/python forge.py ~/Pictures -r -w 3000 -f avif -o hasil

# PNG transparan → JPEG dengan latar putih dan pertajam lebih agresif
./.venv/bin/python forge.py logo.png -f jpeg --sharpen 80 --bg "#ffffff"
```

| Opsi | Arti |
| --- | --- |
| `-o, --out` | Folder hasil (default `output`) |
| `-s, --scale` | Faktor perbesaran (default `2`) |
| `-w, --width` | Lebar hasil dalam px (menimpa skala) |
| `--height` | Tinggi hasil dalam px |
| `-f, --format` | `auto`, `jpeg`, `png`, `webp`, `avif`, `tiff`, `bmp`, `gif`, `ico` |
| `-q, --quality` | Kualitas 1–100 untuk JPEG/WebP/AVIF (default `92`) |
| `--sharpen` | Unsharp mask 0–250 (default `35`) |
| `--method` | `lanczos`, `bicubic`, `bilinear`, `nearest` |
| `--bg` | Warna latar untuk transparansi (default `#ffffff`) |
| `--strip` | Hapus metadata EXIF/ICC |
| `-r, --recursive` | Telusuri folder secara rekursif |

---

## Format yang didukung

**Input:** JPG/JPEG/JFIF, PNG, WebP, GIF, BMP, TIFF, ICO, AVIF, HEIC/HEIF.

**Output:** JPEG, PNG, WebP, AVIF, TIFF, BMP, GIF, ICO.

Catatan:

- **Auto** mempertahankan format asli. HEIC/HEIF otomatis menjadi JPEG karena browser tidak menampilkan HEIC.
- **GIF** hasil bersifat statis (satu frame). Animasi GIF/WebP/HEIC hanya diproses frame pertamanya.
- **ICO** dibatasi maksimal 256×256 px.
- **AVIF** hanya muncul kalau plugin `pillow-avif-plugin` terpasang.

---

## Konfigurasi (environment variable)

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `IMAGE_FORGE_PORT` | `8765` | Port awal server |
| `IMAGE_FORGE_MAX_PIXELS` | `64000000` | Batas piksel hasil (64 MP) |
| `IMAGE_FORGE_MAX_INPUT_PIXELS` | `300000000` | Batas piksel gambar input |
| `IMAGE_FORGE_MAX_FILE` | `62914560` | Ukuran maksimal per file (60 MB) |
| `IMAGE_FORGE_MAX_BODY` | `167772160` | Ukuran maksimal request (160 MB) |
| `XDG_CACHE_HOME` | `~/.cache` | Lokasi cache hasil sementara |

Contoh:

```bash
IMAGE_FORGE_MAX_PIXELS=120000000 ./run.sh
IMAGE_FORGE_PORT=9000 ./run.sh
```

---

## API lokal (opsional)

Server menyediakan API JSON sederhana di `127.0.0.1`. Berguna untuk otomasi dari script lain.

| Endpoint | Metode | Fungsi |
| --- | --- | --- |
| `/api/health` | GET | Status server, format tersedia, dukungan HEIF/AVIF |
| `/api/process` | POST | Proses batch gambar (JSON, data base64) |
| `/api/zip` | POST | Bungkus hasil terpilih menjadi ZIP |
| `/api/save` | POST | Salin hasil ke folder lokal |
| `/api/file/<id>` | GET | Unduh satu hasil |

Contoh payload `/api/process`:

```json
{
  "files": [{ "name": "foto.jpg", "data": "<base64>" }],
  "options": {
    "scale": 2,
    "format": "webp",
    "quality": 88,
    "sharpen": 35
  }
}
```

---

## Batasan

- Maksimal **60 file** dan **100 MB total** per batch di UI. Server menerima body hingga 160 MB dan 60 MB per file.
- Hasil dibatasi **64 MP** per gambar agar RAM tidak habis, terutama di mesin dengan RAM kecil. Bisa diubah lewat `IMAGE_FORGE_MAX_PIXELS`.
- GIF/WebP/HEIC animasi hanya diproses **frame pertama**.
- HEIC/AVIF butuh plugin `pillow-heif` / `pillow-avif-plugin` (lihat bagian Persyaratan).
- File hasil sementara disimpan di `~/.cache/image-forge` dan dibersihkan setelah **12 jam**.
- Thumbnail TIFF dan HEIC tidak bisa dibuat browser; kartu file menampilkan placeholder, tapi proses dan preview hasil tetap berjalan (preview dibuat server).

---

## Performa

Uji nyata di mesin uji (AMD A6-6310, 3.3 GB RAM, tanpa GPU): **11 gambar campuran** (JPEG, PNG, WebP, BMP, GIF, TIFF, AVIF, HEIC; total ±4 MB) di-upscale 2× dan dikonversi ke WebP selesai dalam **±16 detik** lewat UI, termasuk upload dan pembuatan preview. Batch 7 gambar lewat API selesai dalam **±10 detik**.

Untuk foto sehari-hari, Lanczos sudah sangat memadai dan hampir instan. Naikkan **Pertajam** ke 60–90 kalau hasil terasa kurang tajam.

---

## Struktur & teknologi

```
image-forge/
├── forge.py           # CLI (argparse)
├── forge_core.py      # mesin upscale/convert (Pillow)
├── server.py          # server lokal (http.server stdlib)
├── web/               # UI (HTML/CSS/vanilla JS, tanpa framework)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── favicon.svg
├── run.sh             # launcher
└── README.md
```

- **Backend:** Python 3.12 stdlib (`http.server`, `json`, `base64`, `zipfile`, `shutil`) + Pillow 13. Tanpa Flask/FastAPI.
- **Frontend:** HTML, CSS, dan JavaScript murni. Tanpa React/Vue, tanpa build step, tanpa `node_modules`.
- **Plugin opsional:** `pillow-avif-plugin` (AVIF), `pillow-heif` (HEIC/HEIF).

---

## Troubleshooting

**Port sudah dipakai** — server otomatis mencoba port berikutnya (8765–8784). Cek terminal untuk alamat yang aktif.

**AVIF tidak muncul di pilihan format** — pastikan menjalankan lewat `.venv` (`./run.sh`), lalu cek:

```bash
./.venv/bin/python -c "import pillow_avif; print('avif ok')"
```

**HEIC tidak bisa dibuka** — cek plugin:

```bash
./.venv/bin/python -c "import pillow_heif; print('heif ok')"
```

**"Melebihi batas 64 MP"** — turunkan skala/lebar, atau naikkan batas:

```bash
IMAGE_FORGE_MAX_PIXELS=120000000 ./run.sh
```

**Hasil terasa kurang tajam** — naikkan slider Pertajam (60–90) atau pakai `--sharpen 80` di CLI.

**File hasil hilang setelah beberapa saat** — hasil sementara dibersihkan setelah 12 jam. Simpan ke folder atau unduh ZIP sebelum itu.

**Ingin berhenti** — tekan `Ctrl+C` di terminal server.

---

## Lisensi

MIT. Bebas dipakai dan diubah.
