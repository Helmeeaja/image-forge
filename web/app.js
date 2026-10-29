/* Image Forge — front-end */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MAX_FILES = 60;
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
const STORAGE_KEY = 'imageforge.settings.v1';

const DEFAULTS = {
  scale: 2,
  useWidth: false,
  width: 3000,
  method: 'lanczos',
  format: 'auto',
  quality: 92,
  sharpen: 35,
  background: '#ffffff',
  keepMetadata: true,
};

const FALLBACK_FORMATS = [
  { key: 'jpeg', label: 'JPEG', ext: '.jpg', quality: true, alpha: false },
  { key: 'png', label: 'PNG', ext: '.png', quality: false, alpha: true },
  { key: 'webp', label: 'WebP', ext: '.webp', quality: true, alpha: true },
  { key: 'tiff', label: 'TIFF', ext: '.tiff', quality: false, alpha: true },
  { key: 'bmp', label: 'BMP', ext: '.bmp', quality: false, alpha: false },
  { key: 'gif', label: 'GIF', ext: '.gif', quality: false, alpha: false },
  { key: 'ico', label: 'ICO', ext: '.ico', quality: false, alpha: true },
];

const state = {
  files: [],
  results: [],
  formats: new Map(),
  busy: false,
  settings: loadSettings(),
};

const el = {
  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
  fileListWrap: $('#fileListWrap'),
  fileCount: $('#fileCount'),
  fileList: $('#fileList'),
  clearFiles: $('#clearFiles'),
  addMore: $('#addMore'),
  resetBtn: $('#resetBtn'),
  scaleSeg: $('#scaleSeg'),
  scaleValue: $('#scaleValue'),
  useWidth: $('#useWidth'),
  customWidth: $('#customWidth'),
  method: $('#method'),
  format: $('#format'),
  formatNote: $('#formatNote'),
  qualityField: $('#qualityField'),
  quality: $('#quality'),
  qualityValue: $('#qualityValue'),
  sharpen: $('#sharpen'),
  sharpenValue: $('#sharpenValue'),
  bgColor: $('#bgColor'),
  bgText: $('#bgText'),
  bgSwatch: $('#bgSwatch'),
  keepMeta: $('#keepMeta'),
  processBtn: $('#processBtn'),
  processLabel: $('#processLabel'),
  progressWrap: $('#progressWrap'),
  progressText: $('#progressText'),
  progressPct: $('#progressPct'),
  progressBar: $('#progressBar'),
  resultsSection: $('#resultsSection'),
  resultsTitle: $('#resultsTitle'),
  resultsGrid: $('#resultsGrid'),
  resultSummary: $('#resultSummary'),
  downloadAll: $('#downloadAll'),
  saveFolder: $('#saveFolder'),
  saveModal: $('#saveModal'),
  savePath: $('#savePath'),
  saveNote: $('#saveNote'),
  saveConfirm: $('#saveConfirm'),
  saveCancel: $('#saveCancel'),
  saveClose: $('#saveClose'),
  quickPaths: $('#quickPaths'),
  toasts: $('#toasts'),
};

/* ------------------------------------------------------------- settings */
function loadSettings() {
  const settings = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in raw && typeof raw[key] === typeof DEFAULTS[key]) settings[key] = raw[key];
      }
    }
  } catch { /* localStorage bisa diblokir */ }
  if (![1, 2, 3, 4].includes(Number(settings.scale))) settings.scale = DEFAULTS.scale;
  if (!['lanczos', 'bicubic', 'bilinear', 'nearest'].includes(settings.method)) settings.method = DEFAULTS.method;
  settings.quality = Math.min(100, Math.max(1, Number(settings.quality) || DEFAULTS.quality));
  settings.sharpen = Math.min(150, Math.max(0, Number(settings.sharpen) || DEFAULTS.sharpen));
  settings.width = Math.min(20000, Math.max(16, Number(settings.width) || DEFAULTS.width));
  if (!/^#[0-9a-f]{6}$/i.test(settings.background)) settings.background = DEFAULTS.background;
  return settings;
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch { /* abaikan */ }
}

/* ------------------------------------------------------------- boot */
async function init() {
  bindEvents();
  applySettingsToUI();
  updateCta();

  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('health gagal');
    const data = await res.json();
    populateFormats(Array.isArray(data.formats) && data.formats.length ? data.formats : FALLBACK_FORMATS);
  } catch {
    populateFormats(FALLBACK_FORMATS);
    toast('Server lokal tidak merespons dengan benar.', 'error');
  }

  applySettingsToUI();
}

function populateFormats(formats) {
  state.formats = new Map(formats.map((f) => [f.key, f]));
  el.format.innerHTML = '';
  el.format.append(new Option('Auto — ikuti format asli', 'auto'));
  for (const f of formats) {
    el.format.append(new Option(`${f.label} (${f.ext})`, f.key));
  }
  if (!state.formats.has(state.settings.format)) state.settings.format = 'auto';
  el.format.value = state.settings.format;
}

/* ------------------------------------------------------------- render settings */
function applySettingsToUI() {
  const s = state.settings;

  for (const btn of $$('button', el.scaleSeg)) {
    btn.classList.toggle('active', !s.useWidth && Number(btn.dataset.scale) === Number(s.scale));
    btn.disabled = s.useWidth;
  }
  el.scaleValue.textContent = s.useWidth ? 'custom' : `${s.scale}×`;

  el.useWidth.checked = s.useWidth;
  el.customWidth.disabled = !s.useWidth;
  el.customWidth.value = s.width || '';

  el.method.value = s.method;

  if (!state.formats.size) {
    state.formats = new Map(FALLBACK_FORMATS.map((f) => [f.key, f]));
  }
  if (s.format !== 'auto' && !state.formats.has(s.format)) s.format = 'auto';
  if (el.format.options.length) el.format.value = s.format;

  const supportsQuality = s.format === 'auto' || Boolean(state.formats.get(s.format)?.quality);
  el.qualityField.hidden = !supportsQuality;

  el.quality.value = s.quality;
  el.qualityValue.textContent = s.quality;
  el.sharpen.value = s.sharpen;
  el.sharpenValue.textContent = s.sharpen;
  updateRangeFill(el.quality);
  updateRangeFill(el.sharpen);

  el.bgColor.value = s.background;
  el.bgText.value = s.background.toUpperCase();
  el.bgSwatch.parentElement.style.setProperty('--swatch', s.background);
  el.keepMeta.checked = s.keepMetadata;

  updateFormatNote();
  updateEstimates();
  saveSettings();
}

function updateFormatNote() {
  const fmt = state.settings.format;
  const notes = {
    auto: 'Format asli dipertahankan (HEIC → JPEG).',
    jpeg: 'Kompresi lossy. Transparansi diratakan ke warna latar.',
    png: 'Lossless, transparansi dipertahankan. File cenderung besar.',
    webp: 'Kompresi modern, transparansi tetap ada.',
    avif: 'Ukuran paling kecil, kompatibilitas decoder lebih terbatas.',
    tiff: 'Lossless, cocok untuk arsip atau cetak.',
    bmp: 'Tanpa kompresi, ukuran file besar.',
    gif: 'Maksimal 256 warna, satu frame.',
    ico: 'Ikon maksimal 256×256 piksel.',
  };
  el.formatNote.textContent = notes[fmt] || '';
}

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const val = Number(input.value);
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--fill', `${pct}%`);
}

/* ------------------------------------------------------------- files */
function isSupported(file) {
  return (
    file.type.startsWith('image/') ||
    /\.(jpe?g|jfif|png|webp|gif|bmp|tiff?|ico|avif|heic|heif)$/i.test(file.name)
  );
}

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function extLabel(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toUpperCase() : 'IMG';
}

async function addFiles(list) {
  if (state.busy) return;
  const incoming = [...list];
  if (!incoming.length) return;

  let skippedType = 0;
  let skippedSize = 0;
  let skippedDup = 0;
  const accepted = [];
  const seen = new Set(
    state.files.map((f) => `${f.file.name}|${f.file.size}|${f.file.lastModified}`)
  );

  for (const file of incoming) {
    if (!isSupported(file)) { skippedType += 1; continue; }
    if (file.size > MAX_FILE_BYTES) { skippedSize += 1; continue; }
    if (state.files.length + accepted.length >= MAX_FILES) {
      toast(`Maksimal ${MAX_FILES} gambar per batch.`, 'error');
      break;
    }
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) { skippedDup += 1; continue; }
    seen.add(key);
    accepted.push(file);
  }

  if (skippedType) toast(`${skippedType} file dilewati: bukan gambar.`, 'error');
  if (skippedSize) toast(`${skippedSize} file dilewati: lebih dari 60 MB.`, 'error');
  if (skippedDup) toast(`${skippedDup} file duplikat dilewati.`);

  const items = accepted.map((file) => ({
    key: uid(),
    file,
    name: file.name,
    size: file.size,
    thumb: null,
    width: null,
    height: null,
  }));
  state.files.push(...items);
  renderFiles();
  updateCta();

  for (const item of items) {
    makeThumb(item); // tidak perlu ditunggu
  }
}

function renderFiles() {
  const count = state.files.length;
  el.dropzone.hidden = count > 0;
  el.fileListWrap.hidden = count === 0;

  if (!count) {
    el.fileList.innerHTML = '';
    updateCta();
    return;
  }

  const total = state.files.reduce((sum, f) => sum + f.size, 0);
  el.fileCount.innerHTML = `<strong>${count}</strong> gambar · ${fmtBytes(total)}`;

  el.fileList.innerHTML = '';
  for (const item of state.files) {
    const card = document.createElement('article');
    card.className = 'file-card';
    card.dataset.key = item.key;

    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';
    if (item.thumb) {
      thumb.style.backgroundImage = `url("${item.thumb}")`;
    } else {
      const ext = document.createElement('span');
      ext.className = 'file-ext';
      ext.textContent = extLabel(item.name);
      thumb.append(ext);
    }

    const badge = document.createElement('span');
    badge.className = 'file-badge';
    badge.textContent = item.width ? `${((item.width * item.height) / 1e6).toFixed(1)} MP` : extLabel(item.name);
    thumb.append(badge);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-remove';
    remove.setAttribute('aria-label', `Hapus ${item.name}`);
    remove.innerHTML = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    thumb.append(remove);

    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.name;
    name.title = item.name;
    const dims = document.createElement('span');
    dims.className = 'file-dim';
    const orig = document.createElement('span');
    orig.textContent = item.width ? `${item.width}×${item.height}` : '—';
    const out = document.createElement('span');
    out.className = 'file-out';
    dims.append(orig, out);
    info.append(name, dims);

    card.append(thumb, info);
    el.fileList.append(card);
  }
  updateEstimates();
}

async function makeThumb(item) {
  try {
    if ('createImageBitmap' in window) {
      const bmp = await createImageBitmap(item.file);
      item.width = bmp.width;
      item.height = bmp.height;
      const ratio = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * ratio));
      canvas.height = Math.max(1, Math.round(bmp.height * ratio));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      item.thumb = canvas.toDataURL('image/webp', 0.78);
    } else {
      await thumbViaImage(item);
    }
  } catch {
    try {
      await thumbViaImage(item);
    } catch { /* preview tidak tersedia (mis. HEIC) */ }
  }
  updateFileCard(item);
  updateEstimates();
}

function thumbViaImage(item) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(item.file);
    const img = new Image();
    img.onload = () => {
      item.width = img.naturalWidth;
      item.height = img.naturalHeight;
      const ratio = Math.min(1, 360 / Math.max(item.width, item.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(item.width * ratio));
      canvas.height = Math.max(1, Math.round(item.height * ratio));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      try { item.thumb = canvas.toDataURL('image/webp', 0.78); } catch { item.thumb = null; }
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('preview gagal')); };
    img.src = url;
  });
}

function updateFileCard(item) {
  const card = el.fileList.querySelector(`[data-key="${item.key}"]`);
  if (!card) return;
  const thumb = $('.file-thumb', card);
  if (!thumb) return;
  if (item.thumb) {
    thumb.style.backgroundImage = `url("${item.thumb}")`;
    $('.file-ext', thumb)?.remove();
  }
  const badge = $('.file-badge', thumb);
  if (badge) badge.textContent = item.width ? `${((item.width * item.height) / 1e6).toFixed(1)} MP` : extLabel(item.name);
  const orig = $('.file-dim span', card);
  if (orig) orig.textContent = item.width ? `${item.width}×${item.height}` : '—';
}

function estimateDims(item) {
  if (!item.width || !item.height) return null;
  const s = state.settings;
  let w;
  let h;
  if (s.useWidth && s.width) {
    w = Math.round(Number(s.width));
    h = Math.max(1, Math.round((item.height * w) / item.width));
  } else {
    w = Math.max(1, Math.round(item.width * s.scale));
    h = Math.max(1, Math.round(item.height * s.scale));
  }
  return [w, h];
}

function updateEstimates() {
  if (!state.files.length) return;
  for (const card of $$('.file-card', el.fileList)) {
    const item = state.files.find((f) => f.key === card.dataset.key);
    const out = $('.file-out', card);
    if (!item || !out) continue;
    const dims = estimateDims(item);
    if (!dims) { out.textContent = ''; out.title = ''; out.classList.remove('over'); continue; }
    out.textContent = `→ ${dims[0]}×${dims[1]}`;
    const over = dims[0] * dims[1] > MAX_PIXELS;
    out.classList.toggle('over', over);
    out.title = over ? `Melebihi batas ${MAX_PIXELS / 1e6} MP — turunkan skala` : '';
  }
}

function updateCta() {
  const count = state.files.length;
  el.processBtn.disabled = state.busy || count === 0;
  if (!state.busy) {
    el.processLabel.textContent = count ? `Proses ${count} gambar` : 'Proses gambar';
  }
}

/* ------------------------------------------------------------- events */
function bindEvents() {
  el.dropzone.addEventListener('click', (event) => {
    if (event.target === el.fileInput) return;
    el.fileInput.click();
  });
  el.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      el.fileInput.click();
    }
  });

  el.fileInput.addEventListener('change', () => {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  el.addMore.addEventListener('click', () => el.fileInput.click());

  el.clearFiles.addEventListener('click', () => {
    if (state.busy) return;
    state.files = [];
    renderFiles();
    updateCta();
    toast('Daftar gambar dikosongkan.');
  });

  el.fileList.addEventListener('click', (event) => {
    const remove = event.target.closest('.file-remove');
    if (!remove || state.busy) return;
    const card = remove.closest('.file-card');
    if (!card) return;
    state.files = state.files.filter((f) => f.key !== card.dataset.key);
    renderFiles();
    updateCta();
  });

  el.scaleSeg.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-scale]');
    if (!btn || btn.disabled) return;
    state.settings.scale = Number(btn.dataset.scale);
    state.settings.useWidth = false;
    applySettingsToUI();
  });

  el.useWidth.addEventListener('change', () => {
    state.settings.useWidth = el.useWidth.checked;
    if (state.settings.useWidth && !(Number(state.settings.width) >= 16)) {
      state.settings.width = 3000;
    }
    applySettingsToUI();
    if (state.settings.useWidth) {
      el.customWidth.focus();
      el.customWidth.select();
    }
  });

  el.customWidth.addEventListener('input', () => {
    const val = Number(el.customWidth.value);
    if (Number.isFinite(val) && val >= 16 && val <= 20000) {
      state.settings.width = Math.round(val);
      el.scaleValue.textContent = `${state.settings.width}px`;
      updateEstimates();
      saveSettings();
    }
  });

  el.customWidth.addEventListener('blur', () => {
    let val = Number(el.customWidth.value);
    if (!Number.isFinite(val) || val < 16) val = 3000;
    val = Math.min(20000, Math.round(val));
    state.settings.width = val;
    el.customWidth.value = val;
    el.scaleValue.textContent = `${val}px`;
    updateEstimates();
    saveSettings();
  });

  el.method.addEventListener('change', () => {
    state.settings.method = el.method.value;
    saveSettings();
  });

  el.format.addEventListener('change', () => {
    state.settings.format = el.format.value;
    applySettingsToUI();
  });

  el.quality.addEventListener('input', () => {
    state.settings.quality = Number(el.quality.value);
    el.qualityValue.textContent = state.settings.quality;
    updateRangeFill(el.quality);
    saveSettings();
  });

  el.sharpen.addEventListener('input', () => {
    state.settings.sharpen = Number(el.sharpen.value);
    el.sharpenValue.textContent = state.settings.sharpen;
    updateRangeFill(el.sharpen);
    saveSettings();
  });

  el.bgColor.addEventListener('input', () => {
    setBackground(el.bgColor.value);
  });

  el.bgText.addEventListener('input', () => {
    const val = el.bgText.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(val)) {
      setBackground(val.toLowerCase());
    }
  });

  el.bgText.addEventListener('blur', () => {
    el.bgText.value = state.settings.background.toUpperCase();
  });

  el.keepMeta.addEventListener('change', () => {
    state.settings.keepMetadata = el.keepMeta.checked;
    saveSettings();
  });

  el.resetBtn.addEventListener('click', () => {
    state.settings = { ...DEFAULTS };
    applySettingsToUI();
    toast('Pengaturan dikembalikan ke default.');
  });

  el.processBtn.addEventListener('click', processAll);
  el.downloadAll.addEventListener('click', downloadZip);
  el.saveFolder.addEventListener('click', openSaveModal);
  el.saveConfirm.addEventListener('click', saveToFolder);
  el.saveCancel.addEventListener('click', closeSaveModal);
  el.saveClose.addEventListener('click', closeSaveModal);
  el.saveModal.addEventListener('click', (event) => {
    if (event.target === el.saveModal) closeSaveModal();
  });
  el.quickPaths.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-path]');
    if (!btn) return;
    el.savePath.value = btn.dataset.path;
    el.savePath.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.saveModal.hidden) closeSaveModal();
  });

  // drag & drop di seluruh halaman
  let dragDepth = 0;
  const hasFiles = (event) =>
    Boolean(event.dataTransfer) &&
    (event.dataTransfer.types.includes('Files') || event.dataTransfer.items?.length);
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    if (!state.busy) el.dropzone.classList.add('is-drag');
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.dropzone.classList.remove('is-drag');
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    el.dropzone.classList.remove('is-drag');
    addFiles(event.dataTransfer.files);
  });

  // paste dari clipboard
  window.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  });
}

function setBackground(hex) {
  state.settings.background = hex;
  el.bgColor.value = hex;
  el.bgText.value = hex.toUpperCase();
  el.bgSwatch.parentElement.style.setProperty('--swatch', hex);
  saveSettings();
}

/* ------------------------------------------------------------- processing */
function buildOptions() {
  const s = state.settings;
  if (s.useWidth) {
    const width = Number(s.width);
    if (!Number.isFinite(width) || width < 16 || width > 20000) {
      return { error: 'Lebar harus antara 16 dan 20.000 piksel.' };
    }
  }
  return {
    scale: Number(s.scale),
    width: s.useWidth ? Math.round(Number(s.width)) : null,
    height: null,
    method: s.method,
    format: s.format,
    quality: Number(s.quality),
    sharpen: Number(s.sharpen),
    background: s.background,
    keep_metadata: s.keepMetadata,
  };
}

async function processAll() {
  if (state.busy || !state.files.length) return;

  const options = buildOptions();
  if (options.error) {
    toast(options.error, 'error');
    return;
  }

  const totalBytes = state.files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    toast(
      `Total ${fmtBytes(totalBytes)} melebihi batas ${fmtBytes(MAX_TOTAL_BYTES)} per batch. Proses sebagian dulu.`,
      'error'
    );
    return;
  }

  const tooBig = state.files.filter((f) => {
    const dims = estimateDims(f);
    return dims && dims[0] * dims[1] > MAX_PIXELS;
  });
  if (tooBig.length) {
    toast(
      `${tooBig.length} gambar akan melebihi ${MAX_PIXELS / 1e6} MP. Turunkan skala atau lebar.`,
      'error'
    );
    return;
  }

  setBusy(true);
  el.resultsSection.hidden = true;
  el.resultsGrid.innerHTML = '';
  el.progressWrap.hidden = false;
  showIndeterminate('Membaca file…');

  const started = performance.now();

  try {
    const payloadFiles = [];
    for (let i = 0; i < state.files.length; i += 1) {
      showIndeterminate(`Membaca file ${i + 1}/${state.files.length}…`);
      const data = await fileToBase64(state.files[i].file);
      payloadFiles.push({ name: state.files[i].name, data });
    }

    showUploadProgress(0);

    const result = await xhrJSON(
      '/api/process',
      { files: payloadFiles, options },
      (progress) => showUploadProgress(progress)
    );

    el.progressBar.style.width = '100%';
    el.progressPct.textContent = '100%';

    renderResults(result);

    const secs = ((performance.now() - started) / 1000).toFixed(1);
    if (result.failed) {
      toast(`${result.ok} berhasil, ${result.failed} gagal dalam ${secs}s.`, 'error');
    } else {
      toast(`${result.ok} gambar selesai dalam ${secs}s.`);
    }
  } catch (error) {
    toast(error.message || 'Terjadi kesalahan saat memproses.', 'error');
  } finally {
    el.progressWrap.hidden = true;
    el.progressWrap.classList.remove('indeterminate');
    el.progressBar.style.width = '0';
    setBusy(false);
  }
}

function setBusy(busy) {
  state.busy = busy;
  el.processBtn.classList.toggle('is-busy', busy);
  if (busy) {
    el.processLabel.textContent = 'Memproses…';
    el.processBtn.disabled = true;
  } else {
    updateCta();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Gagal membaca ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function xhrJSON(url, body, onUpload) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 30 * 60 * 1000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onUpload) onUpload(event.loaded / event.total);
    };
    xhr.upload.onload = () => showIndeterminate('Memproses gambar…');
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        resolve(data);
      } else {
        reject(new Error(data?.error || `Server menolak permintaan (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Tidak bisa terhubung ke server lokal.'));
    xhr.ontimeout = () => reject(new Error('Proses melebihi 30 menit.'));
    xhr.send(JSON.stringify(body));
  });
}

function showUploadProgress(progress) {
  el.progressWrap.classList.remove('indeterminate');
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  el.progressBar.style.width = `${pct}%`;
  el.progressText.textContent = 'Mengunggah ke server lokal…';
  el.progressPct.textContent = `${pct}%`;
  if (pct >= 100) showIndeterminate('Memproses gambar…');
}

function showIndeterminate(text) {
  el.progressWrap.classList.add('indeterminate');
  el.progressBar.style.width = '';
  el.progressText.textContent = text;
  el.progressPct.textContent = '…';
}

/* ------------------------------------------------------------- results */
function renderResults(data) {
  state.results = Array.isArray(data.results) ? data.results : [];
  el.resultsGrid.innerHTML = '';

  const ok = state.results.filter((r) => !r.error);
  el.resultsSection.hidden = false;
  el.resultsTitle.textContent = ok.length ? `${ok.length} gambar siap` : 'Tidak ada hasil';
  el.resultSummary.textContent = `${data.ok ?? ok.length} berhasil · ${data.failed ?? 0} gagal · ${data.elapsed ?? 0}s`;
  el.downloadAll.hidden = ok.length === 0;
  el.saveFolder.hidden = ok.length === 0;

  state.results.forEach((result, index) => {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.style.animationDelay = `${Math.min(index * 45, 360)}ms`;

    if (result.error) {
      card.classList.add('error');
      const box = document.createElement('div');
      box.className = 'result-error';
      const title = document.createElement('h3');
      title.textContent = `Gagal — ${result.name}`;
      const msg = document.createElement('p');
      msg.textContent = result.error;
      box.append(title, msg);
      card.append(box);
      el.resultsGrid.append(card);
      return;
    }

    const compare = document.createElement('div');
    compare.className = 'compare';
    compare.tabIndex = 0;
    compare.setAttribute('role', 'slider');
    compare.setAttribute('aria-label', 'Perbandingan gambar asli dan hasil');
    compare.setAttribute('aria-valuemin', '0');
    compare.setAttribute('aria-valuemax', '100');
    compare.setAttribute('aria-valuenow', '50');
    compare.style.setProperty('--pos', '50%');

    const before = document.createElement('img');
    before.className = 'cmp-before';
    before.src = result.origThumb;
    before.alt = `Asli: ${result.name}`;
    before.draggable = false;

    const after = document.createElement('img');
    after.className = 'cmp-after';
    after.src = result.thumb;
    after.alt = `Hasil: ${result.outName}`;
    after.draggable = false;

    const handle = document.createElement('div');
    handle.className = 'cmp-handle';

    const labelBefore = document.createElement('span');
    labelBefore.className = 'cmp-label before';
    labelBefore.textContent = 'ASLI';

    const labelAfter = document.createElement('span');
    labelAfter.className = 'cmp-label after';
    labelAfter.textContent = 'HASIL';

    compare.append(before, after, handle, labelBefore, labelAfter);
    bindCompare(compare);

    const info = document.createElement('div');
    info.className = 'result-info';

    const text = document.createElement('div');
    text.className = 'result-text';
    const name = document.createElement('p');
    name.className = 'result-name';
    name.textContent = result.outName;
    name.title = result.outName;
    const meta = document.createElement('p');
    meta.className = 'result-meta';
    const scalePct = result.origWidth ? Math.round((result.width / result.origWidth) * 100) : null;
    meta.textContent = [
      `${result.width}×${result.height}`,
      fmtBytes(result.bytes),
      result.format.toUpperCase(),
      scalePct ? `${scalePct}%` : null,
    ].filter(Boolean).join(' · ');
    text.append(name, meta);

    const download = document.createElement('a');
    download.className = 'btn ghost small';
    download.href = `/api/file/${result.id}`;
    download.download = result.outName;
    download.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>Unduh';

    info.append(text, download);
    card.append(compare, info);
    el.resultsGrid.append(card);
  });

  el.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindCompare(container) {
  const update = (clientX) => {
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    container.style.setProperty('--pos', `${pct}%`);
    container.setAttribute('aria-valuenow', String(Math.round(pct)));
  };

  let dragging = false;
  container.addEventListener('pointerdown', (event) => {
    dragging = true;
    container.setPointerCapture?.(event.pointerId);
    update(event.clientX);
  });
  container.addEventListener('pointermove', (event) => {
    if (dragging) update(event.clientX);
  });
  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    try { container.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
  };
  container.addEventListener('pointerup', stop);
  container.addEventListener('pointercancel', stop);
  container.addEventListener('dblclick', () => {
    container.style.setProperty('--pos', '50%');
    container.setAttribute('aria-valuenow', '50');
  });
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = Number(container.getAttribute('aria-valuenow')) || 50;
    const next = Math.min(100, Math.max(0, current + (event.key === 'ArrowRight' ? 4 : -4)));
    container.style.setProperty('--pos', `${next}%`);
    container.setAttribute('aria-valuenow', String(next));
  });
}

async function downloadZip() {
  const ids = state.results.filter((r) => r.id).map((r) => r.id);
  if (!ids.length) return;

  const original = el.downloadAll.innerHTML;
  el.downloadAll.disabled = true;
  el.downloadAll.textContent = 'Menyiapkan…';
  try {
    const res = await fetch('/api/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Gagal membuat ZIP (HTTP ${res.status}).`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'image-forge.zip');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('ZIP berisi semua hasil sudah diunduh.');
  } catch (error) {
    toast(error.message || 'Gagal mengunduh ZIP.', 'error');
  } finally {
    el.downloadAll.disabled = false;
    el.downloadAll.innerHTML = original;
  }
}

/* ------------------------------------------------------------- simpan ke folder */
const SAVE_PATH_KEY = 'imageforge.savepath.v1';

function openSaveModal() {
  const ok = state.results.filter((r) => r.id);
  if (!ok.length) return;
  let savedPath = '';
  try { savedPath = localStorage.getItem(SAVE_PATH_KEY) || ''; } catch { /* abaikan */ }
  el.savePath.value = savedPath || '~/Downloads/image-forge';
  el.saveNote.textContent = '';
  el.saveConfirm.disabled = false;
  el.saveConfirm.textContent = `Simpan ${ok.length} file`;
  el.saveModal.hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    el.savePath.focus();
    el.savePath.select();
  });
}

function closeSaveModal() {
  if (el.saveModal.hidden) return;
  el.saveModal.hidden = true;
  document.body.classList.remove('modal-open');
  el.saveFolder.focus();
}

async function saveToFolder() {
  const ids = state.results.filter((r) => r.id).map((r) => r.id);
  const folder = el.savePath.value.trim();
  if (!ids.length) return;
  if (!folder) {
    el.saveNote.textContent = 'Isi lokasi folder dulu.';
    el.savePath.focus();
    return;
  }

  const original = el.saveConfirm.textContent;
  el.saveConfirm.disabled = true;
  el.saveConfirm.textContent = 'Menyimpan…';
  el.saveNote.textContent = '';
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, folder }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal menyimpan (HTTP ${res.status}).`);
    try { localStorage.setItem(SAVE_PATH_KEY, folder); } catch { /* abaikan */ }
    toast(`${data.count} file disimpan ke ${data.folder}.`);
    closeSaveModal();
  } catch (error) {
    el.saveNote.textContent = error.message || 'Gagal menyimpan file.';
  } finally {
    el.saveConfirm.disabled = false;
    el.saveConfirm.textContent = original;
  }
}

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

/* ------------------------------------------------------------- toast */
function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' error' : ''}`;
  node.textContent = message;
  el.toasts.append(node);

  while (el.toasts.children.length > 3) {
    el.toasts.firstElementChild.remove();
  }

  const life = type === 'error' ? 6500 : 4200;
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, life);
}

init();
