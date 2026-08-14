/**
 * ============================================================
 *  DocScan — Register.gs
 *  สมัครใช้งานเอง + ผู้ดูแลอนุมัติ + ลืมรหัสตั้งใหม่เองผ่านอีเมล
 *
 *  ตั้งค่าเพิ่มใน Script Properties
 *    ALLOWED_EMAIL_DOMAIN = brs-group.com
 *      ใส่ได้หลายโดเมน คั่นด้วย , หรือ | หรือเว้นวรรค เช่น
 *      brs-group.com, boonrawd.co.th, singha.com
 *      ขึ้นต้นด้วยจุดหมายถึงรับโดเมนย่อยด้วย เช่น .brs-group.com
 *      จะรับทั้ง brs-group.com และ th.brs-group.com
 *    ADMIN_EMAIL          = อีเมลผู้ดูแล (รับแจ้งเตือนเมื่อมีคนสมัคร)
 *
 *  รันครั้งเดียว: setupRegisterSheets()
 * ============================================================
 */

var SHEET_PENDING = 'PendingUsers';
var SHEET_CODES   = 'AuthCodes';

var CODE_TTL_MIN        = 15;   // รหัสยืนยันมีอายุกี่นาที
var CODE_MAX_ATTEMPTS   = 5;    // ใส่รหัสผิดได้กี่ครั้งต่อหนึ่งรหัส
var RESET_COOLDOWN_MIN  = 3;    // ขอรหัสใหม่ได้ทุกกี่นาที
var RESET_MAX_PER_DAY   = 5;    // ขอรหัสได้กี่ครั้งต่อวันต่อคน
var PENDING_MAX_TOTAL   = 100;  // เพดานคิวรออนุมัติ กันการถล่มคิว

function setupRegisterSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var p = ss.getSheetByName(SHEET_PENDING) || ss.insertSheet(SHEET_PENDING);
  if (p.getLastRow() === 0) {
    p.appendRow(['emp_id', 'emp_name', 'emp_email', 'site', 'role', 'pw_hash',
                 'status', 'requested_at', 'email_verified_at',
                 'decided_at', 'decided_by', 'note']);
    p.setFrozenRows(1);
  }

  var c = ss.getSheetByName(SHEET_CODES) || ss.insertSheet(SHEET_CODES);
  if (c.getLastRow() === 0) {
    c.appendRow(['emp_id', 'purpose', 'code_hash', 'expires_at',
                 'attempts', 'created_at', 'used_at']);
    c.setFrozenRows(1);
  }

  var props = PropertiesService.getScriptProperties();
  if (!allowedDomains_().length) {
    throw new Error('ยังไม่ได้ตั้ง ALLOWED_EMAIL_DOMAIN');
  }
  if (!props.getProperty('ADMIN_EMAIL')) {
    throw new Error('ยังไม่ได้ตั้ง ADMIN_EMAIL');
  }
  return 'สร้างชีตเรียบร้อย';
}

/* ---------------- ตัวช่วยรหัสยืนยัน ---------------- */

function makeCode_() {
  // เลข 6 หลักแบบสุ่มจริง ไม่ใช่ Math.random
  var bytes = Utilities.getUuid().replace(/-/g, '');
  var n = parseInt(bytes.substring(0, 8), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

/**
 * เก็บเฉพาะแฮชของรหัส ไม่เก็บตัวรหัส
 * ถ้าชีตหลุด คนที่เห็นจะเอารหัสไปใช้ไม่ได้
 */
function saveCode_(empId, purpose, code) {
  var sheet = getSheet_(SHEET_CODES);
  clearCodes_(empId, purpose);
  sheet.appendRow([
    String(empId).trim().toLowerCase(), purpose,
    sha256Hex_(code + '|' + pepper_()),
    new Date(Date.now() + CODE_TTL_MIN * 60000),
    0, new Date(), ''
  ]);
}

function clearCodes_(empId, purpose) {
  var sheet = getSheet_(SHEET_CODES);
  var last = sheet.getLastRow();
  if (last < 2) return;
  var vals = sheet.getRange(2, 1, last - 1, 2).getValues();
  var id = String(empId).trim().toLowerCase();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).toLowerCase() === id && vals[i][1] === purpose) {
      sheet.deleteRow(i + 2);
    }
  }
}

/** ตรวจรหัส คืน true เมื่อถูกต้องและยังไม่หมดอายุ */
function verifyCode_(empId, purpose, code) {
  var sheet = getSheet_(SHEET_CODES);
  var last = sheet.getLastRow();
  if (last < 2) return { ok: false, message: 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว' };

  var id = String(empId).trim().toLowerCase();
  var vals = sheet.getRange(2, 1, last - 1, 7).getValues();

  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() !== id || vals[i][1] !== purpose) continue;

    var row = i + 2;
    if (new Date(vals[i][3]) <= new Date()) {
      sheet.deleteRow(row);
      return { ok: false, message: 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่' };
    }
    var attempts = Number(vals[i][4] || 0);
    if (attempts >= CODE_MAX_ATTEMPTS) {
      sheet.deleteRow(row);
      return { ok: false, message: 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่' };
    }
    if (!safeEqual_(sha256Hex_(String(code) + '|' + pepper_()), String(vals[i][2]))) {
      sheet.getRange(row, 5).setValue(attempts + 1);
      return { ok: false, message: 'รหัสไม่ถูกต้อง (เหลืออีก ' +
                                   (CODE_MAX_ATTEMPTS - attempts - 1) + ' ครั้ง)' };
    }
    sheet.deleteRow(row);
    return { ok: true };
  }
  return { ok: false, message: 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว' };
}

/** กันการกดขอรหัสรัว ๆ */
function checkCooldown_(empId, purpose) {
  var sheet = getSheet_(SHEET_CODES);
  var last = sheet.getLastRow();
  if (last < 2) return { ok: true };
  var id = String(empId).trim().toLowerCase();
  var vals = sheet.getRange(2, 1, last - 1, 6).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === id && vals[i][1] === purpose) {
      var age = (Date.now() - new Date(vals[i][5]).getTime()) / 60000;
      if (age < RESET_COOLDOWN_MIN) {
        return { ok: false, message: 'เพิ่งส่งรหัสไปแล้ว กรุณารออีก ' +
                                     Math.ceil(RESET_COOLDOWN_MIN - age) + ' นาที' };
      }
    }
  }
  return { ok: true };
}

function countTodayRequests_(empId, purpose) {
  var sheet = getSheet_(SHEET_LOGINLOG);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(Math.max(2, last - 300), 1, Math.min(300, last - 1), 4).getValues();
  var since = new Date(); since.setHours(0, 0, 0, 0);
  var id = String(empId).trim().toLowerCase(), n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (new Date(vals[i][0]) >= since &&
        String(vals[i][1]).toLowerCase() === id &&
        String(vals[i][3]).indexOf(purpose) > -1) n++;
  }
  return n;
}

/**
 * อ่านรายการโดเมนที่อนุญาต
 * รับได้หลายโดเมน คั่นด้วย , | ; หรือเว้นวรรค
 */
function allowedDomains_() {
  var raw = String(PropertiesService.getScriptProperties()
                   .getProperty('ALLOWED_EMAIL_DOMAIN') || '');
  return raw.toLowerCase()
            .split(/[,|;\s]+/)
            .map(function (d) { return d.trim().replace(/^@/, ''); })
            .filter(Boolean);
}

/**
 * ตรวจว่าอีเมลอยู่ในโดเมนที่อนุญาตไหม
 *
 * เทียบแบบตรงตัวเป็นค่าเริ่มต้น ไม่ใช้ endsWith
 * ไม่งั้น evil-brs-group.com กับ brs-group.com.evil.com จะหลุดเข้ามาได้
 * ถ้าต้องการรับโดเมนย่อยจริง ๆ ให้ตั้งค่าโดยขึ้นต้นด้วยจุด เช่น .brs-group.com
 */
function emailDomainOk_(email) {
  var e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  var domain = e.split('@')[1];
  var list = allowedDomains_();
  if (!list.length) return false;   // ยังไม่ได้ตั้งค่า = ไม่ให้สมัคร

  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (d.charAt(0) === '.') {
      // .brs-group.com → รับทั้งตัวมันเองและโดเมนย่อย
      var base = d.slice(1);
      if (domain === base || domain.slice(-(base.length + 1)) === '.' + base) return true;
    } else if (domain === d) {
      return true;
    }
  }
  return false;
}

/** ให้หน้าสมัครดึงไปแสดงบนฟอร์ม จะได้ไม่ต้องตั้งค่าซ้ำสองที่ */
function handleGetAuthConfig_() {
  return outputJSON({
    status: 'ok',
    allowed_domains: allowedDomains_(),
    session_days: SESSION_DAYS,
    code_ttl_min: CODE_TTL_MIN
  });
}

/* ---------------- สมัครใช้งาน ---------------- */

/**
 * ขั้นที่ 1 — รับคำขอสมัคร แล้วส่งรหัสยืนยันไปที่อีเมล
 *
 * ต้องยืนยันอีเมลก่อนเข้าคิวรออนุมัติ ไม่ใช่เข้าคิวทันที
 * เพราะถ้าเข้าคิวได้เลย ใครก็ยิงคำขอปลอมมาถล่มจนผู้ดูแลแยกไม่ออกว่าอันไหนจริง
 */
function handleRegister_(body) {
  var empId = String(body.emp_id || '').trim();
  var email = String(body.emp_email || '').trim().toLowerCase();

  if (!/^[A-Za-z0-9-]{3,20}$/.test(empId)) {
    return jsonOut({ status: 'error', message: 'รูปแบบรหัสพนักงานไม่ถูกต้อง' });
  }
  if (!emailDomainOk_(email)) {
    return jsonOut({ status: 'error', message: 'ต้องใช้อีเมลของบริษัทเท่านั้น' });
  }
  if (!body.pw_hash) {
    return jsonOut({ status: 'error', message: 'ข้อมูลไม่ครบ' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return jsonOut({ status: 'error', message: 'ระบบกำลังถูกใช้งาน กรุณาลองใหม่' });
  }

  try {
    if (findUserRow_(getSheet_(SHEET_USERS), empId)) {
      return jsonOut({ status: 'error',
                       message: 'รหัสพนักงานนี้มีบัญชีอยู่แล้ว หากลืมรหัสผ่านให้กดลืมรหัสผ่าน' });
    }

    var pending = getSheet_(SHEET_PENDING);
    if (pending.getLastRow() - 1 >= PENDING_MAX_TOTAL) {
      return jsonOut({ status: 'error',
                       message: 'คิวรออนุมัติเต็ม กรุณาติดต่อผู้ดูแลระบบ' });
    }

    var cool = checkCooldown_(empId, 'register');
    if (!cool.ok) return jsonOut({ status: 'error', message: cool.message });

    var row = findPendingRow_(empId);
    if (row) {
      var st = pending.getRange(row, 7).getValue();
      if (st === 'pending_approval') {
        return jsonOut({ status: 'ok', stage: 'pending_approval',
                         message: 'คำขอของคุณรอผู้ดูแลอนุมัติอยู่' });
      }
      // ยังไม่ยืนยันอีเมล — เขียนทับคำขอเดิมได้
      pending.getRange(row, 1, 1, 12).setValues([[
        empId, body.emp_name, email, body.site, body.role,
        serverHash_(body.pw_hash), 'pending_email', new Date(), '', '', '', ''
      ]]);
    } else {
      pending.appendRow([
        empId, body.emp_name, email, body.site, body.role,
        serverHash_(body.pw_hash), 'pending_email', new Date(), '', '', '', ''
      ]);
    }

    var code = makeCode_();
    saveCode_(empId, 'register', code);
    sendCodeEmail_(email, body.emp_name, code, 'ยืนยันอีเมลเพื่อสมัครใช้งาน DocScan');
    logLogin_(empId, 'สมัคร', 'register: ส่งรหัสยืนยันอีเมล');

    return jsonOut({ status: 'ok', stage: 'pending_email',
                     message: 'ส่งรหัสยืนยัน 6 หลักไปที่ ' + maskEmail_(email) + ' แล้ว' });

  } catch (err) {
    logError_('register', err);
    return jsonOut({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** ขั้นที่ 2 — ยืนยันอีเมล แล้วเข้าคิวรอผู้ดูแลอนุมัติ */
function handleConfirmEmail_(body) {
  var empId = String(body.emp_id || '').trim();
  var row = findPendingRow_(empId);
  if (!row) return jsonOut({ status: 'error', message: 'ไม่พบคำขอสมัคร' });

  var v = verifyCode_(empId, 'register', body.code);
  if (!v.ok) return jsonOut({ status: 'error', message: v.message });

  var pending = getSheet_(SHEET_PENDING);
  pending.getRange(row, 7).setValue('pending_approval');
  pending.getRange(row, 9).setValue(new Date());

  notifyAdminNewRequest_(pending.getRange(row, 1, 1, 5).getValues()[0]);
  logLogin_(empId, 'สมัคร', 'register: ยืนยันอีเมลแล้ว รออนุมัติ');

  return jsonOut({ status: 'ok', stage: 'pending_approval',
                   message: 'ยืนยันอีเมลเรียบร้อย รอผู้ดูแลอนุมัติ' });
}

function handleRegistrationStatus_(body) {
  var empId = String(body.emp_id || '').trim();
  if (findUserRow_(getSheet_(SHEET_USERS), empId)) {
    return jsonOut({ status: 'ok', stage: 'approved',
                     message: 'บัญชีพร้อมใช้งานแล้ว เข้าสู่ระบบได้เลย' });
  }
  var row = findPendingRow_(empId);
  if (!row) return jsonOut({ status: 'ok', stage: 'none', message: 'ไม่พบคำขอสมัคร' });

  var rec = getSheet_(SHEET_PENDING).getRange(row, 1, 1, 12).getValues()[0];
  return jsonOut({ status: 'ok', stage: rec[6], note: rec[11] || '' });
}

function findPendingRow_(empId) {
  var sheet = getSheet_(SHEET_PENDING);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  var id = String(empId).trim().toLowerCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === id) return i + 2;
  }
  return 0;
}

/* ---------------- ผู้ดูแลอนุมัติ ---------------- */

/** ดูรายการที่รออนุมัติ — รันจากหน้า Apps Script */
function listPendingApprovals() {
  var sheet = getSheet_(SHEET_PENDING);
  var last = sheet.getLastRow();
  if (last < 2) return 'ไม่มีคำขอรออนุมัติ';
  var vals = sheet.getRange(2, 1, last - 1, 9).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][6] === 'pending_approval') {
      out.push(vals[i][0] + ' | ' + vals[i][1] + ' | ' + vals[i][2] +
               ' | ' + vals[i][3] + ' | ' + vals[i][4] +
               ' | ยืนยันอีเมล ' + vals[i][8]);
    }
  }
  return out.length ? out.join('\n') : 'ไม่มีคำขอรออนุมัติ';
}

/**
 * อนุมัติ — ย้ายจากคิวไปเป็นผู้ใช้จริง
 * รหัสผ่านที่ผู้ใช้ตั้งเองตอนสมัครถูกใช้ต่อได้เลย ไม่ต้องตั้งรหัสชั่วคราว
 * จึงไม่มีปัญหาค่าแฮชไม่ตรงกันแบบตอนที่ผู้ดูแลตั้งรหัสให้จาก Apps Script
 *
 * ตัวอย่าง: approveUser('E001', 'warehouse')
 * ใส่ roleOverride เมื่อต้องการให้สิทธิ์ต่างจากที่ผู้ใช้ขอมา
 */
function approveUser(empId, roleOverride, siteOverride) {
  var pending = getSheet_(SHEET_PENDING);
  var row = findPendingRow_(empId);
  if (!row) throw new Error('ไม่พบคำขอของ ' + empId);

  var rec = pending.getRange(row, 1, 1, 12).getValues()[0];
  if (rec[6] !== 'pending_approval') {
    throw new Error('คำขอนี้อยู่ในสถานะ ' + rec[6] + ' ยังยืนยันอีเมลไม่เสร็จ');
  }
  if (findUserRow_(getSheet_(SHEET_USERS), empId)) {
    throw new Error('มีบัญชีนี้อยู่แล้ว');
  }

  getSheet_(SHEET_USERS).appendRow([
    rec[0], rec[1], rec[2],
    siteOverride || rec[3],
    roleOverride || rec[4],
    rec[5],          // แฮชรหัสผ่านที่ผู้ใช้ตั้งเอง
    false,           // must_change — ไม่ต้องบังคับเปลี่ยน
    true,            // active
    0, '', new Date(), ''
  ]);

  pending.getRange(row, 7).setValue('approved');
  pending.getRange(row, 10).setValue(new Date());
  pending.getRange(row, 11).setValue(Session.getActiveUser().getEmail() || 'admin');

  sendPlainEmail_(rec[2], 'บัญชี DocScan ของคุณพร้อมใช้งานแล้ว',
    'สวัสดีคุณ ' + rec[1] + '\n\n' +
    'ผู้ดูแลอนุมัติบัญชีของคุณแล้ว เข้าสู่ระบบได้ด้วยรหัสพนักงานและรหัสผ่านที่ตั้งไว้ตอนสมัคร\n\n' +
    'รหัสพนักงาน: ' + rec[0] + '\nไซต์: ' + (siteOverride || rec[3]) + '\n');

  logLogin_(empId, 'สมัคร', 'register: อนุมัติแล้ว');
  return 'อนุมัติ ' + empId + ' เรียบร้อย';
}

/** ปฏิเสธคำขอ พร้อมเหตุผลที่จะส่งไปให้เจ้าตัว */
function rejectUser(empId, reason) {
  var pending = getSheet_(SHEET_PENDING);
  var row = findPendingRow_(empId);
  if (!row) throw new Error('ไม่พบคำขอของ ' + empId);

  var rec = pending.getRange(row, 1, 1, 12).getValues()[0];
  pending.getRange(row, 7).setValue('rejected');
  pending.getRange(row, 10).setValue(new Date());
  pending.getRange(row, 11).setValue(Session.getActiveUser().getEmail() || 'admin');
  pending.getRange(row, 12).setValue(reason || '');

  sendPlainEmail_(rec[2], 'คำขอใช้งาน DocScan ไม่ผ่านการอนุมัติ',
    'สวัสดีคุณ ' + rec[1] + '\n\nคำขอของคุณไม่ผ่านการอนุมัติ\n' +
    'เหตุผล: ' + (reason || 'ไม่ระบุ') + '\n\nหากมีข้อสงสัยกรุณาติดต่อผู้ดูแลระบบ\n');

  logLogin_(empId, 'สมัคร', 'register: ปฏิเสธ — ' + (reason || ''));
  return 'ปฏิเสธ ' + empId + ' เรียบร้อย';
}

/* ---------------- ลืมรหัสผ่าน ---------------- */

/**
 * ขั้นที่ 1 — ขอรหัสตั้งรหัสผ่านใหม่
 *
 * ตอบข้อความเดียวกันเสมอไม่ว่าจะมีบัญชีนี้จริงหรือไม่
 * ไม่งั้นคนนอกจะใช้ตรงนี้ไล่เช็คว่ารหัสพนักงานไหนมีอยู่ในระบบ
 */
function handleRequestReset_(body) {
  var empId = String(body.emp_id || '').trim();
  var GENERIC = 'หากมีบัญชีนี้ในระบบ เราได้ส่งรหัสไปที่อีเมลที่ลงทะเบียนไว้แล้ว';

  try {
    var sheet = getSheet_(SHEET_USERS);
    var row = findUserRow_(sheet, empId);
    if (!row) {
      logLogin_(empId, 'ลืมรหัส', 'reset: ไม่พบผู้ใช้');
      return jsonOut({ status: 'ok', message: GENERIC });
    }

    if (countTodayRequests_(empId, 'reset') >= RESET_MAX_PER_DAY) {
      return jsonOut({ status: 'error',
                       message: 'ขอรหัสเกินจำนวนที่กำหนดต่อวัน กรุณาติดต่อผู้ดูแลระบบ' });
    }
    var cool = checkCooldown_(empId, 'reset');
    if (!cool.ok) return jsonOut({ status: 'error', message: cool.message });

    var h = colIndex_(sheet);
    var rec = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    var active = rec[h.active - 1];
    if (active !== true && String(active).toUpperCase() !== 'TRUE') {
      logLogin_(empId, 'ลืมรหัส', 'reset: บัญชีถูกปิดใช้งาน');
      return jsonOut({ status: 'ok', message: GENERIC });
    }

    var code = makeCode_();
    saveCode_(empId, 'reset', code);
    sendCodeEmail_(rec[h.emp_email - 1], rec[h.emp_name - 1], code,
                   'รหัสตั้งรหัสผ่านใหม่ DocScan');
    logLogin_(empId, 'ลืมรหัส', 'reset: ส่งรหัสแล้ว');

    return jsonOut({ status: 'ok', message: GENERIC,
                     hint: maskEmail_(rec[h.emp_email - 1]) });

  } catch (err) {
    logError_('requestReset', err);
    return jsonOut({ status: 'ok', message: GENERIC });   // ไม่เปิดเผยข้อผิดพลาดภายใน
  }
}

/** ขั้นที่ 2 — ตรวจรหัสแล้วตั้งรหัสผ่านใหม่ */
function handleConfirmReset_(body) {
  var empId = String(body.emp_id || '').trim();
  var sheet = getSheet_(SHEET_USERS);
  var row = findUserRow_(sheet, empId);
  if (!row) return jsonOut({ status: 'error', message: 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว' });

  var v = verifyCode_(empId, 'reset', body.code);
  if (!v.ok) return jsonOut({ status: 'error', message: v.message });

  if (!body.new_pw_hash) {
    return jsonOut({ status: 'error', message: 'ข้อมูลไม่ครบ' });
  }

  var h = colIndex_(sheet);
  sheet.getRange(row, h.pw_hash).setValue(serverHash_(String(body.new_pw_hash)));
  sheet.getRange(row, h.must_change).setValue(false);
  sheet.getRange(row, h.failed_count).setValue(0);
  sheet.getRange(row, h.locked_until).setValue('');

  // ตั้งรหัสใหม่แล้ว ต้องตัดทุกเครื่องที่ยังล็อกอินค้างอยู่
  var revoked = revokeAllSessions(empId);

  var email = sheet.getRange(row, h.emp_email).getValue();
  sendPlainEmail_(email, 'รหัสผ่าน DocScan ถูกเปลี่ยนแล้ว',
    'รหัสผ่านของบัญชี ' + empId + ' ถูกเปลี่ยนเมื่อ ' +
    Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm') + '\n\n' +
    'หากไม่ใช่คุณ กรุณาแจ้งผู้ดูแลระบบทันที\n');

  logLogin_(empId, 'ลืมรหัส', 'reset: ตั้งรหัสใหม่สำเร็จ ตัด ' + revoked + ' เซสชัน');
  return jsonOut({ status: 'ok', message: 'ตั้งรหัสผ่านใหม่เรียบร้อย เข้าสู่ระบบได้เลย' });
}

/* ---------------- อีเมล ---------------- */

function maskEmail_(email) {
  var e = String(email || '');
  var at = e.indexOf('@');
  if (at < 2) return e;
  return e.substring(0, 2) + '****' + e.substring(at);
}

function sendCodeEmail_(email, name, code, subject) {
  sendPlainEmail_(email, subject,
    'สวัสดีคุณ ' + (name || '') + '\n\n' +
    'รหัสยืนยันของคุณคือ\n\n        ' + code + '\n\n' +
    'รหัสนี้ใช้ได้ภายใน ' + CODE_TTL_MIN + ' นาที และใช้ได้ครั้งเดียว\n' +
    'หากคุณไม่ได้เป็นผู้ขอ กรุณาอย่าแจ้งรหัสนี้กับใคร และแจ้งผู้ดูแลระบบ\n');
}

function sendPlainEmail_(email, subject, bodyText) {
  try {
    MailApp.sendEmail({
      to: email, subject: subject, body: bodyText, name: 'DocScan'
    });
  } catch (err) {
    // โควตาอีเมลของบัญชีทั่วไปราว 100 ฉบับต่อวัน — ถ้าเต็มจะมาโผล่ที่นี่
    logError_('sendEmail', err);
    throw new Error('ส่งอีเมลไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ');
  }
}

function notifyAdminNewRequest_(rec) {
  var admin = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!admin) return;
  sendPlainEmail_(admin, '[DocScan] มีคำขอสมัครใหม่รออนุมัติ',
    'รหัสพนักงาน: ' + rec[0] + '\nชื่อ: ' + rec[1] + '\nอีเมล: ' + rec[2] +
    '\nไซต์: ' + rec[3] + '\nทีม: ' + rec[4] + '\n\n' +
    'อนุมัติโดยเปิด Apps Script แล้วรัน\n' +
    "  approveUser('" + rec[0] + "')\n\n" +
    'หรือปฏิเสธด้วย\n' +
    "  rejectUser('" + rec[0] + "', 'เหตุผล')\n");
}

/* ---------------- ล้างของเก่า ---------------- */

/** ตั้ง trigger รายวันร่วมกับ cleanupExpiredSessions */
function cleanupExpiredCodes() {
  var sheet = getSheet_(SHEET_CODES);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, 1, last - 1, 4).getValues();
  var now = new Date(), n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (new Date(vals[i][3]) <= now) { sheet.deleteRow(i + 2); n++; }
  }

  // ล้างคำขอที่ค้างไม่ยืนยันอีเมลเกิน 7 วัน
  var pending = getSheet_(SHEET_PENDING);
  var plast = pending.getLastRow();
  if (plast >= 2) {
    var pv = pending.getRange(2, 1, plast - 1, 8).getValues();
    var cutoff = Date.now() - 7 * 86400000;
    for (var j = pv.length - 1; j >= 0; j--) {
      if (pv[j][6] === 'pending_email' && new Date(pv[j][7]).getTime() < cutoff) {
        pending.deleteRow(j + 2);
      }
    }
  }
  return n;
}
