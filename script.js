/* ===================================================
   Sistem Semakan Tundaan MBPG — API Integration (v2)
   ===================================================
   Semua panggilan API melalui proxy (Cloudflare Worker).
   - Tiada token di sisi browser (token disimpan dalam Worker)
   - Tiada mod demo / data contoh
   Flow:
   1. POST /api/clamps/search            (carian utama)
   2. GET  /api/jpj                      (maklumat pemilik, best-effort)
   3. POST /api/towing-operations/search (fallback 1)
   4. POST /api/tow-assignments/search   (fallback 2)
   =================================================== */

/* GANTI dengan URL Worker sebenar selepas deploy, contoh:
   https://mbpg-itcs-proxy.namakau.workers.dev */
const API_BASE_URL = 'https://mbpg-itcs-proxy.mrsaifullahmuhamad23.workers.dev';

const FORM = document.getElementById('searchForm');
const INPUT = document.getElementById('plateInput');
const FEEDBACK = document.querySelector('[data-feedback]');
const MODAL = document.getElementById('vehicleModal');
const PLATE_EL = MODAL.querySelector('[data-plate]');
const STATUS_EL = MODAL.querySelector('[data-status]');
const CASE_DETAILS_EL = MODAL.querySelector('[data-case-details]');
const OWNER_DETAILS_EL = MODAL.querySelector('[data-owner-details]');
const GALLERY_EL = MODAL.querySelector('[data-gallery]');
const LOADING_WRAP = document.getElementById('loadingWrap');

const CASE_FIELDS = [
  { label: 'No. Rujukan', key: 'caseRef' },
  { label: 'Tarikh / Masa Kejadian', key: 'incidentDate' },
  { label: 'Tarikh Laporan', key: 'reportDate' },
  { label: 'Jenis Kesalahan', key: 'offenceType' },
  { label: 'Rujukan Perundangan', key: 'legislation' },
  { label: 'Lokasi Kesalahan', key: 'location' },
  { label: 'Jabatan / Unit', key: 'enforcementTeam' },
  { label: 'Pegawai Bertugas', key: 'officerInCharge' },
  { label: 'No. Siri Clamp', key: 'clampSerial' }
];

const OWNER_FIELDS = [
  { label: 'Nama Pemilik', key: 'ownerName' },
  { label: 'No. Kad Pengenalan', key: 'ownerIdNo' },
  { label: 'Alamat', key: 'ownerAddress' },
  { label: 'Jenis / Model Kenderaan', key: 'vehicleModel' },
  { label: 'Lokasi Tuntutan', key: 'releaseYard' },
  { label: 'Catatan', key: 'remarks' }
];

const closeTriggers = MODAL.querySelectorAll('[data-close]');
closeTriggers.forEach(btn => btn.addEventListener('click', () => toggleModal(false)));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') toggleModal(false);
});

/* ─── Main submit handler ─────────────────────────── */

FORM.addEventListener('submit', async event => {
  event.preventDefault();
  const sanitizedPlate = sanitizePlate(INPUT.value);

  if (!sanitizedPlate) {
    FEEDBACK.textContent = 'Masukkan nombor pendaftaran yang sah.';
    return;
  }

  if (API_BASE_URL.indexOf('__WORKER_URL__') !== -1) {
    FEEDBACK.textContent = 'Konfigurasi sistem belum lengkap. Sila hubungi pentadbir sistem MBPG.';
    return;
  }

  FEEDBACK.textContent = '';
  toggleModal(false);
  setLoading(true);

  try {
    /* Step 1: Carian clamp (utama) */
    const clampRecord = await fetchClampByPlate(sanitizedPlate);

    let record = null;

    if (clampRecord) {
      record = mapClampToRecord(clampRecord, sanitizedPlate);
      await tryEnrichWithJpj(record, sanitizedPlate);
    }

    /* Step 2: Fallback — towing-operations */
    if (!record) {
      const towOpRecord = await fetchTowingOperationByPlate(sanitizedPlate);
      if (towOpRecord) {
        record = mapTowingOperationToRecord(towOpRecord, sanitizedPlate);
        await tryEnrichWithJpj(record, sanitizedPlate);
      }
    }

    /* Step 3: Fallback — tow-assignments */
    if (!record) {
      record = await fetchTowAssignmentFallbackRecord(sanitizedPlate);
    }

    if (!record) {
      FEEDBACK.textContent =
        'Rekod tidak ditemui untuk ' + sanitizedPlate +
        '. Sila pastikan nombor pendaftaran adalah betul.';
      return;
    }

    populateModal(record);
    toggleModal(true);
  } catch (error) {
    console.error('Semakan gagal:', error);
    FEEDBACK.textContent =
      'Sistem semakan tidak dapat dihubungi buat masa ini. Sila cuba sebentar lagi atau hubungi MBPG di 07-254 7777.';
  } finally {
    setLoading(false);
  }
});

/* ─── Helpers ──────────────────────────────────────── */

function sanitizePlate(value = '') {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

async function tryEnrichWithJpj(record, plate) {
  try {
    const jpjData = await fetchJpjOwner(plate);
    if (jpjData) enrichRecordWithJpj(record, jpjData);
  } catch (jpjErr) {
    console.warn('JPJ enrichment gagal (tidak kritikal):', jpjErr.message);
  }
}

/* ─── API calls ────────────────────────────────────── */

function searchPayload(plate) {
  return {
    vehicleRegistrationNo: plate,
    page: 0,
    size: 1,
    sortBy: 'createdDate',
    sortDirection: 'DESC'
  };
}

async function fetchClampByPlate(plate) {
  try {
    const response = await callApi('POST', '/api/clamps/search', searchPayload(plate));
    return extractItems(response)[0] || null;
  } catch (err) {
    console.warn('Clamp search gagal:', err.message);
    return null;
  }
}

async function fetchTowingOperationByPlate(plate) {
  try {
    const response = await callApi('POST', '/api/towing-operations/search', searchPayload(plate));
    return extractItems(response)[0] || null;
  } catch (err) {
    console.warn('Towing-operations search gagal:', err.message);
    return null;
  }
}

async function fetchJpjOwner(plate) {
  const today = new Date().toISOString().slice(0, 10);
  const url = `/api/jpj?registrationNumber=${encodeURIComponent(plate)}&offenceDate=${today}`;
  return callApi('GET', url);
}

async function fetchTowAssignmentFallbackRecord(plate) {
  const response = await callApi('POST', '/api/tow-assignments/search', searchPayload(plate));
  const item = extractItems(response)[0];
  if (!item) return null;

  return {
    plate: item.vehicleRegistrationNo || plate,
    status: item.status || 'Dalam Proses',
    caseRef: item.assignmentId || '—',
    incidentDate: formatDate(item.assignedDatetime) || '—',
    reportDate: formatDate(item.createdDate || item.assignedDatetime) || '—',
    offenceType: item.warningNoticeNumber ? `Notis: ${item.warningNoticeNumber}` : 'Kes Tundaan',
    legislation: '—',
    location: '—',
    enforcementTeam: 'MBPG ITCS',
    officerInCharge: item.assignedByName || '—',
    clampSerial: '—',
    ownerName: '—',
    ownerIdNo: '—',
    ownerAddress: '—',
    vehicleModel: '—',
    releaseYard: '—',
    remarks: 'Data daripada tow-assignments',
    gallery: []
  };
}

/* ─── Generic API caller ───────────────────────────── */

async function callApi(method, path, payload) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (method === 'POST' && payload) {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (!response.ok) {
    throw new Error(`API ${method} ${path} gagal: ${response.status}`);
  }

  return response.json();
}

/* ─── Response helpers ─────────────────────────────── */

function extractItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.content)) return response.content;
  if (Array.isArray(response?.data?.content)) return response.data.content;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function mapClampToRecord(clamp, fallbackPlate) {
  return {
    plate: clamp.vehicleRegistrationNo || fallbackPlate,
    status: clamp.status || 'Dalam Proses',
    caseRef: clamp.clampId || '—',
    incidentDate: formatDate(clamp.preClampDatetime || clamp.clampDatetime) || '—',
    reportDate: formatDate(clamp.createdDate || clamp.preClampDatetime) || '—',
    offenceType: clamp.offenceDescription || clamp.offenceCode || 'Kes Klamp',
    legislation: clamp.compoundCodeId || '—',
    location: [clamp.locationAddress, clamp.city].filter(Boolean).join(', ') || '—',
    enforcementTeam: 'MBPG ITCS',
    officerInCharge: clamp.enforcementOfficerName
      ? `${clamp.enforcementOfficerName} (${clamp.enforcementOfficerStaffNo || '—'})`
      : '—',
    clampSerial: clamp.clampSerialNo || '—',
    ownerName: '—',
    ownerIdNo: '—',
    ownerAddress: '—',
    vehicleModel: '—',
    releaseYard: (clamp.status === 'TOWED' || clamp.status === 'IN_DEPOT') ? 'Depoh MBPG' : '—',
    remarks: clamp.entrySource ? `Sumber: ${clamp.entrySource}` : '—',
    gallery: []
  };
}

function mapTowingOperationToRecord(op, fallbackPlate) {
  return {
    plate: op.vehicleRegistrationNo || fallbackPlate,
    status: op.status || 'Dalam Proses',
    caseRef: op.towingId || op.towingOperationId || op.id || '—',
    incidentDate: formatDate(op.createdAt || op.createdDate) || '—',
    reportDate: formatDate(op.createdDate || op.createdAt) || '—',
    offenceType: op.warningNoticeNumber ? `Notis: ${op.warningNoticeNumber}` : 'Kes Tundaan',
    legislation: '—',
    location: [op.locationAddress, op.city].filter(Boolean).join(', ') || '—',
    enforcementTeam: 'MBPG ITCS',
    officerInCharge: op.initiatedBy || op.enforcementOfficerName || '—',
    clampSerial: '—',
    ownerName: '—',
    ownerIdNo: '—',
    ownerAddress: '—',
    vehicleModel: '—',
    releaseYard: (op.status === 'IN_DEPOT' || op.status === 'TOWED') ? 'Depoh MBPG' : '—',
    remarks: op.entrySource ? `Sumber: ${op.entrySource}` : '—',
    gallery: []
  };
}

function enrichRecordWithJpj(record, jpj) {
  if (jpj.ownerName) record.ownerName = jpj.ownerName;
  if (jpj.ownerIdNo) record.ownerIdNo = jpj.ownerIdNo;

  const addressParts = [jpj.address1, jpj.address2, jpj.address3].filter(Boolean);
  if (jpj.postcode) addressParts.push(jpj.postcode);
  if (jpj.city) addressParts.push(jpj.city);
  if (jpj.state) addressParts.push(jpj.state);
  if (addressParts.length) record.ownerAddress = addressParts.join(', ');

  const modelParts = [jpj.carMakeCode, jpj.model].filter(Boolean);
  if (modelParts.length) record.vehicleModel = modelParts.join(' ');
}

/* ─── Date formatting ──────────────────────────────── */

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ms-MY', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/* ─── Modal rendering ──────────────────────────────── */

function populateModal(record) {
  PLATE_EL.textContent = record.plate;
  STATUS_EL.textContent = record.status;
  renderDefinitionList(CASE_DETAILS_EL, CASE_FIELDS, record);
  renderDefinitionList(OWNER_DETAILS_EL, OWNER_FIELDS, record);
  renderGallery(record.gallery);
}

function renderDefinitionList(container, fields, record) {
  container.innerHTML = '';
  fields.forEach(field => {
    const dt = document.createElement('dt');
    dt.textContent = field.label;
    const dd = document.createElement('dd');
    dd.textContent = record[field.key] || '—';
    container.append(dt, dd);
  });
}

function renderGallery(images = []) {
  GALLERY_EL.innerHTML = '';
  if (!images.length) {
    const placeholder = document.createElement('p');
    placeholder.className = 'gallery__placeholder';
    placeholder.textContent = 'Tiada gambar dilampirkan.';
    GALLERY_EL.appendChild(placeholder);
    return;
  }

  images.forEach((src, index) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Gambar kesalahan ${index + 1}`;
    GALLERY_EL.appendChild(img);
  });
}

/* ─── Loading state ────────────────────────────────── */

function setLoading(isLoading) {
  if (LOADING_WRAP) {
    LOADING_WRAP.hidden = !isLoading;
    LOADING_WRAP.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }
  const submitBtn = FORM?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = isLoading;
  if (INPUT) INPUT.disabled = isLoading;
}

/* ─── Modal toggle ─────────────────────────────────── */

function toggleModal(state) {
  if (!state) {
    MODAL.classList.remove('is-visible');
    MODAL.setAttribute('aria-hidden', 'true');
    return;
  }

  MODAL.classList.add('is-visible');
  MODAL.setAttribute('aria-hidden', 'false');
}

const yearEl = document.getElementById('currentYear');
if (yearEl) yearEl.textContent = new Date().getFullYear();
