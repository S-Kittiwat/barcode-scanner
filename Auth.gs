/**
 * ============================================================
 *  DocScan — Auth.gs
 *  ส่วนยืนยันตัวตนฝั่งเซิร์ฟเวอร์ (วางเพิ่มในโปรเจกต์ Apps Script เดิม)
 *
 *  ตั้งค่าครั้งแรก — ทำก่อนใช้งาน
 *   1. Project Settings → Script Properties → เพิ่ม
 *        AUTH_PEPPER = <สตริงสุ่มยาว ๆ อย่างน้อย 32 ตัว>
 *      เก็บที่นี่ ไม่ใช่ในชีต ถ้า Sheet หลุดออกไป แฮชจะใช้อะไรไม่ได้
 *      ห้ามเปลี่ยนค่านี้ทีหลัง ไม่งั้นทุกคนจะล็อกอินไม่ได้ ต้องตั้งรหัสใหม่หมด
 *   2. รัน setupAuthSheets() หนึ่งครั้ง เพื่อสร้างชีต Users / Sessions / LoginLog
 *   3. รัน addUser(...) เพื่อเพิ่มผู้ใช้ทีละคน
 * ============================================================
 */

var SHEET_USERS    = 'Users';
var SHEET_SESSIONS = 'Sessions';
var SHEET_LOGINLOG = 'LoginLog';

var SESSION_DAYS      = 30;
var MAX_FAILED        = 5;         // ผิดกี่ครั้งจึงล็อก
var LOCKOUT_MINUTES   = 15;
var SESSION_CACHE_SEC = 300;       // แคชผลตรวจ token 5 นาที ลดการอ่านชีต

/* ---------------- ตั้งค่าครั้งแรก ---------------- */

/**
 * สร้างและตั้ง AUTH_PEPPER ให้อัตโนมัติ — วิธีที่ปลอดภัยที่สุด
 *
 * รันฟังก์ชันนี้ครั้งเดียวจากหน้า Apps Script
 * ค่าถูกสร้างและเก็บในที่เดียวกัน ไม่ต้องคัดลอกผ่านคลิปบอร์ด
 * จึงไม่มีทางพลาดเรื่องก๊อปไม่ครบ ติดเครื่องหมายคำพูด หรือหลุดไปที่อื่น
 *
 * ถ้ามีค่าอยู่แล้วจะไม่เขียนทับ ต้องยืนยันด้วย regenerateAuthPepper() แทน
 */
function generateAuthPepper() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('AUTH_PEPPER')) {
    return 'มี AUTH_PEPPER อยู่แล้ว — ไม่เขียนทับ\n' +
           'ถ้าต้องการสร้างใหม่จริง ๆ ให้ใช้ regenerateAuthPepper() ' +
           'แต่ทุกคนจะล็อกอินไม่ได้และต้องตั้งรหัสใหม่ทั้งหมด';
  }
  var pepper = Utilities.getUuid().replace(/-/g, '') +
               Utilities.getUuid().replace(/-/g, '');
  props.setProperty('AUTH_PEPPER', pepper);
  return 'ตั้ง AUTH_PEPPER เรียบร้อย (ยาว ' + pepper.length + ' ตัว)\n' +
         'ค่านี้ไม่ต้องจดไว้ที่ไหน และไม่ควรเปิดดูอีก';
}

/**
 * สร้าง AUTH_PEPPER ใหม่ทับของเดิม
 *
 * อ่านให้ครบก่อนรัน: ทุกคนจะล็อกอินไม่ได้ทันที
 * และต้องให้ผู้ดูแลตั้งรหัสใหม่ให้ทุกคนด้วย resetPassword()
 * ใช้เฉพาะกรณีสงสัยว่าค่าเดิมหลุดออกไปเท่านั้น
 */
function regenerateAuthPepper() {
  var props = PropertiesService.getScriptProperties();
  var pepper = Utilities.getUuid().replace(/-/g, '') +
               Utilities.getUuid().replace(/-/g, '');
  props.setProperty('AUTH_PEPPER', pepper);
  revokeAllSessionsForEveryone_();
  return 'สร้าง AUTH_PEPPER ใหม่แล้ว — ตัดทุกเซสชันเรียบร้อย\n' +
         'ตอนนี้ยังไม่มีใครล็อกอินได้ ต้องรัน resetPassword() ให้ทุกคน';
}

function revokeAllSessionsForEveryone_() {
  var sheet = getSheet_(SHEET_SESSIONS);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var hashes = sheet.getRange(2, 1, last - 1, 1).getValues();
  hashes.forEach(function (h) {
    CacheService.getScriptCache().remove('sess:' + h[0]);
  });
  sheet.deleteRows(2, last - 1);
  return last - 1;
}

function setupAuthSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var u = ss.getSheetByName(SHEET_USERS) || ss.insertSheet(SHEET_USERS);
  if (u.getLastRow() === 0) {
    u.appendRow(['emp_id', 'emp_name', 'emp_email', 'site', 'role',
                 'pw_hash', 'must_change', 'active',
                 'failed_count', 'locked_until', 'created_at', 'last_login']);
    u.setFrozenRows(1);
  }

  var s = ss.getSheetByName(SHEET_SESSIONS) || ss.insertSheet(SHEET_SESSIONS);
  if (s.getLastRow() === 0) {
    s.appendRow(['token_hash', 'emp_id', 'created_at', 'expires_at', 'last_seen', 'user_agent']);
    s.setFrozenRows(1);
  }

  var l = ss.getSheetByName(SHEET_LOGINLOG) || ss.insertSheet(SHEET_LOGINLOG);
  if (l.getLastRow() === 0) {
    l.appendRow(['เวลา', 'รหัสพนักงาน', 'ผลลัพธ์', 'หมายเหตุ']);
    l.setFrozenRows(1);
  }

  if (!PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER')) {
    throw new Error('ยังไม่ได้ตั้ง AUTH_PEPPER ใน Script Properties');
  }
  return 'สร้างชีตเรียบร้อย';
}

/**
 * เพิ่มผู้ใช้ — รันจากหน้า Apps Script โดยผู้ดูแลเท่านั้น
 *
 * ต้องใส่ค่า pwHash ที่คำนวณจากเบราว์เซอร์ ไม่ใช่รหัสผ่านตรง ๆ
 * เพราะ GAS ไม่มี PBKDF2 จึงคำนวณค่าเดียวกับเบราว์เซอร์ไม่ได้
 * ถ้าใส่รหัสผ่านดิบลงไป จะได้บัญชีที่ล็อกอินไม่ได้เลย
 *
 * วิธีหาค่า pwHash: เปิด admin-tool.html บนเว็บ กรอกรหัสพนักงานกับรหัสผ่าน แล้วคัดลอกค่าที่ได้
 *
 * ตัวอย่าง:
 *   addUser('ADMIN01','ชื่อคุณ','you@brs-group.com','NDC-วังน้อย','admin',
 *           '3f9a...64ตัว...', false)
 *
 * mustChange: true = บังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรก (ใช้เมื่อผู้ดูแลตั้งรหัสให้คนอื่น)
 */
function addUser(empId, name, email, site, role, pwHash, mustChange) {
  assertPwHash_(pwHash);
  if (role !== 'admin' && isAllSites_(site)) {
    throw new Error('บัญชีที่ไม่ใช่ admin ต้องระบุไซต์ — ค่าว่างจะทำให้เห็นข้อมูลทุกไซต์');
  }
  var sheet = getSheet_(SHEET_USERS);
  if (findUserRow_(sheet, empId)) throw new Error('มีรหัสพนักงานนี้อยู่แล้ว: ' + empId);

  sheet.appendRow([
    String(empId).trim(), name, email, site, role,
    serverHash_(pwHash),
    mustChange === true,   // ค่าเริ่มต้นคือไม่บังคับ เพราะเจ้าตัวมักตั้งรหัสเอง
    true,                  // active
    0, '', new Date(), ''
  ]);
  return 'เพิ่มผู้ใช้ ' + empId + ' เรียบร้อย — เข้าสู่ระบบด้วยรหัสที่ใช้สร้าง hash ได้เลย';
}

/**
 * ตั้งรหัสใหม่ให้ผู้ใช้
 *
 * ปกติไม่ต้องใช้ ให้ผู้ใช้กด "ลืมรหัสผ่าน" เองได้
 * ใช้เฉพาะกรณีที่เขาเข้าอีเมลไม่ได้
 * ต้องใส่ pwHash จาก admin-tool.html เช่นเดียวกับ addUser
 */
function resetPassword(empId, pwHash, mustChange) {
  assertPwHash_(pwHash);
  var sheet = getSheet_(SHEET_USERS);
  var row = findUserRow_(sheet, empId);
  if (!row) throw new Error('ไม่พบผู้ใช้ ' + empId);
  var h = colIndex_(sheet);
  sheet.getRange(row, h.pw_hash).setValue(serverHash_(pwHash));
  sheet.getRange(row, h.must_change).setValue(mustChange === true);
  sheet.getRange(row, h.failed_count).setValue(0);
  sheet.getRange(row, h.locked_until).setValue('');
  revokeAllSessions(empId);
  return 'ตั้งรหัสใหม่ให้ ' + empId + ' เรียบร้อย — ตัดทุกเซสชันเดิมแล้ว';
}

/** กันการเผลอใส่รหัสผ่านดิบแทนค่า hash */
function assertPwHash_(pwHash) {
  var v = String(pwHash || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(v)) {
    throw new Error(
      'pwHash ไม่ถูกต้อง — ต้องเป็นเลขฐานสิบหก 64 ตัว\n' +
      'ห้ามใส่รหัสผ่านดิบ ให้เปิด admin-tool.html เพื่อคำนวณค่าก่อน\n' +
      'ค่าที่ใส่มา: ' + v.slice(0, 20) + (v.length > 20 ? '...' : '') + ' (ยาว ' + v.length + ')');
  }
}

/**
 * ดูรายชื่อผู้ใช้ทั้งหมด — ใช้ตรวจว่าบัญชีถูกสร้างจริงไหม และสถานะเป็นอย่างไร
 * รันจากหน้า Apps Script แล้วดู Execution log
 *
 * หมายเหตุ: รหัสผ่านดูไม่ได้ ระบบเก็บแค่ค่า hash ที่ย้อนกลับไม่ได้
 * ถ้าลืมรหัส ต้องตั้งใหม่ ไม่มีวิธีกู้ค่าเดิม
 */
function listUsers() {
  var sheet = getSheet_(SHEET_USERS);
  var last = sheet.getLastRow();
  if (last < 2) return 'ยังไม่มีผู้ใช้ในระบบ — ต้องสร้างด้วย addUser() ก่อน';

  var h = colIndex_(sheet);
  var data = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var now = new Date();
  var out = ['พบผู้ใช้ ' + data.length + ' คน', ''];

  data.forEach(function (r) {
    var locked = r[h.locked_until - 1];
    var isLocked = locked && new Date(locked) > now;
    var active = r[h.active - 1] === true ||
                 String(r[h.active - 1]).toUpperCase() === 'TRUE';
    var mustChange = r[h.must_change - 1] === true ||
                     String(r[h.must_change - 1]).toUpperCase() === 'TRUE';

    out.push([
      'รหัสพนักงาน : ' + r[h.emp_id - 1],
      'ชื่อ         : ' + r[h.emp_name - 1],
      'อีเมล        : ' + r[h.emp_email - 1],
      'role / ไซต์  : ' + r[h.role - 1] + ' / ' + r[h.site - 1],
      'สถานะ        : ' + (active ? 'ใช้งานได้' : 'ถูกปิดใช้งาน') +
                          (isLocked ? '  [ถูกล็อกถึง ' + locked + ']' : '') +
                          (mustChange ? '  [ต้องเปลี่ยนรหัสตอนล็อกอิน]' : ''),
      'กรอกผิดสะสม : ' + (r[h.failed_count - 1] || 0) + ' ครั้ง',
      'ล็อกอินล่าสุด: ' + (r[h.last_login - 1] || 'ยังไม่เคย'),
      'มีรหัสผ่าน   : ' + (String(r[h.pw_hash - 1] || '').length > 10 ? 'ตั้งไว้แล้ว' : 'ยังไม่ได้ตั้ง'),
      '---'
    ].join('\n'));
  });

  out.push('');
  out.push('ดูรหัสผ่านไม่ได้ — ระบบเก็บแค่ค่า hash');
  out.push('ถ้าลืมรหัส ให้ตั้งใหม่ด้วย resetPassword() พร้อมค่า hash จาก admin-tool.html');

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/** ปลดล็อกบัญชีที่ถูกล็อกจากการกรอกรหัสผิดหลายครั้ง */
function unlockUser(empId) {
  var sheet = getSheet_(SHEET_USERS);
  var row = findUserRow_(sheet, empId);
  if (!row) throw new Error('ไม่พบผู้ใช้ ' + empId);
  var h = colIndex_(sheet);
  sheet.getRange(row, h.failed_count).setValue(0);
  sheet.getRange(row, h.locked_until).setValue('');
  return 'ปลดล็อก ' + empId + ' แล้ว';
}

/** ปิดการใช้งานผู้ใช้ เช่น ลาออก — ตัดทุก session ทันที */
function deactivateUser(empId) {
  var sheet = getSheet_(SHEET_USERS);
  var row = findUserRow_(sheet, empId);
  if (!row) throw new Error('ไม่พบผู้ใช้ ' + empId);
  sheet.getRange(row, colIndex_(sheet).active).setValue(false);
  revokeAllSessions(empId);
  return 'ปิดการใช้งาน ' + empId + ' แล้ว';
}

/** ถอน session ทั้งหมดของคนนี้ เช่น เครื่องหาย */
function revokeAllSessions(empId) {
  var sheet = getSheet_(SHEET_SESSIONS);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, 1, last - 1, 2).getValues();
  var removed = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][1]).trim() === String(empId).trim()) {
      CacheService.getScriptCache().remove('sess:' + vals[i][0]);
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

/* ---------------- ตัวช่วยด้านการเข้ารหัส ---------------- */

function pepper_() {
  var p = PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER');
  if (!p) throw new Error('ยังไม่ได้ตั้ง AUTH_PEPPER');
  return p;
}

function sha256Hex_(str) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/** แฮชชั้นที่สอง ผสม pepper — ค่านี้คือสิ่งที่เก็บในชีต */
function serverHash_(clientHash) {
  return sha256Hex_(String(clientHash) + '|' + pepper_());
}

/** เทียบสตริงแบบใช้เวลาเท่ากันเสมอ ไม่ให้เดาจากเวลาที่ตอบกลับ */
function safeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- ตัวช่วยเข้าถึงชีต ---------------- */

function colIndex_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) map[String(headers[i]).trim()] = i + 1;
  return map;
}

function findUserRow_(sheet, empId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var h = colIndex_(sheet);
  var vals = sheet.getRange(2, h.emp_id, last - 1, 1).getValues();
  var target = String(empId).trim().toLowerCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === target) return i + 2;
  }
  return 0;
}

function logLogin_(empId, result, note) {
  try {
    getSheet_(SHEET_LOGINLOG).appendRow([new Date(), empId, result, note || '']);
  } catch (e) {}
}

/* ---------------- login ---------------- */

function handleLogin_(body) {
  var empId = String(body.emp_id || '').trim();
  var pwHash = String(body.pw_hash || '');
  if (!empId || !pwHash) {
    return jsonOut({ status: 'error', code: 'bad_request', message: 'ข้อมูลไม่ครบ' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return jsonOut({ status: 'error', message: 'ระบบกำลังถูกใช้งาน กรุณาลองใหม่' });
  }

  try {
    var sheet = getSheet_(SHEET_USERS);
    var row = findUserRow_(sheet, empId);
    var h = colIndex_(sheet);

    // ข้อความเดียวกันทั้งกรณีไม่มีผู้ใช้และรหัสผิด — ไม่บอกใบ้ว่ารหัสพนักงานไหนมีจริง
    var GENERIC = 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง';

    if (!row) {
      logLogin_(empId, 'ล้มเหลว', 'ไม่พบผู้ใช้');
      return jsonOut({ status: 'error', code: 'auth_failed', message: GENERIC });
    }

    var rec = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    var get = function (name) { return rec[h[name] - 1]; };

    if (get('active') !== true && String(get('active')).toUpperCase() !== 'TRUE') {
      logLogin_(empId, 'ล้มเหลว', 'บัญชีถูกปิดใช้งาน');
      return jsonOut({ status: 'error', code: 'inactive', message: 'บัญชีนี้ถูกปิดการใช้งาน' });
    }

    var lockedUntil = get('locked_until');
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      var mins = Math.ceil((new Date(lockedUntil) - new Date()) / 60000);
      logLogin_(empId, 'ล้มเหลว', 'บัญชีถูกล็อกชั่วคราว');
      return jsonOut({ status: 'error', code: 'locked',
                       message: 'กรอกรหัสผิดหลายครั้ง กรุณารออีก ' + mins + ' นาที' });
    }

    if (!safeEqual_(serverHash_(pwHash), String(get('pw_hash')))) {
      var failed = Number(get('failed_count') || 0) + 1;
      sheet.getRange(row, h.failed_count).setValue(failed);
      if (failed >= MAX_FAILED) {
        sheet.getRange(row, h.locked_until)
             .setValue(new Date(Date.now() + LOCKOUT_MINUTES * 60000));
        sheet.getRange(row, h.failed_count).setValue(0);
      }
      logLogin_(empId, 'ล้มเหลว', 'รหัสผ่านไม่ถูกต้อง (ครั้งที่ ' + failed + ')');
      return jsonOut({ status: 'error', code: 'auth_failed', message: GENERIC });
    }

    // ผ่านแล้ว — ล้างตัวนับ ออก token
    sheet.getRange(row, h.failed_count).setValue(0);
    sheet.getRange(row, h.locked_until).setValue('');
    sheet.getRange(row, h.last_login).setValue(new Date());

    var token = Utilities.getUuid() + '-' + Utilities.getUuid();
    var expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);

    getSheet_(SHEET_SESSIONS).appendRow([
      sha256Hex_(token), empId, new Date(), expiresAt, new Date(),
      String(body.user_agent || '').slice(0, 200)
    ]);

    logLogin_(empId, 'สำเร็จ', '');
    return jsonOut({
      status: 'ok',
      token: token,
      emp_id: empId,
      emp_name: get('emp_name'),
      emp_email: get('emp_email'),
      site: get('site'),
      site_filter: siteFilterFor_(get('site'), get('role')),
      role: get('role'),
      must_change_password: get('must_change') === true ||
                            String(get('must_change')).toUpperCase() === 'TRUE',
      expires_in_days: SESSION_DAYS
    });

  } catch (err) {
    logError_('login', err);
    return jsonOut({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** ให้ตรงกับ getSiteGroups เดิมที่ใช้อยู่ */
/**
 * แปลงชื่อไซต์เป็นรายการ customer_start_name ที่ครอบคลุม
 * อ่านจากชีต site_groups ตรง ๆ (doGetSiteGroups คืน ContentService ใช้ต่อไม่ได้)
 *
 * ผู้ดูแลไม่ผูกกับไซต์ใดไซต์หนึ่ง คืน [] เพื่อให้เห็นข้อมูลทุกไซต์
 */
function siteFilterFor_(site, role) {
  if (role === 'admin') return [];        // ไม่กรอง = เห็นทุกไซต์
  var name = String(site || '').trim();
  if (!name || isAllSites_(name)) return [];

  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SITE_GROUPS_SHEET);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0] || '').trim() === name) {
          var names = String(data[i][1] || '').split('|')
                      .map(function (x) { return x.trim(); }).filter(Boolean);
          if (names.length) return names;
        }
      }
    }
  } catch (e) { logError_('siteFilterFor_', e); }
  return [name];
}

/** ค่าที่ถือว่าหมายถึง "ทุกไซต์" */
function isAllSites_(site) {
  var v = String(site || '').trim().toUpperCase();
  return v === '' || v === 'ALL' || v === '*' || v === 'ทุกไซต์';
}

/* ---------------- ตรวจ token ---------------- */

/**
 * คืนข้อมูลผู้ใช้ถ้า token ใช้ได้ ไม่งั้นคืน null
 * ใช้ CacheService กันการอ่านชีตทุกคำขอ ซึ่งจะกินเวลารันของ GAS มาก
 */
function verifyToken_(token) {
  if (!token) return null;
  var hash = sha256Hex_(String(token));
  var cache = CacheService.getScriptCache();

  var cached = cache.get('sess:' + hash);
  if (cached) {
    var c = JSON.parse(cached);
    if (new Date(c.expires_at) > new Date()) return c;
    cache.remove('sess:' + hash);
    return null;
  }

  var sheet = getSheet_(SHEET_SESSIONS);
  var last = sheet.getLastRow();
  if (last < 2) return null;

  var vals = sheet.getRange(2, 1, last - 1, 4).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (!safeEqual_(vals[i][0], hash)) continue;
    if (new Date(vals[i][3]) <= new Date()) { sheet.deleteRow(i + 2); return null; }

    var users = getSheet_(SHEET_USERS);
    var row = findUserRow_(users, vals[i][1]);
    if (!row) return null;
    var h = colIndex_(users);
    var rec = users.getRange(row, 1, 1, users.getLastColumn()).getValues()[0];
    if (rec[h.active - 1] !== true && String(rec[h.active - 1]).toUpperCase() !== 'TRUE') return null;

    var info = {
      emp_id: rec[h.emp_id - 1],
      emp_name: rec[h.emp_name - 1],
      emp_email: rec[h.emp_email - 1],
      site: rec[h.site - 1],
      role: rec[h.role - 1],
      expires_at: new Date(vals[i][3]).toISOString()
    };
    cache.put('sess:' + hash, JSON.stringify(info), SESSION_CACHE_SEC);
    return info;
  }
  return null;
}

function handleLogout_(body) {
  var hash = sha256Hex_(String(body.token || ''));
  CacheService.getScriptCache().remove('sess:' + hash);
  var sheet = getSheet_(SHEET_SESSIONS);
  var last = sheet.getLastRow();
  if (last >= 2) {
    var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (safeEqual_(vals[i][0], hash)) { sheet.deleteRow(i + 2); break; }
    }
  }
  return jsonOut({ status: 'ok' });
}

function handleChangePassword_(body) {
  var empId = String(body.emp_id || '').trim();
  var sheet = getSheet_(SHEET_USERS);
  var row = findUserRow_(sheet, empId);
  if (!row) return jsonOut({ status: 'error', message: 'ไม่พบผู้ใช้' });

  var h = colIndex_(sheet);
  var current = String(sheet.getRange(row, h.pw_hash).getValue());
  if (!safeEqual_(serverHash_(String(body.old_pw_hash || '')), current)) {
    logLogin_(empId, 'ล้มเหลว', 'เปลี่ยนรหัส: รหัสเดิมไม่ถูกต้อง');
    return jsonOut({ status: 'error', message: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  var newHash = serverHash_(String(body.new_pw_hash || ''));
  if (safeEqual_(newHash, current)) {
    return jsonOut({ status: 'error', message: 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม' });
  }

  sheet.getRange(row, h.pw_hash).setValue(newHash);
  sheet.getRange(row, h.must_change).setValue(false);
  logLogin_(empId, 'สำเร็จ', 'เปลี่ยนรหัสผ่าน');
  return jsonOut({ status: 'ok', message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
}

/* ---------------- ล้างของหมดอายุ ---------------- */

/** ตั้ง time-driven trigger ให้รันวันละครั้ง */
function cleanupExpiredSessions() {
  var sheet = getSheet_(SHEET_SESSIONS);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, 1, last - 1, 4).getValues();
  var now = new Date(), removed = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (new Date(vals[i][3]) <= now) {
      CacheService.getScriptCache().remove('sess:' + vals[i][0]);
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

/* ---------------- ใช้กับ action อื่น ---------------- */

/**
 * ครอบทุก action ที่ต้องล็อกอิน
 * สิทธิ์ตัดสินจาก role ในชีต ไม่ใช่จากสิ่งที่หน้าเว็บส่งมา
 */
function withAuth_(body, allowedRoles, handler) {
  var user = verifyToken_(body.token);
  if (!user) {
    return jsonOut({ status: 'error', code: 'auth_required',
                     message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
  if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(user.role) === -1) {
    return jsonOut({ status: 'error', code: 'forbidden', message: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
  }
  return handler(body, user);
}
