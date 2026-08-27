/**
 * ============================================================
 *  เทมเพลตเอกสาร — ผู้ใช้สร้างและตั้งชื่อเอง
 * ============================================================
 *  เดิมมีชนิดฝังไว้ตายตัวสามชนิด พร้อมกรอบที่ตั้งจากการเดา
 *  ทุกครั้งที่เจอเอกสารแบบใหม่ต้องรอแก้โค้ด
 *  และค่าที่เดาไว้ผิดบ่อยจนต้องมาไล่แก้ทีหลังหลายรอบ
 *
 *  เทมเพลตเก็บทุกอย่างที่ทำให้อ่านเอกสารชนิดหนึ่งได้
 *  กรอบ มุม รูปแบบเลข และกฎตรวจลายเซ็น อยู่ในที่เดียวกัน
 * ============================================================
 */

const KEY = 'docscan.templates.v1';

/** โครงของเทมเพลตหนึ่งอัน */
export function blankTemplate(name) {
  return {
    id: 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || 'เทมเพลตใหม่',
    createdAt: new Date().toISOString(),

    rotate: 0,          // มุมหน้า เป็นส่วนต่างจากมุมที่ไฟล์ฝังมา
    cropRotate: 'auto', // มุมข้อความในกรอบ

    barcode: null,      // กรอบบาร์โค้ด
    barcodePattern: '', // รูปแบบบาร์โค้ดที่ยอมรับ
    barcodeIsRef: false,// บาร์โค้ดคือเลขเอกสารเองหรือไม่

    ocr: null,          // กรอบเลขที่เอกสาร
    ocrPattern: '',
    ocrValidate: '',
    ocrTemplate: '$1',
    ocrWhitelist: '',
    samples: [],        // เลขตัวอย่างที่ใช้สร้างรูปแบบ
    ocrHeads: null,     // { ความยาว: สองหลักแรก } เรียนจากตัวอย่าง

    signature: null,    // กรอบลายเซ็น พร้อมเกณฑ์
    stamp: null         // กรอบตราประทับ
  };
}

export function loadTemplates() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

export function saveTemplates(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list || []));
    return true;
  } catch (e) {
    console.error('[DocScan] บันทึกเทมเพลตไม่สำเร็จ', e);
    return false;
  }
}

export function getTemplate(id) {
  return loadTemplates().filter(t => t.id === id)[0] || null;
}

/** เพิ่มหรือแก้ไข คืนรายการใหม่ทั้งหมด */
export function upsertTemplate(tpl) {
  const list = loadTemplates();
  const i = list.findIndex(t => t.id === tpl.id);
  if (i >= 0) list[i] = tpl; else list.push(tpl);
  saveTemplates(list);
  return list;
}

export function removeTemplate(id) {
  const list = loadTemplates().filter(t => t.id !== id);
  saveTemplates(list);
  return list;
}

/** ชื่อซ้ำกันจะทำให้เลือกผิดโดยไม่รู้ตัว */
export function nameTaken(name, exceptId) {
  const n = String(name || '').trim().toLowerCase();
  return loadTemplates().some(t =>
    t.id !== exceptId && String(t.name).trim().toLowerCase() === n);
}

/**
 * แปลงเทมเพลตเป็นรูปแบบที่ตัวอ่านใช้
 * ตัวอ่านไม่ต้องรู้จักเทมเพลต แค่รับค่าที่ต้องใช้
 */
export function toReaderType(tpl) {
  if (!tpl) return null;
  return {
    name: tpl.name,
    rotate: tpl.rotate || 0,
    cropRotate: tpl.cropRotate === undefined ? 'auto' : tpl.cropRotate,
    barcode: tpl.barcode || null,
    barcodePattern: tpl.barcodePattern || '',
    barcodeIsRef: !!tpl.barcodeIsRef,
    barcodeStrip: '',
    ocr: tpl.ocr || null,
    ocrPattern: tpl.ocrPattern || '',
    ocrValidate: tpl.ocrValidate || '',
    ocrTemplate: tpl.ocrTemplate || '$1',
    ocrWhitelist: tpl.ocrWhitelist || '',
    // ชุดนำหน้าที่เรียนจากตัวอย่าง ใช้แก้เลขที่ OCR อ่านหลักแรกผิด
    ocrHeads: tpl.ocrHeads || null,
    _tplId: tpl.id
  };
}

/** กฎตรวจหมึกของเทมเพลต — ไม่มีกรอบ = ไม่ตรวจ */
export function toInkRules(tpl) {
  if (!tpl) return null;
  const r = {};
  if (tpl.signature && tpl.signature.region) r.signature = tpl.signature;
  if (tpl.stamp && tpl.stamp.region) r.stamp = tpl.stamp;
  return Object.keys(r).length ? r : null;
}

/**
 * ย้ายค่าที่ตั้งไว้เดิมมาเป็นเทมเพลต ทำครั้งเดียว
 *
 * ต้องไม่ทิ้งของเก่า เพราะรูปแบบเลขและกฎแก้เลขของ LOSCAM
 * เป็นความรู้ที่ได้จากการไล่แก้กับเอกสารจริงหลายรอบ
 */
export function migrateFromTypes(oldTypes, oldInkRules) {
  if (loadTemplates().length) return { migrated: 0, skipped: true };

  const LABEL = {
    cmd: 'BRS CMD',
    pcd: 'BRS ECD (PCD)',
    loscam: 'LOSCAM'
  };

  const list = [];
  Object.keys(oldTypes || {}).forEach(key => {
    const t = oldTypes[key];
    if (!t || key === 'auto') return;

    const ink = (oldInkRules || {})[key] || {};
    const tpl = blankTemplate(LABEL[key] || t.name || key);
    tpl.legacyKey = key;              // ไว้อ้างอิงย้อนหลังถ้าจำเป็น
    tpl.rotate = t.rotate || 0;
    tpl.cropRotate = t.cropRotate === undefined ? 'auto' : t.cropRotate;
    tpl.barcode = t.barcode || null;
    tpl.barcodePattern = t.barcodePattern || '';
    tpl.barcodeIsRef = !!t.barcodeIsRef;
    tpl.ocr = t.ocr || null;
    tpl.ocrPattern = t.ocrPattern || '';
    tpl.ocrValidate = t.ocrValidate || '';
    tpl.ocrTemplate = t.ocrTemplate || '$1';
    tpl.ocrWhitelist = t.ocrWhitelist || '';
    if (ink.signature && ink.signature.region) tpl.signature = ink.signature;
    if (ink.stamp && ink.stamp.region) tpl.stamp = ink.stamp;
    list.push(tpl);
  });

  if (list.length) saveTemplates(list);
  return { migrated: list.length, skipped: false, list };
}
