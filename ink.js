// ============================================================
//  DocScan — ink.js
//  ตรวจว่าเอกสารมีลายเซ็นและตราประทับหรือไม่
//
//  ทำไมต้องมี
//   POD ที่ไม่มีลายเซ็นหรือตราประทับใช้เป็นหลักฐานไม่ได้
//   ถ้าจับได้ตอนสแกน กระดาษยังอยู่ในมือ กลับไปขอเซ็นได้
//   ถ้ารู้ตอนที่มีคนมาขอดูสามเดือนให้หลัง ก็สายเกินแก้
//
//  ขอบเขตที่ต้องเข้าใจให้ตรงกัน
//   ตัวนี้บอกได้แค่ว่า "มีหมึกในบริเวณที่ควรมี" ไม่ได้บอกว่า
//   ลายเซ็นเป็นของคนที่มีอำนาจจริงไหม หรือตราประทับเป็นของบริษัทที่ถูกต้องไหม
//   เป็นตัวกรองเบื้องต้นเพื่อลดงานตรวจ ไม่ใช่ตัวตัดสินความถูกต้อง
//
//  ค่าที่ใช้มาจากการวัดเอกสารจริง
//   LOSCAM  ตราแดง 0.45-0.75% ของหน้า · ลายเซ็นน้ำเงิน 0.56-0.73%
//   CMD/ECD ไม่มีตราแดงเลย (0.00%) มีแต่ลายเซ็นน้ำเงิน 0.68-0.83%
//   จึงตั้งเกณฑ์แยกตามชนิดเอกสาร ใช้ค่าเดียวกันทุกชนิดไม่ได้
//
//  บทเรียนจากการวัด: ห้ามนับพิกเซลสีเข้มเป็น "หมึก"
//   ตัวพิมพ์ในฟอร์มทำให้ได้ 25-30% ทั้งที่ยังไม่มีใครเซ็น
//   ต้องนับเฉพาะหมึกสี (แดง/น้ำเงิน) ซึ่งมีเฉพาะตอนคนเขียนหรือประทับจริง
//
//  ข้อจำกัดที่ยังแก้ไม่ได้: ถ้าเซ็นด้วยปากกาสีดำ ระบบจะแยกจากตัวพิมพ์ไม่ออก
//   จึงตรวจไม่เจอ กรณีนี้ต้องพึ่งคนดู
// ============================================================

/**
 * ต้องมีอะไรบ้างในเอกสารแต่ละชนิด
 * region เป็นสัดส่วนของหน้า (0-1) หลังหมุนแล้ว
 * min คือสัดส่วนพิกเซลขั้นต่ำในบริเวณนั้น
 */
export const INK_RULES = {
  loscam: {
    /* พิกัดวัดจากเอกสารจริง 40 หน้า
     * ตราประทับอยู่กลางฟอร์ม ค่ากลาง 4.66% ต่ำสุด 0.41%
     * ลายเซ็นผู้รับอยู่ขวาล่างของฟอร์ม ค่ากลาง 1.41% ต่ำสุด 0.34%
     *
     * เกณฑ์ตั้งต่ำกว่าค่าต่ำสุดที่วัดได้เล็กน้อย
     * เพราะพลาดแล้วให้คนยืนยันเอง ดีกว่าปล่อยผ่านเอกสารที่ไม่มีตราจริง
     */
    stamp:     { region: { x: 0.28, y: 0.13, w: 0.44, h: 0.29 },
                 min: 0.35, label: 'ตราประทับ' },
    signature: { region: { x: 0.72, y: 0.28, w: 0.27, h: 0.14 },
                 min: 0.30, label: 'ลายเซ็นผู้รับ' }
  },
  cmd: {
    // วัดแล้วไม่มีตราแดงเลย จึงตรวจเฉพาะลายเซ็น
    signature: { region: { x: 0.00, y: 0.55, w: 1.00, h: 0.45 }, min: 0.3, label: 'ลายเซ็น' }
  },
  pcd: {
    signature: { region: { x: 0.00, y: 0.55, w: 1.00, h: 0.45 }, min: 0.3, label: 'ลายเซ็น' }
  }
};

const LS_KEY = 'docScanInkRules';

export function loadRules() {
  const out = JSON.parse(JSON.stringify(INK_RULES));
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.keys(saved).forEach(k => { out[k] = Object.assign(out[k] || {}, saved[k]); });
  } catch (e) { /* ค่าเสียก็ใช้ค่าเริ่มต้น */ }
  return out;
}

export function saveRules(typeKey, patch) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  saved[typeKey] = Object.assign(saved[typeKey] || {}, patch);
  localStorage.setItem(LS_KEY, JSON.stringify(saved));
  return loadRules();
}

export function resetRules() {
  localStorage.removeItem(LS_KEY);
  return loadRules();
}

/* ---------------- ตรวจจับหมึก ---------------- */

/**
 * นับพิกเซลตามชนิดหมึกในบริเวณที่กำหนด
 *
 * เกณฑ์สีมาจากการวัดจริง ไม่ใช่ค่ามาตรฐานทั่วไป
 *   แดง    r เด่นกว่า g และ b อย่างน้อย 45 ระดับ
 *   น้ำเงิน b เด่นกว่า r อย่างน้อย 35 ระดับ
 * ต้องเผื่อขนาดนี้เพราะหมึกบนกระดาษสแกนซีดกว่าสีจริงมาก
 */
/** ตัดภาพในกรอบออกมาเป็น data URL ไว้ให้คนตรวจว่าระบบดูตรงไหน */
export function cropRegion(canvas, region, maxW) {
  // ภาพเป็นของประกอบ ถ้าสร้างไม่ได้ต้องไม่ทำให้การตรวจหมึกล้มไปด้วย
  if (typeof document === 'undefined' || !canvas.getContext) return '';
  try {
    return cropRegionInner(canvas, region, maxW);
  } catch (e) { return ''; }
}

function cropRegionInner(canvas, region, maxW) {
  const x = region ? Math.max(0, Math.floor(region.x * canvas.width)) : 0;
  const y = region ? Math.max(0, Math.floor(region.y * canvas.height)) : 0;
  const w = region
    ? Math.max(1, Math.min(canvas.width - x, Math.ceil(region.w * canvas.width)))
    : canvas.width;
  const h = region
    ? Math.max(1, Math.min(canvas.height - y, Math.ceil(region.h * canvas.height)))
    : canvas.height;

  const scale = maxW && w > maxW ? maxW / w : 1;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/jpeg', 0.7);
  out.width = out.height = 0;
  return url;
}

export function measureInk(canvas, region) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x = region ? Math.max(0, Math.floor(region.x * canvas.width)) : 0;
  const y = region ? Math.max(0, Math.floor(region.y * canvas.height)) : 0;
  const w = region
    ? Math.max(1, Math.min(canvas.width - x, Math.ceil(region.w * canvas.width)))
    : canvas.width;
  const h = region
    ? Math.max(1, Math.min(canvas.height - y, Math.ceil(region.h * canvas.height)))
    : canvas.height;

  const d = ctx.getImageData(x, y, w, h).data;
  const n = w * h;
  let red = 0, blue = 0, dark = 0;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 90 && r - g > 45 && r - b > 45) red++;
    else if (b > 70 && b - r > 35 && b - g > 18) blue++;
    else if (r < 110 && g < 110 && b < 110) dark++;
  }

  return {
    red: red / n * 100,
    blue: blue / n * 100,
    dark: dark / n * 100,
    // เดิมนับ blue + dark เป็น "หมึก" ซึ่งผิด
    // เพราะ dark รวมตัวพิมพ์ในฟอร์มด้วย วัดแล้วได้ 25-30% ทั้งที่ยังไม่มีใครเซ็น
    // ฟอร์มเปล่าจึงจะผ่านเกณฑ์ ซึ่งทำให้การตรวจไร้ความหมาย
    // ตอนนี้นับเฉพาะหมึกสี ซึ่งมีเฉพาะตอนคนเขียนหรือประทับจริง
    ink: (red + blue) / n * 100,
    pixels: n
  };
}

/**
 * ตรวจหน้าหนึ่งว่ามีลายเซ็นและตราประทับครบไหม
 *
 * ตราประทับดูจากหมึกแดงเท่านั้น เพราะตราของลูกค้าทุกรายที่เจอเป็นสีแดง
 * ส่วนลายเซ็นดูจากหมึกน้ำเงินหรือดำ เพราะคนเซ็นด้วยปากกาอะไรก็ได้
 */
export function checkPage(canvas, rules) {
  if (!rules) return { checks: [], missing: [], ok: true };

  const checks = [];
  Object.keys(rules).forEach(key => {
    const rule = rules[key];
    if (!rule) return;
    // ไม่ระบุพื้นที่ = ตรวจทั้งหน้า
    // ห้ามข้ามไปเงียบ ๆ เพราะถ้าใครแก้พื้นที่แล้วเผลอลบทิ้ง
    // การตรวจจะหายไปโดยรายงานว่า "ผ่าน" ซึ่งอันตรายกว่าไม่มีการตรวจเลย
    const m = measureInk(canvas, rule.region || null);

    /* ตราประทับเดิมนับเฉพาะหมึกแดง เพราะตัวอย่างที่มีตอนนั้นเป็นตราแดงทั้งหมด
     * แต่วัดจากไฟล์จริง 40 หน้าพบว่ามีตราน้ำเงินด้วย
     * และหน้าที่เป็นตราน้ำเงินมีหมึกแดง 0.00% พอดี
     * ระบบจึงบอกว่าไม่มีตรา ทั้งที่ตราชัดเจนอยู่บนกระดาษ
     *
     * เปลี่ยนเป็นนับหมึกสีทุกสี เพราะสิ่งที่แยกตราออกจากลายเซ็น
     * คือตำแหน่งบนกระดาษ ไม่ใช่สีของหมึก
     *
     * rule.color ตั้งเป็น 'red' ได้ถ้าที่ไหนต้องการบังคับเฉพาะตราแดง
     */
    const value = rule.color === 'red' ? m.red
                : rule.color === 'blue' ? m.blue
                : m.ink;
    checks.push({
      key: key,
      label: rule.label || key,
      value: Math.round(value * 100) / 100,
      min: rule.min,
      pass: value >= rule.min,
      // ภาพในกรอบ เพื่อให้คนดูได้ว่าระบบตรวจตรงไหนและตัดสินถูกไหม
      crop: cropRegion(canvas, rule.region || null, 260),
      detail: m
    });
  });

  const missing = checks.filter(c => !c.pass);
  return { checks: checks, missing: missing, ok: missing.length === 0 };
}

/** ข้อความสรุปสำหรับแสดงบนหน้าจอ */
export function summarize(result) {
  if (!result || !result.checks.length) return '';
  if (result.ok) {
    return 'พบ' + result.checks.map(c => c.label).join('และ') + 'ครบ';
  }
  // อ่านจาก checks เผื่อ missing หายไประหว่างส่งต่อ
  const left = (result.missing && result.missing.length)
    ? result.missing
    : (result.checks || []).filter(c => !c.pass);
  return 'ไม่พบ' + left.map(c => c.label).join('และ') + ' — โปรดตรวจกับเอกสาร';
}
