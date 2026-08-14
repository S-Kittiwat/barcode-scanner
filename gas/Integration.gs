/**
 * ============================================================
 *  DocScan — Integration.gs
 *  เอาไปวางเป็นไฟล์ใหม่ในโปรเจกต์ Apps Script
 *  แล้ว **ลบ doGet กับ doPost เดิมใน Code.gs ทิ้ง** (เหลือฟังก์ชันอื่นไว้ทั้งหมด)
 *
 *  ไฟล์นี้เขียนให้ตรงกับชื่อฟังก์ชันจริงใน Code.gs ของคุณแล้ว
 *  ไม่ต้องแก้ชื่อ handler เองอีก
 * ============================================================
 */

/* ============================================================
   สวิตช์เปิด/ปิดการตรวจสิทธิ์
   ค่อย ๆ เปิดได้ ไม่ต้องเปิดพร้อมกันทั้งหมด
   ============================================================ */
var REQUIRE_AUTH_ON_GET  = true;   // ตั้ง false ไว้ก่อนได้ ถ้ายังไม่พร้อม
var REQUIRE_AUTH_ON_POST = true;   // ตัวนี้ควรเปิดเสมอ เพราะเป็นตัวที่เขียนข้อมูล

var PUBLIC_GET_ACTIONS = ['getSiteGroups', 'getAuthConfig'];   // หน้าสมัครต้องใช้ก่อนมีบัญชี

/* ============================================================
   doGet
   ============================================================ */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  var user = null;
  if (REQUIRE_AUTH_ON_GET && PUBLIC_GET_ACTIONS.indexOf(action) === -1) {
    user = verifyToken_(e.parameter.token);
    if (!user) {
      return outputJSON({ status: 'error', code: 'auth_required',
                          message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    }
    try {
      enforceSiteScope_(e, user);
    } catch (scopeErr) {
      return outputJSON({ status: 'error', message: scopeErr.message });
    }
  }

  // getCSV คืน CSV ดิบ ไม่ใช่ JSON — ฝั่งหน้าเว็บใช้ authGetText รับ
  if (action === 'getCSV')         return doGetCSV();
  if (action === 'getDashboard')   return doGetDashboard(e);
  if (action === 'getDelivery')    return doGetDelivery(e);
  if (action === 'getBatches')     return doGetBatches(e);
  if (action === 'getBatchDetail') return doGetBatchDetail(e);
  if (action === 'getSiteGroups')  return doGetSiteGroups();
  if (action === 'getIncoming')    return doGetIncoming(e);
  if (action === 'getCSVVersion')  return handleGetCSVVersion_();
  if (action === 'getAuthConfig')  return handleGetAuthConfig_();

  return outputJSON({ status: 'ok', message: 'DocScan API ready' });
}

/* ============================================================
   doPost
   ============================================================ */
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;

    /* ── ไม่ต้องล็อกอิน ─────────────────────────────────── */
    if (action === 'login')              return handleLogin_(body);
    if (action === 'logout')             return handleLogout_(body);
    if (action === 'changePassword')     return handleChangePassword_(body);
    if (action === 'register')           return handleRegister_(body);
    if (action === 'confirmEmail')       return handleConfirmEmail_(body);
    if (action === 'registrationStatus') return handleRegistrationStatus_(body);
    if (action === 'requestReset')       return handleRequestReset_(body);
    if (action === 'confirmReset')       return handleConfirmReset_(body);
    if (action === 'logError')           return handleLogError_(body);

    /* ── ต้องล็อกอิน ───────────────────────────────────── */
    var user = null;
    if (REQUIRE_AUTH_ON_POST) {
      user = verifyToken_(body.token);
      if (!user) {
        return outputJSON({ status: 'error', code: 'auth_required',
                            message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      }
      if (!allowRole_(action, user.role)) {
        return outputJSON({ status: 'error', code: 'forbidden',
                            message: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้' });
      }
      stampIdentity_(body, user);
    }

    /* ── ของเดิม ที่เพิ่มการกันข้อมูลซ้ำเข้าไป ─────────── */
    if (action === 'updateItems' && body.items) {
      return outputJSON(updateItemsIdempotent_(body.items));
    }

    // อัปโหลดหลายไฟล์ในคำขอเดียว — ของใหม่ ลด 50 คำขอเหลือ 10
    if (action === 'uploadPhotos' && body.files) {
      return outputJSON(uploadPhotosBatch_(body.files));
    }
    // ของเดิม ยังรองรับไว้เผื่อมีที่เรียกอยู่
    if (action === 'uploadPhoto' && body.barcode) {
      return outputJSON(uploadPhoto(body.barcode, body.image, body.ref_no || ''));
    }

    if (action === 'updateStatus' && body.items) {
      return outputJSON(updateStatus(body.items));
    }

    /* ── receiveItems / disputeItems — ของเดิมยกมาทั้งก้อน ── */
    if (action === 'receiveItems') {
      var rcvItems = (body.received || []).map(function (bc) {
        return { barcode: bc, batch_id: body.batch_id, emp_id: body.emp_id,
                 emp_name: body.emp_name, site: body.site,
                 note: 'คลังรับครบ', dest_warehouse: body.dest_warehouse || '' };
      });
      var misItems = (body.missing || []).map(function (bc) {
        return { barcode: bc, batch_id: body.batch_id, emp_id: body.emp_id,
                 emp_name: body.emp_name, site: body.site,
                 note: 'เอกสารขาด — ยังไม่รับ', dest_warehouse: body.dest_warehouse || '' };
      });
      var result = receiveItems(rcvItems);
      if (misItems.length) {
        disputeItems(misItems.map(function (i) {
          return Object.assign({}, i, { dispute_type: 'missing',
                 note: 'เอกสารขาดเมื่อรับ batch ' + body.batch_id });
        }));
      }
      return outputJSON(result);
    }

    if (action === 'disputeItems') {
      var dItems = (body.missing || []).concat(body.extra || []).map(function (bc) {
        return { barcode: bc, batch_id: body.batch_id, emp_id: body.emp_id,
                 emp_name: body.emp_name, site: body.site, note: body.note || '',
                 dest_warehouse: body.dest_warehouse || '',
                 dispute_type: body.dispute_type || 'missing' };
      });
      if (!dItems.length) {
        dItems = [{ barcode: 'BATCH:' + body.batch_id, batch_id: body.batch_id,
                    emp_id: body.emp_id, emp_name: body.emp_name, site: body.site,
                    note: body.note || '', dest_warehouse: body.dest_warehouse || '',
                    dispute_type: body.dispute_type || 'missing' }];
      }
      return outputJSON(disputeItems(dItems));
    }

    if (action === 'resolveDispute' && body.batch_id) {
      return outputJSON(resolveDispute(body.batch_id, body.emp_id, body.emp_name));
    }
    if (action === 'splitBatch')   return outputJSON(splitBatch(body));
    if (action === 'submitReport') return outputJSON(submitReport(body));

    return outputJSON({ status: 'error', message: 'Invalid action' });

  } catch (err) {
    return outputJSON({ status: 'error', message: err.toString() });
  }
}

/**
 * บังคับขอบเขตไซต์จากฝั่งเซิร์ฟเวอร์
 *
 * เดิมหน้าเว็บส่ง site_filter มาเอง ซึ่งอ่านจาก localStorage
 * แปลว่าใครแก้ค่าใน DevTools ก็ดูข้อมูลไซต์อื่นได้ทั้งหมด
 * ตัวนี้เขียนทับด้วยค่าจริงจากชีต Users เสมอ
 *
 * ผู้ดูแล (admin) ไม่ถูกจำกัด และเลือกดูเฉพาะไซต์ได้ถ้าส่งพารามิเตอร์มา
 */
function enforceSiteScope_(e, user) {
  if (user.role === 'admin') return;   // เห็นทุกไซต์ หรือกรองเองได้ตามต้องการ

  // ไม่ใช่ admin แต่ไม่มีไซต์ = ผิดปกติ ห้ามปล่อยผ่าน
  // ถ้าปล่อย ค่าว่างจะกลายเป็น "ไม่กรอง" ซึ่งเท่ากับเห็นข้อมูลทุกไซต์
  if (isAllSites_(user.site)) {
    throw new Error('บัญชี ' + user.emp_id + ' ยังไม่ได้กำหนดไซต์ กรุณาติดต่อผู้ดูแลระบบ');
  }

  var allowed = siteFilterFor_(user.site, user.role);
  e.parameter.site = user.site;
  e.parameter.site_filter = allowed.length ? allowed.join('|') : user.site;

  // dest_warehouse ใน getIncoming ก็ต้องถูกจำกัดเช่นกัน
  if (e.parameter.dest_warehouse) {
    e.parameter.dest_warehouse = e.parameter.site_filter;
  }
}

/* ============================================================
   สิทธิ์ตาม role — ตัดสินฝั่งนี้เท่านั้น
   ============================================================ */
var ACTION_ROLES = {
  updateItems   : ['warehouse', 'admin'],
  uploadPhoto   : ['warehouse', 'delivery', 'admin'],
  uploadPhotos  : ['warehouse', 'delivery', 'admin'],
  receiveItems  : ['warehouse', 'admin'],
  disputeItems  : ['warehouse', 'delivery', 'admin'],
  splitBatch    : ['warehouse', 'admin'],
  updateStatus  : ['delivery', 'admin'],
  resolveDispute: ['delivery', 'admin'],
  submitReport  : null   // ใครก็แจ้งปัญหาได้
};

function allowRole_(action, role) {
  var allowed = ACTION_ROLES[action];
  if (allowed === undefined) return true;   // action ที่ไม่ได้ระบุ ปล่อยผ่าน
  if (allowed === null) return true;
  return allowed.indexOf(role) !== -1;
}

/**
 * เขียนตัวตนจริงทับสิ่งที่หน้าเว็บส่งมา
 *
 * สำคัญ: receiveItems กับ disputeItems ส่ง emp_id มาที่ระดับบนสุด ไม่ใช่ใน items[]
 * ถ้าเขียนทับเฉพาะใน items จะยังสวมชื่อคนอื่นได้อยู่
 */
function stampIdentity_(body, user) {
  body.emp_id    = user.emp_id;
  body.emp_name  = user.emp_name;
  body.emp_email = user.emp_email;
  body.site      = user.site;

  (body.items || []).forEach(function (it) {
    it.emp_id    = user.emp_id;
    it.emp_name  = user.emp_name;
    it.emp_email = user.emp_email;
    it.site      = user.site;
  });
}

/* ============================================================
   updateItems แบบกันข้อมูลซ้ำ
   Collectionsheet เดิมมี 18 คอลัมน์ (A–R)
   ต้องเพิ่ม client_id ที่คอลัมน์ S และ updated_at ที่ T
   ============================================================ */
var COL_CLIENT_ID = 19;   // S
var COL_UPDATED_AT = 20;  // T

function updateItemsIdempotent_(items) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 'error', message: 'ระบบกำลังถูกใช้งาน กรุณาลองใหม่' };
  }
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(LOG_SHEET);
    if (!sheet) return { status: 'error', message: 'ไม่พบ Sheet: ' + LOG_SHEET };

    ensureIdempotencyColumns_(sheet);

    // ทำ index จาก client_id → แถว อ่านทีเดียว
    var lastRow = sheet.getLastRow();
    var idMap = {};
    if (lastRow > 1) {
      var ids = sheet.getRange(2, COL_CLIENT_ID, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        var id = String(ids[i][0] || '').trim();
        if (id) idMap[id] = i + 2;
      }
    }

    var now = new Date();
    var appends = [], results = [], scannedItems = [];

    items.forEach(function (item) {
      var cid = String(item.client_id || '').trim();
      var row = [
        now, item.emp_email || '', item.emp_id || '', item.emp_name || '', item.site || '',
        item.barcode || '', item.ref_no || '', item.item_name || '',
        item.transfer_from || '', item.origin_acc || '',
        item.transfer_to || '', item.dest_acc || '',
        item.despatch_date ? new Date(item.despatch_date) : '',
        item.received_date ? new Date(item.received_date) : '',
        Number(item.sent_qty) || '', Number(item.received_qty) || '',
        item.not_found ? 'NOT FOUND' : 'FOUND', item.photo_url || '',
        cid, now
      ];

      if (cid && idMap[cid]) {
        // เคยบันทึกแล้ว — เขียนทับแถวเดิม ไม่สร้างแถวใหม่
        sheet.getRange(idMap[cid], 1, 1, row.length).setValues([row]);
        results.push({ client_id: cid, barcode: item.barcode, status: 'updated' });
      } else {
        appends.push(row);
        if (cid) idMap[cid] = -1;   // กันซ้ำภายใน payload เดียวกัน
        results.push({ client_id: cid, barcode: item.barcode, status: 'created' });
        scannedItems.push(item);
      }
    });

    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, appends[0].length)
           .setValues(appends);
    }
    SpreadsheetApp.flush();

    // บันทึก status scanned เฉพาะรายการที่เพิ่งสร้างใหม่
    // ถ้าบันทึกทุกครั้งที่ส่งซ้ำ doc_log จะบวมโดยไม่จำเป็น
    if (scannedItems.length) {
      updateStatus(scannedItems.map(function (item) {
        return { barcode: item.barcode, status: 'scanned', emp_id: item.emp_id,
                 emp_name: item.emp_name, site: item.site, note: 'scanned via app' };
      }));
    }

    return { status: 'ok', results: results,
             updated: items.map(function (i) { return i.barcode; }),
             message: 'บันทึก ' + appends.length + ' รายการใหม่, ' +
                      (results.length - appends.length) + ' รายการเขียนทับ' };
  } catch (err) {
    return { status: 'error', message: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/** เพิ่มหัวคอลัมน์ให้อัตโนมัติถ้ายังไม่มี */
function ensureIdempotencyColumns_(sheet) {
  var head = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), COL_UPDATED_AT)).getValues()[0];
  if (String(head[COL_CLIENT_ID - 1] || '').trim() !== 'client_id') {
    sheet.getRange(1, COL_CLIENT_ID).setValue('client_id');
  }
  if (String(head[COL_UPDATED_AT - 1] || '').trim() !== 'updated_at') {
    sheet.getRange(1, COL_UPDATED_AT).setValue('updated_at');
  }
}

/* ============================================================
   อัปโหลดหลายไฟล์ในคำขอเดียว
   ข้ามไฟล์ที่เคยอัปแล้ว ดูจาก client_id ในชื่อไฟล์
   ทำให้ retry ไม่สร้างไฟล์ซ้ำใน Drive
   ============================================================ */
function uploadPhotosBatch_(files) {
  var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  var results = [];

  files.forEach(function (f) {
    try {
      var cid = String(f.client_id || '').trim();
      var base64 = String(f.image || '');
      var isPdf = base64.indexOf('data:application/pdf') === 0;
      var ext = isPdf ? '.pdf' : '.jpg';
      var baseName = (f.ref_no || f.barcode || 'doc');
      var filename = cid ? (baseName + '__' + cid + ext) : (baseName + ext);

      if (cid) {
        var existing = folder.getFilesByName(filename);
        if (existing.hasNext()) {
          results.push({ client_id: cid, url: existing.next().getUrl(), status: 'exists' });
          return;
        }
      }

      var mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
      var imgData = base64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
      var decoded = Utilities.base64Decode(imgData, Utilities.Charset.UTF_8);
      var blob = Utilities.newBlob(decoded, mimeType, filename);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      results.push({ client_id: cid, url: file.getUrl(), status: 'created' });

    } catch (err) {
      results.push({ client_id: f.client_id || '', url: '', message: err.toString() });
    }
  });

  return { status: 'ok', results: results };
}

/* ============================================================
   เวอร์ชันข้อมูลอ้างอิง — ให้หน้าเว็บเช็คก่อนโหลด CSV ทั้งก้อน
   ใช้เวลาที่ไฟล์ CSV ถูกแก้ล่าสุดเป็นตัวบอกเวอร์ชัน
   ============================================================ */
function handleGetCSVVersion_() {
  try {
    var folder = DriveApp.getFolderById(FOLDER_ID), files = folder.getFiles();
    var latest = 0, name = '';
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().toLowerCase().endsWith('.csv')) {
        var t = f.getLastUpdated().getTime();
        if (t > latest) { latest = t; name = f.getName(); }
      }
    }
    return outputJSON({ status: 'ok', version: String(latest),
                        file: name, updated_at: new Date(latest).toISOString() });
  } catch (err) {
    return outputJSON({ status: 'error', message: err.toString() });
  }
}

/* ============================================================
   บันทึกข้อผิดพลาดจากหน้าเว็บ
   ============================================================ */
function handleLogError_(body) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('ErrorLog') || ss.insertSheet('ErrorLog');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['เวลา', 'หน้า', 'เวอร์ชัน', 'ผู้ใช้', 'ข้อความ', 'รายละเอียด']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), body.page || '', body.version || '', body.emp_id || '',
                     String(body.message || '').slice(0, 500),
                     String(body.detail || '').slice(0, 1000)]);
  } catch (e) { /* ห้ามให้การบันทึก log ทำให้ระบบล้ม */ }
  return outputJSON({ status: 'ok' });
}

/* ให้ Auth.gs / Register.gs ใช้ชื่อเดียวกับของเดิมได้ */
function jsonOut(obj) { return outputJSON(obj); }

function getSheet_(name) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function logError_(where, err) {
  try {
    getSheet_('ErrorLog').appendRow([new Date(), 'GAS:' + where, '', '', String(err), '']);
  } catch (e) {}
}
