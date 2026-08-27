// ============================================================
//  DocScan — api.js
//  ทางเดียวที่โค้ดฝั่งหน้าเว็บควรคุยกับ GAS
//
//  แก้สามปัญหาที่มีอยู่เดิม
//   1. ไม่มี timeout เลย → UI ค้างไม่รู้จบเมื่อเน็ตเงียบ
//   2. ไม่มี idempotency → ส่งซ้ำแล้วได้แถวซ้ำใน Sheet โดยไม่มีใครรู้
//   3. อัปโหลดหนึ่งคำขอต่อหนึ่งไฟล์ → 50 หน้า = 50 คำขอ
// ============================================================

export const DEFAULTS = {
  timeoutMs: 30000,
  uploadTimeoutMs: 120000,
  retries: 2,
  backoffMs: 800,
  uploadChunk: 5
};

/** UUID ที่ใช้ได้แม้บริบทไม่ใช่ secure context */
export function newClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export class ApiError extends Error {
  constructor(message, kind, detail) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;             // timeout | network | http | app | aborted
    this.detail = detail;
    this.retryable = kind === 'timeout' || kind === 'network' ||
                     (kind === 'http' && detail >= 500);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * ยิงคำขอไป GAS หนึ่งครั้ง พร้อม timeout
 * GAS ต้องใช้ Content-Type: text/plain เพื่อเลี่ยง CORS preflight
 */
async function once(url, payload, timeoutMs, externalSignal, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  const onAbort = () => ctrl.abort('external');
  if (externalSignal) externalSignal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (!res.ok) throw new ApiError('HTTP ' + res.status, 'http', res.status);

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new ApiError('ตอบกลับไม่ใช่ JSON', 'app', text.slice(0, 200)); }
    return data;

  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err && err.name === 'AbortError') {
      if (externalSignal && externalSignal.aborted) throw new ApiError('ยกเลิกแล้ว', 'aborted');
      throw new ApiError('หมดเวลารอ ' + Math.round(timeoutMs / 1000) + ' วินาที', 'timeout');
    }
    throw new ApiError('ติดต่อเซิร์ฟเวอร์ไม่ได้', 'network', err && err.message);
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

/**
 * ยิงคำขอพร้อม retry
 *
 * ทุก payload ต้องมี client_id และฝั่ง GAS ต้อง upsert ตามคีย์นี้
 * ถ้า GAS ยัง insert อย่างเดียว การ retry จะกลายเป็นเครื่องผลิตข้อมูลซ้ำ
 * เพราะกรณีที่บันทึกสำเร็จแล้วแต่คำตอบกลับมาไม่ถึง จะถูกส่งซ้ำเสมอ
 */
export async function apiFetch(url, payload, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const fetchImpl = o.fetchImpl || fetch;
  const body = { ...payload };
  if (!body.client_id) body.client_id = newClientId();

  let last;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      const data = await once(url, body, o.timeoutMs, o.signal, fetchImpl);
      if (data && data.status === 'error') {
        throw new ApiError(data.message || 'เซิร์ฟเวอร์แจ้งข้อผิดพลาด', 'app', data);
      }
      return data;
    } catch (err) {
      last = err;
      if (!err.retryable || attempt === o.retries) break;
      if (o.onRetry) o.onRetry(attempt + 1, err);
      await sleep(o.backoffMs * Math.pow(2, attempt));
    }
  }
  throw last;
}

/**
 * อัปโหลดไฟล์เป็นชุด — ลดจำนวนคำขอราว 80%
 * แบ่งเป็นก้อนเล็กเพราะ GAS มีเพดานเวลารันต่อครั้ง ยัดมากเกินไปจะ timeout ทั้งก้อน
 * คืนผลรายรายการเสมอ ไม่สรุปรวมว่าสำเร็จทั้งหมด
 */
/**
 * อัปโหลดไฟล์เป็นชุด
 *
 * ต้องส่ง opts.token มาด้วยเสมอ
 * เดิมเรียก apiFetch ตรง ๆ โดยไม่มี token ทำให้เซิร์ฟเวอร์ปฏิเสธทุกคำขอ
 * ด้วยข้อความว่าเซสชันหมดอายุ ทั้งที่ผู้ใช้ยังล็อกอินอยู่
 * ผลคือข้อมูลลง Sheet ได้ (เพราะเส้นทางนั้นใช้ authFetch) แต่ไฟล์ไม่เคยขึ้นเลย
 */
export async function uploadBatch(url, files, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const out = new Map();
  let done = 0;

  if (!o.token) {
    // ล้มเร็วดีกว่าปล่อยให้ทุกคำขอถูกปฏิเสธทีละอัน
    for (const f of files) {
      out.set(f.client_id, { ok: false, url: '',
        message: 'ไม่ได้ส่ง token มาด้วย — เรียก uploadBatch ผิดวิธี' });
    }
    return out;
  }

  /* แบ่งชุดตามขนาดจริง ไม่ใช่จำนวนไฟล์
   *
   * เดิมแบ่งชุดละ 5 ไฟล์ตายตัว
   * เอกสารที่รวมหลายสำเนาไว้ในไฟล์เดียวจะใหญ่กว่าปกติหลายเท่า
   * ชุดหนึ่งอาจโตถึงหลาย MB แล้วส่งไม่ผ่านทั้งชุดพร้อมกัน
   * ซึ่งตรงกับอาการที่ทุกไฟล์ล้มเหลวพร้อมกัน */
  const MAX_CHUNK_BYTES = 1200000;   // ~1.2 MB ต่อคำขอ

  const chunks = [];
  let cur = [], curBytes = 0;
  for (const f of files) {
    const size = (f.image || '').length;
    // ไฟล์เดียวที่ใหญ่เกินเกณฑ์ ต้องส่งเดี่ยว ไม่มีทางเลือกอื่น
    if (cur.length && (curBytes + size > MAX_CHUNK_BYTES || cur.length >= o.uploadChunk)) {
      chunks.push(cur); cur = []; curBytes = 0;
    }
    cur.push(f); curBytes += size;
  }
  if (cur.length) chunks.push(cur);

  const totalBytes = files.reduce((n, f) => n + ((f.image || '').length), 0);
  let sentBytes = 0;

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (o.signal && o.signal.aborted) break;

    /* แจ้งก่อนเริ่มส่งด้วย ไม่ใช่แจ้งเฉพาะตอนชุดเสร็จ
     *
     * ไฟล์จำนวนน้อยอาจมีแค่ 2 ชุด ถ้าแจ้งตอนเสร็จอย่างเดียว
     * จะได้ข้อมูลแค่ 2 จุด ซึ่งประมาณเวลาไม่ทันก่อนงานจะจบ
     * และระหว่างรอชุดแรกจะเงียบสนิทจนดูเหมือนค้าง
     */
    const chunkBytes = chunk.reduce((n, f) => n + ((f.image || '').length), 0);
    if (o.onProgress) {
      o.onProgress(done, files.length, {
        phase: 'start', chunk: ci + 1, chunks: chunks.length,
        sentBytes, totalBytes, chunkBytes
      });
    }

    try {
      const res = await apiFetch(url, {
        action: 'uploadPhotos',
        token: o.token,
        files: chunk.map(f => ({
          client_id: f.client_id,
          barcode: f.barcode,
          ref_no: f.ref_no || f.barcode,
          period: f.period,      // ไม่ส่งไป ไฟล์จะไปลงโฟลเดอร์เดือนปัจจุบันเสมอ
          image: f.image
        }))
      }, { ...o, timeoutMs: o.uploadTimeoutMs });

      for (const r of (res && res.results) || []) {
        out.set(r.client_id, { ok: !!r.url, url: r.url || '',
                               message: r.message || r.note || '' });
      }
      // รายการที่เซิร์ฟเวอร์ไม่ได้ตอบถึง ถือว่ายังไม่สำเร็จ
      for (const f of chunk) {
        if (!out.has(f.client_id)) out.set(f.client_id, { ok: false, url: '', message: 'ไม่มีผลตอบกลับ' });
      }
    } catch (err) {
      for (const f of chunk) out.set(f.client_id, { ok: false, url: '', message: err.message });
    }

    done += chunk.length;
    sentBytes += chunkBytes;
    if (o.onProgress) {
      o.onProgress(done, files.length, {
        phase: 'done', chunk: ci + 1, chunks: chunks.length,
        sentBytes, totalBytes, chunkBytes
      });
    }
  }

  /* ลองซ้ำเฉพาะที่ล้มเหลว โดยส่งทีละไฟล์
   * คำขอเล็กลงมากจึงมีโอกาสผ่านสูงกว่า
   * และ client_id กันไฟล์ซ้ำอยู่แล้ว ส่งซ้ำจึงปลอดภัย */
  const failed = files.filter(f => { const r = out.get(f.client_id); return !r || !r.ok; });
  if (failed.length && failed.length < files.length) {
    for (const f of failed) {
      if (o.signal && o.signal.aborted) break;
      try {
        const res = await apiFetch(url, {
          action: 'uploadPhotos',
          token: o.token,
          files: [{ client_id: f.client_id, barcode: f.barcode,
                    ref_no: f.ref_no || f.barcode, period: f.period, image: f.image }]
        }, { ...o, timeoutMs: o.uploadTimeoutMs });
        for (const r of (res && res.results) || []) {
          if (r.url) out.set(r.client_id, { ok: true, url: r.url, message: r.note || '' });
        }
      } catch (err) { /* ยังไม่ผ่าน ปล่อยผลเดิมไว้ */ }
    }
  }

  return out;
}

/** เช็คว่าข้อมูลอ้างอิงมีเวอร์ชันใหม่ไหม โดยไม่ดึงทั้งก้อน */
export async function checkReferenceVersion(url, opts = {}) {
  return apiFetch(url, { action: 'getCSVVersion' }, { retries: 1, timeoutMs: 10000, ...opts });
}

/**
 * เรียก endpoint แบบ GET ที่มีอยู่เดิม (getCSV, getDashboard, getBatches ฯลฯ)
 * พร้อม timeout และ retry เหมือน apiFetch
 *
 * token ส่งไปทาง query string เพราะ GAS อ่าน header ที่กำหนดเองไม่ได้
 * ข้อแลกเปลี่ยนคือ token จะไปโผล่ใน log ของ Google — ยอมรับได้เพราะ
 * เป็น log ภายในบัญชีเดียวกัน และ token มีอายุจำกัดกับถอนได้
 */
export async function apiGet(url, action, params = {}, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const fetchImpl = o.fetchImpl || fetch;
  const qs = new URLSearchParams({ action, ...params }).toString();
  const full = url + (url.indexOf('?') > -1 ? '&' : '?') + qs;

  let last;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort('timeout'), o.timeoutMs);
    try {
      const res = await fetchImpl(full, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
      if (!res.ok) throw new ApiError('HTTP ' + res.status, 'http', res.status);
      const text = await res.text();

      // บาง endpoint คืนข้อความดิบ ไม่ใช่ JSON — getCSV คืน CSV ตรง ๆ
      if (o.parse === 'text') {
        // แต่ถ้าเซิร์ฟเวอร์ผิดพลาด มันจะคืน JSON แทน
        // ถ้าไม่ตรวจตรงนี้ ตัวอ่าน CSV จะเอา JSON ไปแยกเป็นแถวแล้วได้ข้อมูลขยะ
        // โดยไม่มีใครรู้ว่าผิด ซึ่งอันตรายกว่าขึ้น error ตรง ๆ
        const head = text.slice(0, 200).trim();
        if (head.charAt(0) === '{') {
          try {
            const j = JSON.parse(text);
            if (j && j.status === 'error') {
              throw new ApiError(j.message || 'เซิร์ฟเวอร์แจ้งข้อผิดพลาด', 'app', j);
            }
          } catch (e) { if (e instanceof ApiError) throw e; }
        }
        return text;
      }

      let data;
      try { data = JSON.parse(text); }
      catch { throw new ApiError('ตอบกลับไม่ใช่ JSON', 'app', text.slice(0, 200)); }
      if (data && data.status === 'error') {
        throw new ApiError(data.message || 'เซิร์ฟเวอร์แจ้งข้อผิดพลาด', 'app', data);
      }
      return data;
    } catch (err) {
      if (err instanceof ApiError) last = err;
      else if (err && err.name === 'AbortError') last = new ApiError('หมดเวลารอ', 'timeout');
      else last = new ApiError('ติดต่อเซิร์ฟเวอร์ไม่ได้', 'network', err && err.message);
      if (!last.retryable || attempt === o.retries) break;
      await sleep(o.backoffMs * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
