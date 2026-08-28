/**
 * ============================================================
 *  ตรวจข้อมูลที่ผู้ใช้กรอก
 * ============================================================
 *  ใช้ร่วมกันทั้งหน้าเว็บและฝั่งเซิร์ฟเวอร์
 *  เพื่อให้กฎเดียวกันเสมอ ไม่ใช่ต่างคนต่างตรวจแล้วไม่ตรงกัน
 * ============================================================
 */

/** โดเมนอีเมลที่ใช้สมัครได้ */
export const ALLOWED_DOMAINS = [
  'brs-group.com',
  'bevchain.co.th',
  'boonrawd.co.th'
];

/**
 * รหัสพนักงาน — ตัวเลขล้วน ไม่เกิน 8 ตัว
 * ใส่ศูนย์นำหน้าได้ เช่น 00013764 หรือ 13764
 */
export function checkEmpId(v) {
  const s = String(v || '').trim();
  if (!s) return { ok: false, message: 'กรุณากรอกรหัสพนักงาน' };
  if (!/^\d+$/.test(s)) return { ok: false, message: 'รหัสพนักงานต้องเป็นตัวเลขเท่านั้น' };
  if (s.length > 8) return { ok: false, message: 'รหัสพนักงานต้องไม่เกิน 8 หลัก' };
  return { ok: true, value: s };
}

/** อีเมลต้องเป็นของบริษัท */
export function checkEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return { ok: false, message: 'กรุณากรอกอีเมล' };
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) {
    return { ok: false, message: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }
  const domain = s.slice(s.indexOf('@') + 1);
  if (ALLOWED_DOMAINS.indexOf(domain) === -1) {
    return { ok: false,
      message: 'ต้องใช้อีเมลของบริษัทเท่านั้น\n' + ALLOWED_DOMAINS.join(' · ') };
  }
  return { ok: true, value: s };
}

/**
 * ชื่อต้องเป็นภาษาไทย
 *
 * ยอมให้มีช่องว่างและจุด เพราะชื่อกับนามสกุลคั่นด้วยช่องว่าง
 * และคำนำหน้าบางแบบมีจุด เช่น "น.ส."
 */
export function checkThaiName(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  if (!s) return { ok: false, message: 'กรุณากรอกชื่อ-นามสกุล' };
  if (s.length < 4) return { ok: false, message: 'ชื่อสั้นเกินไป' };
  if (s.length > 60) return { ok: false, message: 'ชื่อยาวเกินไป' };
  if (!/^[\u0E00-\u0E7F\s.]+$/.test(s)) {
    return { ok: false, message: 'ชื่อต้องเป็นภาษาไทยเท่านั้น' };
  }
  if (!/\s/.test(s)) {
    return { ok: false, message: 'กรุณากรอกทั้งชื่อและนามสกุล' };
  }
  return { ok: true, value: s };
}

/**
 * รหัสผ่าน — ตรวจทีละข้อเพื่อให้หน้าจอแสดงเป็นรายการติ๊กถูกได้
 *
 * คืนรายการเงื่อนไขพร้อมสถานะ ไม่ใช่แค่ผ่าน/ไม่ผ่าน
 * คนจะได้รู้ว่าขาดอะไร แทนที่จะเดา
 */
export function checkPassword(pw) {
  const s = String(pw || '');
  const rules = [
    { key: 'len',   label: 'ยาวอย่างน้อย 8 ตัว',        ok: s.length >= 8 },
    { key: 'upper', label: 'มีตัวอักษรพิมพ์ใหญ่',        ok: /[A-Z]/.test(s) },
    { key: 'lower', label: 'มีตัวอักษรพิมพ์เล็ก',        ok: /[a-z]/.test(s) },
    { key: 'digit', label: 'มีตัวเลขอย่างน้อย 1 ตัว',    ok: /[0-9]/.test(s) },
    { key: 'sym',   label: 'มีอักขระพิเศษอย่างน้อย 1 ตัว',
      ok: /[^A-Za-z0-9]/.test(s) }
  ];

  /* ต้องเป็นภาษาอังกฤษเท่านั้น
     ถ้ามีตัวไทยปนมา มักเกิดจากลืมสลับแป้นพิมพ์
     ปล่อยผ่านแล้วจะเข้าระบบไม่ได้ในเครื่องอื่น */
  const thai = /[\u0E00-\u0E7F]/.test(s);
  if (thai) {
    return { ok: false, rules,
      message: 'รหัสผ่านต้องเป็นภาษาอังกฤษเท่านั้น — ลองสลับแป้นพิมพ์' };
  }

  const failed = rules.filter(r => !r.ok);
  return {
    ok: failed.length === 0,
    rules,
    message: failed.length ? failed[0].label.replace(/^/, 'รหัสผ่านต้อง') : ''
  };
}

/** ตรวจทั้งฟอร์มสมัคร คืนข้อผิดพลาดทั้งหมดพร้อมกัน */
export function checkRegistration(data) {
  const errors = {};
  const clean = {};

  const id = checkEmpId(data.emp_id);
  if (id.ok) clean.emp_id = id.value; else errors.emp_id = id.message;

  const nm = checkThaiName(data.emp_name);
  if (nm.ok) clean.emp_name = nm.value; else errors.emp_name = nm.message;

  const em = checkEmail(data.emp_email);
  if (em.ok) clean.emp_email = em.value; else errors.emp_email = em.message;

  if (!String(data.site || '').trim()) errors.site = 'กรุณาเลือกไซต์';
  else clean.site = String(data.site).trim();

  // รหัสผ่านตรวจเฉพาะตอนที่ยังไม่ถูกแฮช
  if (data.password !== undefined) {
    const pw = checkPassword(data.password);
    if (!pw.ok) errors.password = pw.message;
  }

  return { ok: Object.keys(errors).length === 0, errors, clean };
}
