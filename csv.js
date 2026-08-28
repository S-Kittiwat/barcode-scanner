// ============================================================
//  DocScan — csv.js
//  อ่านข้อมูลอ้างอิงเอกสาร และใช้เป็นชั้นตรวจสอบความถูกต้อง
//
//  ข้อมูลอ้างอิงชุดนี้เป็นชั้นตรวจสอบที่แข็งที่สุดที่ระบบมี
//  แข็งกว่าการโหวตหลายโหมดของ OCR หรือค่าความเชื่อมั่น เพราะ
//  เลขเอกสารไม่มี check digit ในตัวเอง — รายการอ้างอิงจึงทำหน้าที่นั้นแทน
// ============================================================

/**
 * แยก CSV แบบรองรับฟิลด์ที่มีเครื่องหมายคำพูด
 * ตัวเดิมใช้ text.split(',') ตรง ๆ ซึ่งจะเพี้ยนทั้งแถวถ้าชื่อลูกค้ามี comma
 * เช่น "CP Axtra Co., Ltd." — เคสนี้มีอยู่จริงในข้อมูล
 */
export function parseCSV(text) {
  if (!text) return [];
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let field = '', row = [], inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" = เครื่องหมายคำพูดจริง
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter(r => r.some(v => v.trim() !== ''));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(vals => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (vals[idx] != null ? vals[idx] : '').trim(); });
    return obj;
  });
}

/** ทำ index ไว้ล่วงหน้า — 50 แถวต่อ batch ค้นแบบ linear จะเสียเวลาเปล่า */
/**
 * สร้างดัชนีสำหรับค้นข้อมูลอ้างอิง
 *
 * ต้องใส่ทั้งบาร์โค้ดและเลข Reference เป็นคีย์
 *
 * เดิมใส่แค่บาร์โค้ด พอระบบแปลงบาร์โค้ดเป็นเลข Reference แล้วเอาไปค้นต่อ
 * จึงหาไม่เจอ แล้วรายงานว่า "ไม่พบในรายการอ้างอิง"
 * ทั้งที่เพิ่งหาเจอมาจากบาร์โค้ดตัวเดียวกัน
 */
export function buildIndex(csvData) {
  const map = new Map();
  for (const r of csvData || []) {
    const bc = normKey(r['barcode']);
    if (bc && !map.has(bc)) map.set(bc, r);

    const ref = normKey(r['ref_no']);
    if (ref && !map.has(ref)) map.set(ref, r);
  }
  return map;
}

export function normKey(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

/** ค้นแบบตรงตัว */
export function searchCSV(index, barcode) {
  return index.get(normKey(barcode)) || null;
}

/**
 * ระยะแก้ไขแบบจำกัดเพดาน — สนใจแค่ว่า "ต่างกันไม่เกิน max ตัว" หรือไม่
 * คืน Infinity ทันทีเมื่อเกินเพดาน เพื่อไม่ให้เสียเวลาคำนวณต่อ
 */
export function editDistance(a, b, max = 1) {
  a = normKey(a); b = normKey(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return Infinity;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return Infinity;
    prev = cur;
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}

/**
 * หารายการที่ใกล้เคียง — ใช้เมื่ออ่านค่าได้แต่ไม่พบในรายการอ้างอิง
 * ตัวอย่างจริง: OCR อ่าน T9648558 (หาง 9 ขาด) ไม่พบในรายการ
 * แต่ T9648559 มีอยู่ และต่างกันหลักเดียว → เสนอให้คนยืนยัน
 *
 * คืนเฉพาะกรณีที่มีผู้สมัครเพียงรายเดียว ถ้าใกล้เคียงหลายรายการ
 * ถือว่าคลุมเครือเกินกว่าจะเสนอ ต้องให้คนอ่านจากเอกสารเอง
 */
export function findNearMiss(index, value, maxDistance = 1) {
  const v = normKey(value);
  if (!v) return null;
  if (index.has(v)) return null;

  const hits = [];
  for (const key of index.keys()) {
    if (editDistance(v, key, maxDistance) !== Infinity) {
      hits.push(key);
      if (hits.length > 1) return null;      // คลุมเครือ — ไม่เสนอ
    }
  }
  if (hits.length !== 1) return null;
  return { barcode: hits[0], doc: index.get(hits[0]) };
}

/**
 * มีรายการอื่นในชุดอ้างอิงที่ต่างจากค่านี้แค่ตัวเดียวไหม
 *
 * สำคัญมากสำหรับเลขที่ออกเรียงลำดับ เช่น T9648550/T9648551/T9648559
 * เพราะถ้า OCR อ่านผิดหนึ่งหลัก ค่าที่ได้อาจไป "ตรง" กับเอกสารใบอื่นที่มีอยู่จริง
 * ซึ่งจะผ่านการตรวจแบบค้นตรงตัวไปเงียบ ๆ ทั้งที่เป็นคนละใบ
 */
export function hasCollisionRisk(index, value) {
  const v = normKey(value);
  if (!v) return false;
  for (const key of index.keys()) {
    if (key !== v && editDistance(v, key, 1) !== Infinity) return true;
  }
  return false;
}

/**
 * ยืนยันด้วยสองฟิลด์ที่อ่านมาคนละที่บนเอกสาร
 * ทั้งคู่ต้องชี้ไปที่แถวเดียวกันในชุดอ้างอิง จึงจะถือว่ายืนยันได้
 *
 * นี่คือทางเดียวที่กันความผิดพลาดหนึ่งหลักได้จริง เมื่อเลขเอกสารออกเรียงลำดับ
 * เพราะโอกาสที่ OCR จะอ่านผิดสองที่แล้วบังเอิญไปตรงกับใบเดียวกันนั้นต่ำมาก
 */
export function crossCheck(index, primary, secondary, secondaryField) {
  const a = searchCSV(index, primary);
  if (!a) return { ok: false, reason: 'primary_not_found' };
  if (!secondary) {
    return { ok: false, reason: 'no_secondary',
             risky: hasCollisionRisk(index, primary), doc: a };
  }
  const bVal = normKey(a[secondaryField]);
  if (!bVal) return { ok: false, reason: 'field_missing', doc: a };
  if (bVal === normKey(secondary)) return { ok: true, reason: 'cross_confirmed', doc: a };
  return { ok: false, reason: 'cross_mismatch', doc: a,
           expected: bVal, got: normKey(secondary) };
}

/**
 * ตัดสินความน่าเชื่อถือของค่าที่อ่านได้
 * ลำดับความแข็งของหลักฐาน: ยืนยันสองฟิลด์ > พบในรายการ (ถ้าไม่เสี่ยงชนกัน) > โหวตตรงกัน
 */
export function classify(reading, index, opts = {}) {
  const { value, source, votesDisagree = false, confidence = null } = reading;
  const minConf = opts.minConfidence || 0;

  if (!value) {
    return { tier: 'red', reason: 'no_value', head: 'ระบบอ่านไม่ได้', suggestion: null };
  }

  const doc = searchCSV(index, value);
  if (doc) {
    // ยืนยันได้ด้วยบาร์โค้ด — เครื่องอ่านบาร์โค้ดมี checksum ในตัว ไม่เพี้ยนทีละหลัก
    if (source === 'barcode') {
      return { tier: 'green', reason: 'barcode_in_reference',
               head: 'บาร์โค้ดตรงกับรายการอ้างอิง', doc, suggestion: null };
    }

    // ยืนยันด้วยฟิลด์ที่สอง — แข็งที่สุดสำหรับค่าที่มาจาก OCR
    if (reading.secondary && opts.secondaryField) {
      const x = crossCheck(index, value, reading.secondary, opts.secondaryField);
      if (x.ok) {
        return { tier: 'green', reason: 'cross_confirmed',
                 head: 'ยืนยันตรงกันสองฟิลด์', doc, suggestion: null };
      }
      if (x.reason === 'cross_mismatch') {
        return { tier: 'red', reason: 'cross_mismatch',
                 head: `สองฟิลด์ไม่ตรงกัน — ในระบบเป็น ${x.expected} แต่อ่านได้ ${x.got}`,
                 doc, suggestion: null };
      }
    }

    // ค่าจาก OCR ที่มีเพื่อนบ้านต่างกันหลักเดียวในชุดอ้างอิง
    // การอ่านผิดหนึ่งหลักจะกลายเป็นใบอื่นที่มีอยู่จริง — ต้องให้คนดู
    if (hasCollisionRisk(index, value)) {
      return { tier: 'red', reason: 'collision_risk',
               head: 'พบในรายการ แต่มีเลขใกล้เคียงกันในระบบ — ต้องยืนยันกับเอกสาร',
               doc, suggestion: null };
    }

    if (votesDisagree) {
      return { tier: 'red', reason: 'votes_disagree',
               head: 'พบในรายการ แต่โหมด OCR อ่านไม่ตรงกัน', doc, suggestion: null };
    }
    return { tier: 'green', reason: 'in_reference', head: 'พบในรายการอ้างอิง', doc, suggestion: null };
  }

  const near = findNearMiss(index, value);
  if (near) {
    return {
      tier: 'red', reason: 'near_miss',
      head: 'ไม่พบในรายการ แต่ใกล้เคียงกับ ' + near.barcode,
      suggestion: near.barcode, doc: near.doc
    };
  }

  if (source === 'barcode') {
    return { tier: 'red', reason: 'not_in_reference',
             head: 'บาร์โค้ดอ่านได้แต่ไม่พบในรายการอ้างอิง', suggestion: null };
  }

  if (votesDisagree) {
    return { tier: 'red', reason: 'votes_disagree',
             head: 'โหมด OCR อ่านไม่ตรงกัน และไม่พบในรายการ', suggestion: null };
  }
  if (minConf > 0 && (confidence == null || confidence < minConf)) {
    return { tier: 'red', reason: 'low_confidence',
             head: 'ความเชื่อมั่นต่ำ และไม่พบในรายการ', suggestion: null };
  }
  return { tier: 'red', reason: 'not_in_reference',
           head: 'ไม่พบในรายการอ้างอิง', suggestion: null };
}
