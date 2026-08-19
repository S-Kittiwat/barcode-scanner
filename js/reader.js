// ============================================================
//  DocScan — reader.js
//  อ่านเลขที่เอกสารจากหน้า PDF ด้วยบาร์โค้ดก่อน ถ้าไม่ได้ค่อย OCR
//
//  ค่าทั้งหมดในไฟล์นี้มาจากการทดสอบกับเอกสารจริง ไม่ใช่การเดา
//    บาร์โค้ดทุกชนิดในระบบเป็น Code 39
//    dpi ขั้นต่ำที่อ่าน PMNO ได้เสถียรคือ 180-200 · 400/600 ไม่ช่วยอะไรเพิ่ม
//    LOSCAM ในไฟล์ตัวอย่างชุดหนึ่งอ่านบาร์โค้ดไม่ได้เลย (แท่งคดจากกระดาษยับ)
//      แต่ขึ้นกับคุณภาพการสแกน จึงต้องลองบาร์โค้ดก่อนเสมอ แล้วค่อยตกไป OCR
//    OCR ต้องโหวตหลาย PSM ไม่งั้นพลาดหน้าที่ตัวเลขมีรอยขาด
//    การขยายภาพก่อน OCR ทำให้แย่ลง ไม่ใช่ดีขึ้น
//
//  ข้อควรระวังที่แพงที่สุด
//    เลข T ของ LOSCAM ออกเรียงลำดับ อ่านผิดหนึ่งหลักจะไปตรงกับใบอื่นที่มีอยู่จริง
//    จึงต้องเช็คกับรายการอ้างอิงและเตือนเมื่อมีเลขใกล้เคียงกัน
// ============================================================

/* ---------------- ชนิดเอกสาร ---------------- */

/**
 * พิกัดเป็นสัดส่วนของหน้า (0-1) หลังหมุนตาม rotate แล้ว
 * วัดจากไฟล์ตัวอย่างจริง ผู้ใช้แก้เองได้จากหน้าจอ แล้วเก็บทับใน localStorage
 */
export const DOC_TYPES = {
  auto: {
    name: 'ตรวจอัตโนมัติ',
    hint: 'ให้ระบบเดาชนิดจากบาร์โค้ดที่อ่านได้'
  },
  cmd: {
    name: 'BRS — เอกสารการโอน (CMD)',
    rotate: 0,
    barcode: { x: 0.58, y: 0.060, w: 0.37, h: 0.090 },
    barcodePattern: '^PMNO\\d{9}$',
    barcodeStrip: '^PMNO',
    ocr: { x: 0.45, y: 0.128, w: 0.20, h: 0.042 },
    ocrWhitelist: '0123456789',
    ocrPattern: '(26\\d{7})',
    ocrTemplate: '$1'
  },
  pcd: {
    name: 'BRS — Pallet Control Docket (ECD)',
    rotate: 270,
    barcode: { x: 0.11, y: 0.685, w: 0.22, h: 0.100 },
    barcodePattern: '^[0-9A-Z]{6}$',
    barcodeStrip: '',
    ocr: { x: 0.17, y: 0.222, w: 0.16, h: 0.070 },
    ocrWhitelist: '0123456789',
    ocrPattern: '(26\\d{7})',
    ocrTemplate: '$1'
  },
  loscam: {
    name: 'LOSCAM — Equipment Control Docket',
    rotate: 270,
    barcode: { x: 0.02, y: 0.83, w: 0.14, h: 0.14 },
    barcodePattern: '^[0-9A-Z]{6}$',
    barcodeStrip: '',
    ocr: { x: 0.68, y: 0.055, w: 0.25, h: 0.095 },
    ocrWhitelist: 'T0123456789',
    ocrPattern: '[T1Il|]?\\s?(9\\d{6})',
    ocrTemplate: 'T$1'
    // ไม่ตั้ง barcodeUnreliable — คุณภาพการสแกนต่างกันได้
    // ไฟล์ตัวอย่างชุดหนึ่งอ่านไม่ได้เลย แต่เครื่องสแกนอื่นหรือกระดาษที่ไม่ยับอาจอ่านได้
    // ระบบจะลองบาร์โค้ดก่อนเสมอ แล้วค่อยตกไป OCR ถ้าไม่ได้
  }
};

const LS_KEY = 'docScanDocTypes';

/** โหลดพิกัดที่ผู้ใช้แก้เอง มาทับค่าเริ่มต้น */
export function loadTypes() {
  const out = JSON.parse(JSON.stringify(DOC_TYPES));
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.keys(saved).forEach(k => {
      if (out[k]) Object.assign(out[k], saved[k]);
      else out[k] = saved[k];
    });
  } catch (e) { /* ค่าเสียก็ใช้ค่าเริ่มต้น */ }
  return out;
}

export function saveType(key, patch) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  saved[key] = Object.assign({}, saved[key] || {}, patch);
  localStorage.setItem(LS_KEY, JSON.stringify(saved));
  return loadTypes();
}

export function resetTypes() {
  localStorage.removeItem(LS_KEY);
  return loadTypes();
}

/* ---------------- เอนจิน ---------------- */

let _zxing = null, _ocr = null, _ocrLoading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('โหลดไลบรารีไม่สำเร็จ: ' + src));
    document.head.appendChild(s);
  });
}

async function zxing() {
  if (_zxing) return _zxing;
  if (!window.ZXingWASM) {
    await loadScript('https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.14/dist/iife/reader/index.js');
  }
  _zxing = window.ZXingWASM;
  return _zxing;
}

/**
 * tesseract.js โหลดครั้งแรกราว 10-15 MB จึงโหลดเฉพาะตอนจำเป็น
 * ถ้าเอกสารทั้งชุดอ่านบาร์โค้ดได้หมด จะไม่โหลดเลย
 */
export async function ocrWorker(onProgress) {
  if (_ocr) return _ocr;
  if (_ocrLoading) return _ocrLoading;

  _ocrLoading = (async () => {
    if (!window.Tesseract) {
      onProgress && onProgress('กำลังโหลดเอนจิน OCR ครั้งแรก อาจใช้เวลาสักครู่');
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    }
    onProgress && onProgress('กำลังเตรียมข้อมูลภาษา');
    _ocr = await window.Tesseract.createWorker('eng', 1);
    return _ocr;
  })();
  return _ocrLoading;
}

export function ocrReady() { return !!_ocr; }

export async function releaseOcr() {
  if (_ocr) { try { await _ocr.terminate(); } catch (e) {} }
  _ocr = null; _ocrLoading = null;
}

/* ---------------- เรนเดอร์และตัดภาพ ---------------- */

async function renderPage(page, dpi, rotate) {
  const rot = ((page.rotate || 0) + (rotate || 0) + 360) % 360;
  const vp = page.getViewport({ scale: dpi / 72, rotation: rot });
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width);
  cv.height = Math.floor(vp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return cv;
}

function crop(cv, r) {
  if (!r) return cv;
  const x = Math.max(0, Math.floor(r.x * cv.width));
  const y = Math.max(0, Math.floor(r.y * cv.height));
  const w = Math.max(4, Math.min(cv.width - x, Math.ceil(r.w * cv.width)));
  const h = Math.max(4, Math.min(cv.height - y, Math.ceil(r.h * cv.height)));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d', { willReadFrequently: true })
     .drawImage(cv, x, y, w, h, 0, 0, w, h);
  return out;
}

function imageData(cv) {
  return cv.getContext('2d', { willReadFrequently: true })
           .getImageData(0, 0, cv.width, cv.height);
}

function safeRegex(s) { try { return s ? new RegExp(s) : null; } catch (e) { return null; } }

function applyTemplate(match, tpl) {
  if (!match) return '';
  if (!tpl) return match[0];
  return tpl.replace(/\$(\d)/g, (_, d) => (match[+d] != null ? match[+d] : ''));
}

/* ---------------- อ่านบาร์โค้ด ---------------- */

/**
 * ไล่ dpi 200 → 300 เท่านั้น
 * ทดสอบแล้ว 400/600 ไม่ได้ผลเพิ่ม มีแต่ทำให้ช้าลง
 */
export async function readBarcode(page, type) {
  const Z = await zxing();
  const pattern = safeRegex(type.barcodePattern);
  const opts = {
    tryHarder: true, tryRotate: true, tryInvert: true,
    maxNumberOfSymbols: 8, formats: ['Code39']
  };

  for (const dpi of [200, 300]) {
    const full = await renderPage(page, dpi, type.rotate);
    let found = [];

    // ลองในกรอบก่อน เร็วกว่าและตัดบาร์โค้ดตัวอื่นในหน้าออก
    if (type.barcode) {
      const c = crop(full, type.barcode);
      try { found = await Z.readBarcodes(imageData(c), opts); } catch (e) { found = []; }
      if (c !== full) { c.width = c.height = 0; }
    }
    if (!found.length) {
      try { found = await Z.readBarcodes(imageData(full), opts); } catch (e) { found = []; }
    }
    full.width = full.height = 0;

    if (found.length) {
      const texts = found.map(r => r.text);
      // หน้าเดียวมีหลายบาร์โค้ด ต้องเลือกตัวที่ตรงรูปแบบ ไม่ใช่ตัวแรก
      const hit = pattern ? found.find(r => pattern.test(r.text)) : found[0];
      if (hit) {
        let v = hit.text;
        const strip = safeRegex(type.barcodeStrip);
        if (strip) v = v.replace(strip, '');
        return { value: v, raw: hit.text, all: texts, dpi, matched: true };
      }
      return { value: '', raw: found[0].text, all: texts, dpi, matched: false };
    }
  }
  return { value: '', raw: '', all: [], dpi: null, matched: false };
}

/* ---------------- อ่านด้วย OCR ---------------- */

/**
 * โหวตข้าม PSM 7 / 6 / 13
 * ทดสอบแล้วโหมดเดียวพลาดหน้าที่ตัวเลขมีรอยขาด แต่โหวตแล้วได้ครบ
 * และเมื่อโหมดไม่ตรงกัน นั่นคือสัญญาณว่าหน้านั้นควรให้คนดู
 */
export async function readOcr(page, type, onProgress) {
  if (!type.ocr) return null;
  const worker = await ocrWorker(onProgress);

  const full = await renderPage(page, 400, type.rotate);
  const region = crop(full, type.ocr);
  full.width = full.height = 0;

  const cropUrl = region.toDataURL('image/png');
  const pattern = safeRegex(type.ocrPattern);
  const votes = [];
  let firstRaw = '', firstConf = 0;

  for (const psm of ['7', '6', '13']) {
    await worker.setParameters({
      tessedit_char_whitelist: type.ocrWhitelist || '',
      tessedit_pageseg_mode: psm
    });
    const { data } = await worker.recognize(region);
    const text = (data.text || '').replace(/\s+/g, '');
    const conf = wordConfidence(data);
    if (!firstRaw) { firstRaw = text; firstConf = conf; }

    const value = pattern ? applyTemplate(text.match(pattern), type.ocrTemplate) : text;
    if (value) votes.push({ psm, value, raw: text, conf });
  }
  region.width = region.height = 0;

  if (!votes.length) {
    return { value: '', raw: firstRaw, conf: firstConf, votes: [],
             disagree: false, crop: cropUrl };
  }

  const tally = new Map();
  votes.forEach(v => tally.set(v.value, (tally.get(v.value) || 0) + 1));
  let best = votes[0].value, bestN = tally.get(best);
  votes.forEach(v => { const n = tally.get(v.value); if (n > bestN) { best = v.value; bestN = n; } });
  const winner = votes.find(v => v.value === best);

  return {
    value: best, raw: winner.raw, conf: winner.conf,
    votes: votes.map(v => v.psm + ':' + v.value),
    disagree: tally.size > 1, crop: cropUrl
  };
}

/** tesseract.js คืน confidence ระดับหน้าเป็น 0 บ่อยเมื่อใช้ psm 7 */
function wordConfidence(data) {
  if (data.confidence) return data.confidence;
  const w = (data.words || []).filter(x => x.text && x.text.trim());
  if (!w.length) return 0;
  return Math.round(w.reduce((s, x) => s + (x.confidence || 0), 0) / w.length);
}

/* ---------------- ตรวจชนิดอัตโนมัติ ---------------- */

/**
 * เดาชนิดจากบาร์โค้ดที่อ่านได้ในหน้าแรก ๆ
 * LOSCAM อ่านบาร์โค้ดไม่ได้เลย จึงใช้ "อ่านไม่ได้" เป็นตัวบ่งชี้
 */
export async function detectType(pdfJs, types, sampleN = 3) {
  const n = Math.min(sampleN, pdfJs.numPages);
  const probe = { ...types.cmd, barcode: null, rotate: 0 };  // อ่านทั้งหน้า ไม่จำกัดกรอบ

  for (let p = 1; p <= n; p++) {
    const page = await pdfJs.getPage(p);
    const r = await readBarcode(page, { ...probe, barcodePattern: '' });
    page.cleanup();
    if (!r.all.length) continue;
    if (r.all.some(t => /^PMNO\d{9}$/.test(t))) return 'cmd';
    if (r.all.some(t => /^[0-9A-F]{6}$/i.test(t))) return 'pcd';
  }
  return 'loscam';   // อ่านบาร์โค้ดไม่ได้ = น่าจะ LOSCAM
}

/* ---------------- อ่านทั้งไฟล์ ---------------- */

/**
 * อ่านทุกหน้าแล้วคืนผลรายหน้า
 * onPage เรียกทุกหน้าเพื่ออัปเดตหน้าจอระหว่างทาง ผู้ใช้จะได้ไม่รู้สึกว่าค้าง
 */
export async function readAllPages(pdfJs, type, opts = {}) {
  const results = [];
  for (let p = 1; p <= pdfJs.numPages; p++) {
    if (opts.signal && opts.signal.aborted) break;
    const page = await pdfJs.getPage(p);
    const res = { page: p, value: '', source: 'manual', barcode: null, ocr: null };

    // ลองบาร์โค้ดก่อนเสมอ ยกเว้นผู้ใช้สั่งข้ามเอง
    // เอกสารชนิดเดียวกันอาจอ่านได้หรือไม่ได้ ขึ้นกับคุณภาพการสแกนแต่ละครั้ง
    if (!opts.skipBarcode) {
      res.barcode = await readBarcode(page, type);
      if (res.barcode.matched && res.barcode.value) {
        res.value = res.barcode.value;
        res.source = 'barcode';
      }
    }

    // ตกมา OCR เมื่อบาร์โค้ดอ่านไม่ได้หรืออ่านได้แต่ไม่ตรงรูปแบบ
    if (!res.value && type.ocr) {
      try {
        res.ocr = await readOcr(page, type, opts.onProgress);
        if (res.ocr && res.ocr.value) { res.value = res.ocr.value; res.source = 'ocr'; }
      } catch (err) {
        res.ocrError = err.message;
      }
    }

    page.cleanup();
    results.push(res);
    if (opts.onPage) opts.onPage(res, p, pdfJs.numPages);
    await new Promise(r => setTimeout(r, 0));   // ปล่อยให้หน้าจอวาดใหม่
  }
  return results;
}

/* ---------------- จัดกลุ่มหน้าเป็นเอกสาร ---------------- */

/**
 * หน้าที่อ่านได้เลขเดียวกัน = เอกสารใบเดียวกัน (เช่น CMD ที่มีสำเนา 3 ชุด)
 * หน้าที่อ่านไม่ได้ ให้แยกเป็นใบของตัวเอง เพราะเดาไม่ได้ว่าควรอยู่กับใคร
 *
 * ต้องรักษาลำดับหน้าเดิมไว้ ไม่งั้นสำเนาจะสลับหน้ากัน
 */
export function groupPages(results) {
  const docs = [];
  const byValue = new Map();

  results.forEach(r => {
    if (r.value) {
      if (byValue.has(r.value)) {
        byValue.get(r.value).pages.push(r);
        return;
      }
      const d = { value: r.value, source: r.source, pages: [r] };
      byValue.set(r.value, d);
      docs.push(d);
    } else {
      docs.push({ value: '', source: 'manual', pages: [r] });
    }
  });

  return docs;
}

/* ---------------- แบ่งชั้นความเชื่อมั่น ---------------- */

/**
 * ตัดสินว่าใบไหนคนต้องดู
 * ลำดับความแข็งของหลักฐาน: บาร์โค้ด > พบในรายการอ้างอิง > โหวตตรงกัน
 *
 * เลขที่ออกเรียงลำดับอย่าง T9648550/T9648551 อันตรายเป็นพิเศษ
 * เพราะอ่านผิดหนึ่งหลักจะไปตรงกับใบอื่นที่มีอยู่จริงแล้วผ่านไปเงียบ ๆ
 */
export function classifyDoc(doc, csvIndex, helpers) {
  if (!doc.value) {
    return { tier: 'red', reason: 'no_value', head: 'ระบบอ่านไม่ได้ ต้องกรอกเอง' };
  }

  const found = helpers && helpers.searchCSV ? helpers.searchCSV(csvIndex, doc.value) : null;
  const risky = helpers && helpers.hasCollisionRisk
    ? helpers.hasCollisionRisk(csvIndex, doc.value) : false;

  if (doc.source === 'barcode') {
    return found
      ? { tier: 'green', reason: 'barcode_in_reference', head: 'บาร์โค้ดตรงกับรายการอ้างอิง' }
      : { tier: 'red', reason: 'not_in_reference', head: 'อ่านบาร์โค้ดได้แต่ไม่พบในรายการ' };
  }

  const ocr = doc.pages[0] && doc.pages[0].ocr;
  if (ocr && ocr.disagree) {
    return { tier: 'red', reason: 'votes_disagree',
             head: 'โหมด OCR อ่านไม่ตรงกัน — ' + (ocr.votes || []).join('  ') };
  }
  if (!found) {
    const near = helpers && helpers.findNearMiss
      ? helpers.findNearMiss(csvIndex, doc.value) : null;
    return near
      ? { tier: 'red', reason: 'near_miss', suggestion: near.barcode,
          head: 'ไม่พบในรายการ แต่ใกล้เคียงกับ ' + near.barcode }
      : { tier: 'red', reason: 'not_in_reference', head: 'ไม่พบในรายการอ้างอิง' };
  }
  if (risky) {
    return { tier: 'yellow', reason: 'collision_risk',
             head: 'พบในรายการ แต่มีเลขใกล้เคียงกันในระบบ ควรยืนยันกับเอกสาร' };
  }
  return { tier: 'green', reason: 'ocr_in_reference', head: 'OCR ตรงกับรายการอ้างอิง' };
}

/** สุ่มแบบคงที่ เพื่อวัดว่าใบที่ปล่อยผ่านถูกจริงไหม */
export function sampleFlag(key, ratePct) {
  if (!ratePct) return false;
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100 < ratePct;
}
