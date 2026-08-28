// ============================================================
//  DocScan — auth.js
//  ยืนยันตัวตนแบบทำเอง สำหรับทีมไม่เกิน 30 คน เครื่องใครเครื่องมัน
//
//  หลักการ
//   · รหัสผ่านจริงไม่เคยออกจากเครื่องผู้ใช้ ส่งไปแค่ค่าที่ผ่าน PBKDF2 แล้ว
//   · ฝั่ง GAS แฮชซ้ำอีกชั้นด้วย pepper ที่เก็บใน Script Properties
//     ถ้าวันหนึ่ง Sheet หลุด แฮชที่ได้ไปจะใช้อะไรไม่ได้ถ้าไม่มี pepper
//   · role และสิทธิ์ทั้งหมดตัดสินฝั่งเซิร์ฟเวอร์ หน้าเว็บใช้แค่ซ่อน/แสดง UI
// ============================================================

import { apiFetch, apiGet } from './api.js';

/** ใช้เช็คใน console ว่าเบราว์เซอร์โหลดไฟล์เวอร์ชันไหนอยู่ */
export const AUTH_JS_VERSION = '2.14.0';

const SESSION_KEY = 'docScanSession';
const PBKDF2_ITER = 150000;

/* ---------------- แฮชรหัสผ่านฝั่งเครื่องผู้ใช้ ---------------- */

/**
 * salt ผูกกับรหัสพนักงาน ไม่ใช่ค่าสุ่ม
 * เพราะตอนล็อกอินต้องคำนวณค่าเดิมให้ได้โดยยังไม่ได้คุยกับเซิร์ฟเวอร์
 * ค่านี้ไม่ใช่ความลับ หน้าที่ของมันคือกันการทำตารางแฮชสำเร็จรูปมาเทียบ
 */
function saltFor(empId) {
  return new TextEncoder().encode('docscan:v1:' + String(empId).trim().toLowerCase());
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ค่าคงที่ที่หน้าเว็บใช้ผสมก่อนแฮช
   ไม่ใช่ค่าเฉพาะบัญชี เป็นแค่ตัวกันไม่ให้ค่าตรงกับระบบอื่นที่ใช้วิธีเดียวกัน */
const CLIENT_SALT = 'docscan.v2';

/**
 * แปลงรหัสผ่านเป็นแฮชก่อนส่ง — รหัสจริงไม่ออกจากเครื่อง
 *
 * ตัวนี้แค่ทำให้รหัสผ่านตัวจริงไม่หลุดออกจากเบราว์เซอร์
 * ส่วนการทำให้แต่ละบัญชีได้ค่าต่างกัน เซิร์ฟเวอร์เป็นคนทำ
 *
 * เดิมใช้รหัสพนักงานเป็นตัวผสม แต่รหัสพนักงานซ้ำได้แล้ว
 * คนละบัญชีที่ตั้งรหัสเหมือนกันจึงได้ค่าเดียวกัน
 * และตอนล็อกอินหน้าเว็บก็ไม่รู้ว่าบัญชีนั้นมีอีเมลอะไร
 */
export async function derivePassword(password) {
  if (!globalThis.crypto || !crypto.subtle) {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้ารหัส — ต้องเปิดผ่าน https');
  }
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltFor(CLIENT_SALT), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    key, 256);
  return toHex(bits);
}

/* ---------------- session ในเครื่อง ---------------- */

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!s || !s.token || !s.empId) return null;
    if (s.expiresAt && Date.now() > s.expiresAt) return null;   // หมดอายุแล้ว
    return s;
  } catch { return null; }
}

export function saveSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** เหลืออีกกี่วันก่อนหมดอายุ — ใช้เตือนล่วงหน้าบนหน้าจอ */
export function daysLeft(s, now = Date.now()) {
  if (!s || !s.expiresAt) return null;
  return Math.max(0, Math.ceil((s.expiresAt - now) / 86400000));
}

/**
 * บังคับให้ต้องมี session ก่อนใช้หน้า
 * เก็บหน้าที่ตั้งใจจะไปไว้ด้วย เพื่อพากลับมาหลังล็อกอินเสร็จ
 *
 * สำคัญ: ห้ามล้างงานที่ค้างอยู่ตอนเด้งไปล็อกอิน
 * คนอาจทำงานมาทั้งวันแล้ว session เพิ่งหมดอายุพอดี
 */
export function requireAuth(redirect = 'login.html') {
  const s = loadSession();
  if (!s) {
    try { sessionStorage.setItem('docScanReturnTo', location.pathname + location.search); } catch {}
    location.href = redirect;
    return null;
  }
  return s;
}

export function consumeReturnTo(fallback = 'batch.html') {
  try {
    const t = sessionStorage.getItem('docScanReturnTo');
    sessionStorage.removeItem('docScanReturnTo');
    if (t && /^\/?[\w\-./]*$/.test(t) && !t.startsWith('//')) return t;
  } catch {}
  return fallback;
}

/* ---------------- คุยกับเซิร์ฟเวอร์ ---------------- */

export async function login(apiUrl, empId, password) {
  const pwHash = await derivePassword(password);
  const res = await apiFetch(apiUrl, {
    action: 'login', emp_id: String(empId).trim(), pw_hash: pwHash
  }, { retries: 0 });          // ห้าม retry — จะไปนับรวมกับการล็อกบัญชี

  const s = {
    token: res.token,
    empId: res.emp_id,
    empName: res.emp_name,
    empEmail: res.emp_email,
    site: res.site,
    site_filter: res.site_filter || [res.site],
    role: res.role,
    mustChangePassword: !!res.must_change_password,
    expiresAt: Date.now() + (res.expires_in_days || 30) * 86400000
  };
  saveSession(s);
  return s;
}

export async function changePassword(apiUrl, empId, oldPassword, newPassword) {
  const s = loadSession();
  const [oldHash, newHash] = await Promise.all([
    derivePassword(oldPassword),
    derivePassword(newPassword)
  ]);
  const res = await apiFetch(apiUrl, {
    action: 'changePassword', emp_id: String(empId).trim(),
    old_pw_hash: oldHash, new_pw_hash: newHash,
    token: s ? s.token : ''
  }, { retries: 0 });

  if (s) { s.mustChangePassword = false; saveSession(s); }
  return res;
}

/**
 * ออกจากระบบ
 *
 * ล้าง session ในเครื่องก่อนเป็นอันดับแรก แล้วค่อยแจ้งเซิร์ฟเวอร์
 *
 * ลำดับนี้สำคัญ: ผู้เรียกมักเปลี่ยนหน้าทันทีโดยไม่รอ Promise
 * ถ้าล้างทีหลัง หน้าจะถูกเปลี่ยนไปก่อนแล้วโค้ดส่วนนั้นไม่ได้ทำงาน
 * ผลคือกดออกจากระบบแล้วเด้งกลับเข้าไปใหม่
 *
 * และถ้าออฟไลน์อยู่ก็ยังออกจากระบบได้ ส่วน token ที่ค้างบนเซิร์ฟเวอร์
 * จะหมดอายุเองตามกำหนด
 */
export async function logout(apiUrl) {
  const s = loadSession();
  clearSession();

  if (s && s.token) {
    try {
      await apiFetch(apiUrl, { action: 'logout', token: s.token },
                     { retries: 0, timeoutMs: 5000 });
    } catch { /* ออกจากระบบฝั่งเครื่องสำเร็จแล้ว ที่เหลือไม่สำคัญ */ }
  }
}

/**
 * ห่อ apiFetch ให้แนบ token อัตโนมัติ
 * โค้ดที่เรียกใช้ไม่ต้องรู้เรื่อง token เลย
 */
export async function authFetch(apiUrl, payload, opts = {}) {
  const s = loadSession();
  if (!s) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  try {
    return await apiFetch(apiUrl, { ...payload, token: s.token }, opts);
  } catch (err) {
    // เซิร์ฟเวอร์บอกว่า token ใช้ไม่ได้แล้ว — ล้างทิ้งแล้วให้ล็อกอินใหม่
    if (err.kind === 'app' && err.detail && err.detail.code === 'auth_required') {
      clearSession();
      const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      e.code = 'auth_required';
      throw e;
    }
    throw err;
  }
}

/** เหมือน authFetch แต่สำหรับ endpoint แบบ GET */
export async function authGet(apiUrl, action, params = {}, opts = {}) {
  const s = loadSession();
  if (!s) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  try {
    return await apiGet(apiUrl, action, { ...params, token: s.token }, opts);
  } catch (err) {
    if (err.kind === 'app' && err.detail && err.detail.code === 'auth_required') {
      clearSession();
      const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      e.code = 'auth_required';
      throw e;
    }
    throw err;
  }
}

/** เหมือน authGet แต่คืนข้อความดิบ — ใช้กับ getCSV ที่คืน CSV ไม่ใช่ JSON */
export async function authGetText(apiUrl, action, params = {}, opts = {}) {
  return authGet(apiUrl, action, params, { ...opts, parse: 'text' });
}

/** ตรวจความแข็งแรงของรหัสผ่านขั้นต่ำ */
export function checkPasswordStrength(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, message: 'ต้องยาวอย่างน้อย 8 ตัวอักษร' };
  if (!/[a-zA-Z]/.test(s)) return { ok: false, message: 'ต้องมีตัวอักษรอย่างน้อยหนึ่งตัว' };
  if (!/[0-9]/.test(s)) return { ok: false, message: 'ต้องมีตัวเลขอย่างน้อยหนึ่งตัว' };
  if (/^(.)\1+$/.test(s)) return { ok: false, message: 'รหัสผ่านง่ายเกินไป' };
  const common = ['password', '12345678', 'qwerty123', 'docscan1', 'abcd1234'];
  if (common.includes(s.toLowerCase())) return { ok: false, message: 'รหัสผ่านนี้เดาง่ายเกินไป' };
  return { ok: true, message: '' };
}

/* ============================================================
   สมัครใช้งานเอง + ผู้ดูแลอนุมัติ
   ============================================================ */

/**
 * โดเมนอีเมลที่ยอมให้สมัคร
 *
 * ค่าจริงมาจาก Script Property ฝั่งเซิร์ฟเวอร์ (ALLOWED_EMAIL_DOMAIN)
 * ตัวนี้เป็นแค่ค่าสำรองไว้ใช้ตอนดึงจากเซิร์ฟเวอร์ไม่สำเร็จ
 * และเป็นแค่การตรวจเพื่อความสะดวกของผู้ใช้ ตัวกันจริงอยู่ฝั่งเซิร์ฟเวอร์เสมอ
 */
export let ALLOWED_EMAIL_DOMAINS = ['brs-group.com'];

/** ตั้งรายการโดเมนจากค่าที่ดึงมาจากเซิร์ฟเวอร์ */
export function setAllowedDomains(list) {
  if (Array.isArray(list) && list.length) {
    ALLOWED_EMAIL_DOMAINS = list.map(d => String(d).trim().toLowerCase()).filter(Boolean);
  }
  return ALLOWED_EMAIL_DOMAINS;
}

/** ดึงค่าตั้งจากเซิร์ฟเวอร์ — endpoint นี้เปิดสาธารณะเพราะหน้าสมัครต้องใช้ก่อนมีบัญชี */
export async function fetchAuthConfig(apiUrl) {
  const res = await apiGet(apiUrl, 'getAuthConfig', {}, { retries: 1, timeoutMs: 10000 });
  if (res && res.allowed_domains) setAllowedDomains(res.allowed_domains);
  return res;
}

/**
 * ตรวจโดเมนแบบตรงตัว ไม่ใช้ endsWith
 * ไม่งั้น evil-brs-group.com กับ brs-group.com.evil.com จะหลุดเข้ามาได้
 * ถ้าตั้งค่าขึ้นต้นด้วยจุด เช่น .brs-group.com จะรับโดเมนย่อยด้วย
 */
export function checkEmailDomain(email, domains = ALLOWED_EMAIL_DOMAINS) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, message: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }
  const domain = e.split('@')[1];
  const ok = domains.some(raw => {
    const d = String(raw).trim().toLowerCase().replace(/^@/, '');
    if (!d) return false;
    if (d.startsWith('.')) {
      const base = d.slice(1);
      return domain === base || domain.endsWith('.' + base);
    }
    return domain === d;
  });
  if (!ok) {
    const shown = domains.map(d => String(d).replace(/^\./, '')).join(', ');
    return { ok: false, message: 'ต้องใช้อีเมลของบริษัท (' + shown + ')' };
  }
  return { ok: true, message: '' };
}

/** ตรวจข้อมูลสมัครทั้งชุดก่อนส่ง — คืนรายการปัญหาทั้งหมดพร้อมกัน ไม่ใช่ทีละข้อ */
export function validateRegistration(form) {
  const errors = {};
  const empId = String(form.empId || '').trim();
  const name = String(form.empName || '').trim();

  if (!/^[A-Za-z0-9-]{3,20}$/.test(empId)) {
    errors.empId = 'รหัสพนักงานต้องเป็นตัวอักษรหรือตัวเลข 3–20 ตัว';
  }
  if (name.length < 2) errors.empName = 'กรุณากรอกชื่อ-นามสกุล';

  const em = checkEmailDomain(form.empEmail);
  if (!em.ok) errors.empEmail = em.message;

  const pw = checkPasswordStrength(form.password);
  if (!pw.ok) errors.password = pw.message;
  else if (form.password !== form.passwordConfirm) {
    errors.passwordConfirm = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
  }

  if (!String(form.site || '').trim()) errors.site = 'กรุณาเลือกไซต์';
  if (!String(form.role || '').trim()) errors.role = 'กรุณาเลือกทีม';

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * ขั้นที่ 1 — ส่งคำขอสมัคร ระบบจะส่งรหัสยืนยัน 6 หลักไปที่อีเมล
 *
 * รหัสผ่านถูกคำนวณด้วย PBKDF2 ที่เครื่องผู้ใช้ตั้งแต่ตอนนี้
 * ซึ่งแก้ข้อจำกัดเดิมที่ผู้ดูแลตั้งรหัสชั่วคราวจาก Apps Script แล้วค่าไม่ตรงกัน
 */
export async function register(apiUrl, form) {
  const v = validateRegistration(form);
  if (!v.ok) {
    const err = new Error('ข้อมูลไม่ถูกต้อง');
    err.errors = v.errors;
    throw err;
  }
  const pwHash = await derivePassword(form.password);
  return apiFetch(apiUrl, {
    action: 'register',
    // บอกเซิร์ฟเวอร์ว่ารหัสผ่านผ่านเกณฑ์แล้ว
    pw_meta: { ok: true },
    emp_id: String(form.empId).trim(),
    emp_name: String(form.empName).trim(),
    emp_email: String(form.empEmail).trim().toLowerCase(),
    site: form.site,
    role: form.role,
    pw_hash: pwHash
  }, { retries: 0 });
}

/** ขั้นที่ 2 — ยืนยันอีเมลด้วยรหัส 6 หลัก แล้วเข้าคิวรอผู้ดูแลอนุมัติ */
export async function confirmEmail(apiUrl, empId, code) {
  return apiFetch(apiUrl, {
    action: 'confirmEmail',
    emp_id: String(empId).trim(),
    code: String(code).trim()
  }, { retries: 0 });
}

/** เช็คสถานะคำขอสมัคร — pending_email · pending_approval · approved · rejected */
export async function checkRegistrationStatus(apiUrl, empId) {
  return apiFetch(apiUrl, {
    action: 'registrationStatus', emp_id: String(empId).trim()
  }, { retries: 1 });
}

/* ============================================================
   ลืมรหัสผ่าน — ตั้งใหม่เองผ่านอีเมล
   ============================================================ */

/**
 * ขั้นที่ 1 — ขอรหัสตั้งรหัสผ่านใหม่
 *
 * คำตอบจะเหมือนกันเสมอไม่ว่าจะมีบัญชีนี้จริงหรือไม่
 * ไม่งั้นคนนอกจะใช้ตรงนี้ไล่เช็คได้ว่ารหัสพนักงานไหนมีอยู่ในระบบ
 */
export async function requestReset(apiUrl, empId) {
  return apiFetch(apiUrl, {
    action: 'requestReset', emp_id: String(empId).trim()
  }, { retries: 0 });
}

/** ขั้นที่ 2 — ใส่รหัสจากอีเมลพร้อมรหัสผ่านใหม่ */
export async function confirmReset(apiUrl, empId, code, newPassword) {
  const pw = checkPasswordStrength(newPassword);
  if (!pw.ok) throw new Error(pw.message);

  const newHash = await derivePassword(newPassword);
  const res = await apiFetch(apiUrl, {
    action: 'confirmReset',
    emp_id: String(empId).trim(),
    code: String(code).trim(),
    new_pw_hash: newHash
  }, { retries: 0 });

  clearSession();   // ตั้งรหัสใหม่แล้ว session เดิมทุกเครื่องถูกตัด ต้องล็อกอินใหม่
  return res;
}

/** รหัสยืนยันต้องเป็นตัวเลข 6 หลักเท่านั้น */
export function isValidCode(code) {
  return /^\d{6}$/.test(String(code || '').trim());
}
