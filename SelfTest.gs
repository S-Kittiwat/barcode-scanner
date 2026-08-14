/**
 * ============================================================
 *  DocScan — SelfTest.gs
 *  ทดสอบว่าการกันข้อมูลซ้ำทำงานจริงก่อนเปิดใช้งาน
 *
 *  วิธีใช้: เลือกฟังก์ชัน testIdempotency แล้วกด Run
 *           ดูผลใน Execution log
 *
 *  ทดสอบโดยเรียกฟังก์ชันภายในตรง ๆ ไม่ผ่าน doPost
 *  จึงไม่ต้องมี token และทดสอบได้ก่อนสร้างบัญชีผู้ดูแล
 *
 *  ลบไฟล์นี้ทิ้งได้หลังทดสอบผ่าน
 * ============================================================
 */

/**
 * ทดสอบครบวงจร — สร้างข้อมูลทดสอบ ตรวจ แล้วลบทิ้งเอง
 * ไม่กระทบข้อมูลจริง เพราะใช้ barcode ที่ขึ้นต้นด้วย ZZTEST-
 */
function testIdempotency() {
  var log = [];
  var pass = 0, fail = 0;

  function check(name, ok, detail) {
    if (ok) { pass++; log.push('  ผ่าน   ' + name); }
    else    { fail++; log.push('  ไม่ผ่าน ' + name + (detail ? '  → ' + detail : '')); }
  }

  var testId = Utilities.getUuid();
  var testBarcode = 'ZZTEST-' + testId.slice(0, 8);

  log.push('=== ทดสอบการกันข้อมูลซ้ำ ===');
  log.push('client_id ที่ใช้ทดสอบ: ' + testId);
  log.push('barcode ที่ใช้ทดสอบ: ' + testBarcode);
  log.push('');

  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(LOG_SHEET);

    /* ---- 0. ตรวจว่าเปิดชีตได้ ---- */
    check('เปิดชีต ' + LOG_SHEET + ' ได้', !!sheet,
          'ตรวจ SHEET_ID กับชื่อชีตใน Code.gs');
    if (!sheet) throw new Error('หยุดทดสอบ');

    var rowsBefore = sheet.getLastRow();
    log.push('  จำนวนแถวก่อนทดสอบ: ' + rowsBefore);
    log.push('');

    var item = {
      client_id: testId,
      barcode: testBarcode,
      ref_no: 'TEST-REF-1',
      item_name: 'รายการทดสอบ',
      emp_id: 'TESTER', emp_name: 'ระบบทดสอบ',
      emp_email: 'test@example.com', site: 'TEST-SITE',
      sent_qty: 10, received_qty: 10
    };

    /* ---- 1. ส่งครั้งแรก ---- */
    var r1 = updateItemsIdempotent_([item]);
    check('ครั้งที่ 1 ตอบ status ok', r1.status === 'ok', JSON.stringify(r1).slice(0, 150));
    check('ครั้งที่ 1 รายงานว่า created',
          r1.results && r1.results[0] && r1.results[0].status === 'created',
          r1.results ? JSON.stringify(r1.results[0]) : 'ไม่มี results');
    SpreadsheetApp.flush();

    var after1 = countRowsByClientId_(sheet, testId);
    check('ครั้งที่ 1 ได้ 1 แถว', after1 === 1, 'พบ ' + after1 + ' แถว');

    /* ---- 2. ส่งซ้ำด้วย client_id เดิม — จุดสำคัญที่สุด ---- */
    item.received_qty = 99;   // แก้ค่าเพื่อดูว่าเขียนทับจริงไหม
    var r2 = updateItemsIdempotent_([item]);
    check('ครั้งที่ 2 ตอบ status ok', r2.status === 'ok', JSON.stringify(r2).slice(0, 150));
    check('ครั้งที่ 2 รายงานว่า updated ไม่ใช่ created',
          r2.results && r2.results[0] && r2.results[0].status === 'updated',
          r2.results ? JSON.stringify(r2.results[0]) : 'ไม่มี results');
    SpreadsheetApp.flush();

    var after2 = countRowsByClientId_(sheet, testId);
    check('*** ส่งซ้ำแล้วยังมีแถวเดียว ***', after2 === 1,
          'พบ ' + after2 + ' แถว — การกันข้อมูลซ้ำไม่ทำงาน ห้ามเปิดใช้ระบบ');

    /* ---- 3. ค่าถูกเขียนทับจริงไหม ---- */
    var row = findRowByClientId_(sheet, testId);
    if (row) {
      var qty = sheet.getRange(row, 16).getValue();   // P = received_qty
      check('ค่าถูกเขียนทับเป็นค่าใหม่', Number(qty) === 99,
            'received_qty = ' + qty + ' (ควรเป็น 99)');
    }

    /* ---- 4. ส่งสามรายการพร้อมกัน โดยมีของเดิมปนอยู่ ---- */
    var newId = Utilities.getUuid();
    var r3 = updateItemsIdempotent_([
      item,                                                   // ของเดิม
      { client_id: newId, barcode: testBarcode + '-B', emp_id: 'TESTER' }  // ของใหม่
    ]);
    SpreadsheetApp.flush();
    check('ส่งปนกันแล้วของเดิมยังไม่ซ้ำ', countRowsByClientId_(sheet, testId) === 1);
    check('ส่งปนกันแล้วของใหม่ถูกสร้าง', countRowsByClientId_(sheet, newId) === 1);

    /* ---- 5. doc_log ต้องไม่บวมด้วยแถว scanned ซ้ำ ---- */
    var docCount = countDocLogByBarcode_(testBarcode);
    check('doc_log มีแถว scanned ของ barcode นี้แค่ครั้งเดียว', docCount === 1,
          'พบ ' + docCount + ' แถว — ส่งซ้ำไม่ควรเพิ่มแถวใน doc_log');

    /* ---- 6. ตรวจหัวคอลัมน์ ---- */
    var head = sheet.getRange(1, COL_CLIENT_ID).getValue();
    check('มีหัวคอลัมน์ client_id ที่คอลัมน์ S', String(head).trim() === 'client_id',
          'พบ "' + head + '"');

    /* ---- ลบข้อมูลทดสอบ ---- */
    var removed = cleanupTestRows_([testId, newId], testBarcode);
    log.push('');
    log.push('  ลบข้อมูลทดสอบแล้ว ' + removed + ' แถว');
    log.push('  จำนวนแถวหลังทดสอบ: ' + sheet.getLastRow() +
             ' (ก่อนทดสอบ ' + rowsBefore + ')');

  } catch (err) {
    fail++;
    log.push('  เกิดข้อผิดพลาด: ' + err.toString());
  }

  log.push('');
  log.push('=== สรุป: ผ่าน ' + pass + ' / ไม่ผ่าน ' + fail + ' ===');
  log.push(fail === 0
    ? 'ผ่านทั้งหมด — เปิดใช้งานระบบต่อได้'
    : 'ยังไม่ผ่าน — ห้ามเปิดใช้ระบบ ดูรายการที่ไม่ผ่านด้านบน');

  var out = log.join('\n');
  Logger.log(out);
  return out;
}

/* ---------------- ตัวช่วย ---------------- */

function countRowsByClientId_(sheet, clientId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, COL_CLIENT_ID, last - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(clientId).trim()) n++;
  }
  return n;
}

function findRowByClientId_(sheet, clientId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, COL_CLIENT_ID, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(clientId).trim()) return i + 2;
  }
  return 0;
}

function countDocLogByBarcode_(barcode) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(DOC_LOG_SHEET);
  if (!sheet) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, 2, last - 1, 1).getValues();   // B = barcode
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(barcode).trim()) n++;
  }
  return n;
}

/** ลบแถวทดสอบทั้งใน Collectionsheet และ doc_log */
function cleanupTestRows_(clientIds, barcodePrefix) {
  var removed = 0;
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var sheet = ss.getSheetByName(LOG_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var vals = sheet.getRange(2, COL_CLIENT_ID, sheet.getLastRow() - 1, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (clientIds.indexOf(String(vals[i][0]).trim()) > -1) {
        sheet.deleteRow(i + 2); removed++;
      }
    }
  }

  var dl = ss.getSheetByName(DOC_LOG_SHEET);
  if (dl && dl.getLastRow() > 1) {
    var dvals = dl.getRange(2, 2, dl.getLastRow() - 1, 1).getValues();
    for (var j = dvals.length - 1; j >= 0; j--) {
      if (String(dvals[j][0]).indexOf(barcodePrefix) === 0) {
        dl.deleteRow(j + 2); removed++;
      }
    }
  }

  SpreadsheetApp.flush();
  return removed;
}

/**
 * เผื่อกรณีทดสอบล้มกลางคันแล้วมีข้อมูลทดสอบค้าง
 * ลบทุกแถวที่ barcode ขึ้นต้นด้วย ZZTEST-
 */
function cleanupAllTestRows() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var removed = 0;

  var sheet = ss.getSheetByName(LOG_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var vals = sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).getValues();   // F = barcode
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]).indexOf('ZZTEST-') === 0) { sheet.deleteRow(i + 2); removed++; }
    }
  }

  var dl = ss.getSheetByName(DOC_LOG_SHEET);
  if (dl && dl.getLastRow() > 1) {
    var dvals = dl.getRange(2, 2, dl.getLastRow() - 1, 1).getValues();
    for (var j = dvals.length - 1; j >= 0; j--) {
      if (String(dvals[j][0]).indexOf('ZZTEST-') === 0) { dl.deleteRow(j + 2); removed++; }
    }
  }

  SpreadsheetApp.flush();
  return 'ลบข้อมูลทดสอบแล้ว ' + removed + ' แถว';
}
