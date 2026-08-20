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
    // ตัด PMNO ออกแล้วได้เลข Reference เลย ไม่ต้องเทียบรายการอ้างอิง
    barcodeIsRef: true,
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
    // บาร์โค้ดเป็นรหัสภายใน (เช่น B7040F) ต้องเทียบรายการอ้างอิงจึงได้ Reference
    barcodeIsRef: false,
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
    // บาร์โค้ดเป็นรหัสภายใน (เช่น B05EEA) ไม่ใช่เลข T ที่ใช้ตั้งชื่อไฟล์
    barcodeIsRef: false,
    barcode: { x: 0.02, y: 0.83, w: 0.14, h: 0.14 },
    barcodePattern: '^[0-9A-Z]{6}$',
    barcodeStrip: '',
    // กรอบต้องเผื่อความคลาดของการวางกระดาษบนเครื่องสแกน
    // ไฟล์สองชุดที่ทดสอบ เลข T อยู่คนละตำแหน่ง y ต่างกันราว 6% ของหน้า
    // กรอบแคบเกินไปจะตัดตัวเลขขาดครึ่ง กว้างเกินไปจะดูดตัวอักษรข้างเคียงเข้ามา
    ocr: { x: 0.66, y: 0.045, w: 0.28, h: 0.165 },
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
      // ค่าที่คนตั้งเองมีอำนาจเหนือกว่าค่าตั้งต้นเสมอ
      // ระบบต้องไม่ไปหมุนหรือขยับกรอบทับ ไม่งั้นที่ตั้งไว้จะไร้ความหมาย
      if (out[k]) out[k]._custom = true;
    });
  } catch (e) { /* ค่าเสียก็ใช้ค่าเริ่มต้น */ }
  return out;
}

/** ลบค่าที่ตั้งเองของชนิดเดียว กลับไปใช้ค่าตั้งต้น */
export function resetType(key) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  delete saved[key];
  localStorage.setItem(LS_KEY, JSON.stringify(saved));
  return loadTypes();
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

/**
 * เรนเดอร์หน้าเป็น canvas
 *
 * rotate คือ "ส่วนต่างจากมุมเดิมของไฟล์" ไม่ใช่มุมสัมบูรณ์
 *   0   = เหมือนที่เห็นตอนเปิดไฟล์ด้วยโปรแกรมทั่วไป
 *   90  = หมุนจากนั้นไปอีก 90 องศา
 *
 * ทำไมต้องเป็นส่วนต่าง: PDF เก็บมุมของตัวเองไว้ใน /Rotate
 * ถ้าใช้มุมสัมบูรณ์ ไฟล์ที่ฝัง /Rotate 270 จะถูกบังคับให้ตั้งตรงเมื่อเลือก 0
 * ซึ่งเป็นคนละมุมกับที่คนเห็นตอนเปิดไฟล์ แล้วจะงงว่าเลือกไม่หมุนแล้วทำไมยังหมุน
 *
 * กฎเหล็ก: ห้ามคำนวณมุมเองที่อื่น ต้องเรียกฟังก์ชันนี้เท่านั้น
 * เคยมีบั๊กที่หน้าตั้งค่ากับตัวอ่านคำนวณคนละสูตร แล้วกรอบไปครอบผิดที่
 * โดยที่หน้าตัวอย่างดูถูกต้องทุกอย่าง
 */
export async function renderPage(page, dpi, rotate) {
  const rot = (((page.rotate || 0) + (rotate || 0)) % 360 + 360) % 360;
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
/**
 * ตัวเลขที่ OCR มักสับสนกันเอง
 * 8 กับ 9 เป็นคู่ที่พลาดบ่อยที่สุดในฟอนต์ของเอกสารพวกนี้
 * เพราะต่างกันแค่ห่วงล่างซ้ายปิดหรือเปิด ซึ่งหายไปง่ายเมื่อพิมพ์จางหรือสแกนไม่คม
 */
const CONFUSABLE = [
  ['8', '9'], ['8', '0'], ['8', '6'], ['9', '4'],
  ['5', '6'], ['3', '8'], ['1', '7'], ['0', 'D']
];

/** ค่าสองตัวนี้ต่างกันแค่หลักเดียว และหลักนั้นเป็นคู่ที่สับสนกันง่ายไหม */
export function ambiguousPair(a, b) {
  a = String(a); b = String(b);
  if (a === b || a.length !== b.length) return null;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (at >= 0) return null;      // ต่างกันเกินหนึ่งหลัก ไม่ใช่กรณีนี้
    at = i;
  }
  if (at < 0) return null;
  const pair = [a[at], b[at]];
  const hit = CONFUSABLE.some(c =>
    (c[0] === pair[0] && c[1] === pair[1]) || (c[0] === pair[1] && c[1] === pair[0]));
  return hit ? { pos: at, chars: pair } : { pos: at, chars: pair, weak: true };
}

/* สร้างภาพหลายแบบจากหน้าเดียว แล้วให้ OCR อ่านทุกแบบ
   ตัวเลขที่กำกวมจะให้ผลต่างกันตามการปรับภาพ ทำให้จับได้ว่ากำลังสับสน
   ถ้าอ่านแบบเดียวจะได้คำตอบเดียวและดูเหมือนมั่นใจ ทั้งที่อาจผิด */
function imageVariants(cv, level) {
  const out = [{ name: 'raw', canvas: cv }];
  if (level === 'fast') return out;
  // ทดสอบแล้ว raw + otsu พอ ส่วน close/open ไม่ได้เพิ่มความถูกต้อง
  // และเมื่อโหวตข้ามหลายความละเอียดอยู่แล้ว การเพิ่มตัวแปรมีแต่ทำให้ช้าลง

  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, cv.width, cv.height);
  const n = cv.width * cv.height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (src.data[i * 4] * 0.299 + src.data[i * 4 + 1] * 0.587 +
               src.data[i * 4 + 2] * 0.114) | 0;
  }

  // Otsu
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2);
    if (between > best) { best = between; thr = t; }
  }
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = gray[i] > thr ? 0 : 1;   // 1 = หมึก

  out.push({ name: 'otsu', canvas: fromMask(cv, bin) });
  return out;
}

function fromMask(ref, mask) {
  const cv = document.createElement('canvas');
  cv.width = ref.width; cv.height = ref.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(cv.width, cv.height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** ปิดช่องว่างเล็ก ๆ ในเส้น — ช่วยกรณีหาง 9 ขาดจนดูเหมือน 8 */
function morph(mask, w, h) {
  const grow = (inp, expand) => {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = expand ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) { if (!expand) v = 0; continue; }
        const sv = inp[yy * w + xx];
        if (expand) { if (sv) v = 1; } else { if (!sv) v = 0; }
      }
      o[y * w + x] = v;
    }
    return o;
  };
  return grow(grow(mask, true), false);
}

/**
 * อ่านด้วย OCR โดยโหวตข้ามทั้งการปรับภาพและโหมดแบ่งหน้า
 *
 * level 'fast'     ภาพดิบ × 3 โหมด  = 3 ครั้ง
 * level 'accurate' 3 แบบภาพ × 3 โหมด = 9 ครั้ง (ค่าเริ่มต้น)
 *
 * เหตุผลที่ต้องโหวตหลายแบบ ไม่ใช่แค่หลายโหมด
 * ตัวเลขที่กำกวมอย่าง 8 กับ 9 จะให้ผลต่างกันเมื่อปรับภาพต่างกัน
 * ถ้าอ่านแบบเดียวจะได้คำตอบเดียวที่ดูมั่นใจ ทั้งที่อาจผิด
 */
/**
 * ความละเอียดที่ใช้โหวต — สำคัญกว่าที่คิด
 *
 * ทดสอบกับหน้าที่เลข 9 หางขาดจนอ่านเป็น 8
 *   400dpi อย่างเดียว  ได้ 8 (คะแนนเสมอ 3:3 แล้วเลือกผิด)
 *   300dpi             ได้ 9 ถูกทุกโหมด
 *   500dpi             ได้ 9 ถูกทุกโหมด
 *   โหวต 300+400+500   ได้ 9 ชนะขาด 14:4
 *
 * ความละเอียดต่างกันทำให้ขอบตัวอักษรตกลงบนพิกเซลต่างกัน
 * รอยขาดเล็ก ๆ จึงหายไปที่บางความละเอียดและไม่หายที่บางความละเอียด
 * การตรึงไว้ค่าเดียวคือการเดิมพันว่าค่านั้นจะเหมาะกับทุกเอกสาร ซึ่งไม่จริง
 */
const OCR_DPIS = { fast: [400], accurate: [300, 400, 500] };

export async function readOcr(page, type, onProgress, level) {
  if (!type.ocr) return null;
  const worker = await ocrWorker(onProgress);

  const mode = level === 'fast' ? 'fast' : 'accurate';
  const dpis = OCR_DPIS[mode];
  const pattern = safeRegex(type.ocrPattern);
  const votes = [];
  let firstRaw = '', firstConf = 0, cropUrl = '';

  for (const dpi of dpis) {
    const full = await renderPage(page, dpi, type.rotate);
    const region = crop(full, type.ocr);
    full.width = full.height = 0;
    if (!cropUrl) cropUrl = region.toDataURL('image/png');

    const variants = imageVariants(region, mode === 'fast' ? 'fast' : 'full');

    for (const v of variants) {
      for (const psm of ['7', '6', '13']) {
        await worker.setParameters({
          tessedit_char_whitelist: type.ocrWhitelist || '',
          tessedit_pageseg_mode: psm
        });
        const { data } = await worker.recognize(v.canvas);
        const text = (data.text || '').replace(/\s+/g, '');
        const conf = wordConfidence(data);
        if (!firstRaw) { firstRaw = text; firstConf = conf; }
        const value = pattern ? applyTemplate(text.match(pattern), type.ocrTemplate) : text;
        if (value) votes.push({ tag: dpi + '/' + v.name + ':' + psm, value, raw: text, conf });
      }
    }
    variants.forEach(v => { if (v.canvas !== region) { v.canvas.width = v.canvas.height = 0; } });
    region.width = region.height = 0;
  }

  if (!votes.length) {
    return { value: '', raw: firstRaw, conf: firstConf, votes: [], candidates: [],
             disagree: false, ambiguous: null, crop: cropUrl };
  }

  const tally = new Map();
  votes.forEach(v => tally.set(v.value, (tally.get(v.value) || 0) + 1));
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0][0];
  const winner = votes.find(v => v.value === best);

  // ผู้ชนะกับอันดับสองต่างกันแค่หลักเดียวที่สับสนง่ายหรือเปล่า
  /* ตัดสินความกำกวมแบบอนุรักษ์นิยม
   *
   * ถ้ามีการอ่านครั้งใดครั้งหนึ่งให้ผลต่างจากผู้ชนะเพียงหลักเดียว
   * และหลักนั้นเป็นคู่ที่สับสนกันง่าย (เช่น 8 กับ 9) ให้ถือว่ากำกวมทันที
   * ไม่สนว่าผู้ชนะจะได้คะแนนมากกว่าเท่าไหร่
   *
   * เหตุผลจากหลักฐานจริง: หน้าที่หาง 9 ขาด
   *   400dpi ได้ 9 · 600dpi ได้ 8 · โหวตรวมได้ 9 ชนะ 5:3
   * คะแนนที่ชนะไม่ได้แปลว่าถูก มันแค่แปลว่าการปรับภาพส่วนใหญ่เห็นแบบนั้น
   * และเราเคยเห็นแล้วว่าเสียงส่วนใหญ่เลือกผิดได้
   *
   * ต้นทุนของการเตือนเกินคือคนกดเลือกเพิ่มหนึ่งครั้ง
   * ต้นทุนของการปล่อยผ่านคือชื่อไฟล์ผิดโดยไม่มีใครรู้ ซึ่งแพงกว่ามาก
   *
   * ทดสอบกับ 9 หน้าจริง เตือน 2 หน้าที่มีรอยขาดจริง ที่เหลือผ่านเงียบ */
  let ambiguous = null;
  for (let i = 1; i < ranked.length; i++) {
    const amb = ambiguousPair(ranked[0][0], ranked[i][0]);
    if (amb && !amb.weak) {
      ambiguous = { a: ranked[0][0], b: ranked[i][0], pos: amb.pos, chars: amb.chars,
                    votes: [ranked[0][1], ranked[i][1]] };
      break;
    }
  }

  return {
    value: best, raw: winner.raw, conf: winner.conf,
    votes: votes.map(v => v.tag + '=' + v.value),
    candidates: ranked.map(r => ({ value: r[0], n: r[1] })),
    disagree: tally.size > 1,
    ambiguous: ambiguous,
    crop: cropUrl
  };
}

/** tesseract.js คืน confidence ระดับหน้าเป็น 0 บ่อยเมื่อใช้ psm 7 */
function wordConfidence(data) {
  if (data.confidence) return data.confidence;
  const w = (data.words || []).filter(x => x.text && x.text.trim());
  if (!w.length) return 0;
  return Math.round(w.reduce((s, x) => s + (x.confidence || 0), 0) / w.length);
}

/* ---------------- หามุมหมุนที่ถูกต้อง ---------------- */



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
  // ไม่มีการเดามุมแล้ว ใช้มุมและกรอบที่คนกำหนดไว้ตรง ๆ
  // การเดาเคยไปหมุนทับค่าที่คนตั้งไว้ ทำให้กรอบครอบผิดที่แล้วได้เลขผิด
  // ซึ่งแย่กว่าอ่านไม่ได้ เพราะมันดูเหมือนทำงานปกติ
  if (opts.onProgress) {
    opts.onProgress('ใช้มุม ' + (type.rotate || 0) + ' องศา และกรอบที่ตั้งไว้');
  }

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
        res.barcodeValue = res.barcode.value;
        res.value = res.barcode.value;
        res.source = 'barcode';
        if (type.barcodeIsRef) res.refNo = res.barcode.value;
        else res.needsLookup = true;   // ต้องเทียบรายการอ้างอิงจึงได้ Reference
      }
    }

    // ตกมา OCR เมื่อยังไม่ได้เลข Reference
    // รวมกรณีที่อ่านบาร์โค้ดได้แต่บาร์โค้ดนั้นไม่ใช่ Reference
    // (เช่น LOSCAM ที่บาร์โค้ดเป็น B05EEA แต่ต้องการ T9648565)
    if (!res.refNo && type.ocr) {
      try {
        res.ocr = await readOcr(page, type, opts.onProgress, opts.ocrLevel);
        if (res.ocr && res.ocr.value) {
          // OCR อ่านช่อง Reference ตรง ๆ จึงได้เลขที่ใช้ตั้งชื่อไฟล์ทันที
          // เส้นทางนี้ไม่ต้องพึ่งรายการอ้างอิงเลย
          res.value = res.ocr.value;
          res.refNo = res.ocr.value;
          res.source = 'ocr';
          res.needsLookup = false;
        }
      } catch (err) {
        res.ocrError = err.message;
      }
    }

    // ตรวจลายเซ็นและตราประทับ ใช้ภาพความละเอียดต่ำก็พอ เพราะดูแค่ปริมาณหมึกสี
    if (opts.inkRules) {
      try {
        const small = await renderPage(page, 150, type.rotate);
        res.ink = opts.checkInk(small, opts.inkRules);
        small.width = small.height = 0;
      } catch (e) { res.ink = null; }
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
      const d = { value: r.value, refNo: r.refNo || '', barcodeValue: r.barcodeValue || '',
                  needsLookup: !!r.needsLookup, source: r.source, ink: r.ink || null, pages: [r] };
      byValue.set(r.value, d);
      docs.push(d);
    } else {
      docs.push({ value: '', refNo: '', barcodeValue: r.barcodeValue || '',
                  needsLookup: !!r.needsLookup, source: 'manual', ink: r.ink || null, pages: [r] });
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

  // ไม่มีรายการอ้างอิง ยังทำงานต่อได้ แต่ยืนยันความถูกต้องไม่ได้
  const hasRef = csvIndex && typeof csvIndex.has === 'function' && csvIndex.size > 0;
  if (!hasRef) {
    if (doc.needsLookup) {
      return { tier: 'red', reason: 'lookup_unavailable',
               head: 'ได้บาร์โค้ด ' + doc.barcodeValue +
                     ' แต่ไม่มีรายการอ้างอิงให้แปลงเป็นเลข Reference — กรอกเอง' };
    }
    return { tier: 'yellow', reason: 'no_reference_data',
             head: 'ไม่มีรายการอ้างอิงให้ตรวจสอบ — โปรดเทียบกับเอกสารเอง' };
  }

  // อ่านบาร์โค้ดได้แต่ยังแปลงเป็น Reference ไม่ได้
  if (doc.needsLookup && !doc.refNo) {
    return { tier: 'red', reason: 'lookup_failed',
             head: 'บาร์โค้ด ' + doc.barcodeValue + ' ไม่พบในรายการอ้างอิง' };
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

  // ตัวเลขที่สับสนกันง่ายอย่าง 8 กับ 9 ต้องให้คนดูเสมอ
  // แม้ค่าที่ชนะโหวตจะพบในรายการอ้างอิง เพราะอีกค่าหนึ่งก็อาจมีอยู่จริงเช่นกัน
  if (ocr && ocr.ambiguous) {
    return { tier: 'red', reason: 'ambiguous_digit',
             head: 'ตัวเลขหลักที่ ' + (ocr.ambiguous.pos + 1) + ' อ่านได้ทั้ง ' +
                   ocr.ambiguous.chars.join(' และ ') + ' — ' +
                   ocr.ambiguous.a + ' หรือ ' + ocr.ambiguous.b,
             candidates: [ocr.ambiguous.a, ocr.ambiguous.b] };
  }

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
  /* เลขที่ออกเรียงลำดับจะมีเพื่อนบ้านต่างกันหลักเดียวเสมอ
   * ตรวจกับชุดจริง 8 ใบจากลูกค้าเดียวกัน พบว่าทุกใบมีเพื่อนบ้านทั้งหมด
   * ถ้าเตือนทุกใบที่มีเพื่อนบ้าน จะเตือน 100% แล้วคนจะเลิกอ่านคำเตือน
   * ซึ่งแย่กว่าไม่เตือนเลย เพราะตอนที่ควรเตือนจริงก็จะถูกกดผ่านไปด้วย
   *
   * จึงเตือนเฉพาะเมื่อมีเพื่อนบ้าน และการอ่านไม่เป็นเอกฉันท์
   * ถ้าอ่านทุกรอบได้ค่าเดียวกัน ความเสี่ยงชนกันเป็นแค่ทฤษฎี */
  const unanimous = ocr && ocr.candidates && ocr.candidates.length === 1;
  if (risky && !unanimous) {
    return { tier: 'yellow', reason: 'collision_risk',
             head: 'อ่านได้ไม่เป็นเอกฉันท์ และมีเลขต่างกันหลักเดียวในระบบ ควรยืนยันกับเอกสาร' };
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
