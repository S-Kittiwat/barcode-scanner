import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, buildIndex, searchCSV, editDistance, findNearMiss,
         classify, hasCollisionRisk, crossCheck } from '../js/csv.js';

test('อ่านฟิลด์ที่มี comma อยู่ในเครื่องหมายคำพูดได้', () => {
  // ตัวเดิมใช้ split(',') จะทำให้ทั้งแถวเลื่อนคอลัมน์
  const csv = 'barcode,customer_destination_name,total\n' +
              'T9648559,"CP Axtra Co., Ltd. (Lotus\'s)",24\n';
  const rows = parseCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].barcode, 'T9648559');
  assert.equal(rows[0].customer_destination_name, "CP Axtra Co., Ltd. (Lotus's)");
  assert.equal(rows[0].total, '24', 'คอลัมน์หลังต้องไม่เลื่อน');
});

test('รับ BOM, CRLF, บรรทัดว่าง และเครื่องหมายคำพูดซ้อน', () => {
  const csv = '\uFEFFbarcode,name\r\nA1,"เขา ""ยืนยัน"" แล้ว"\r\n\r\nA2,ปกติ\r\n';
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'เขา "ยืนยัน" แล้ว');
  assert.equal(rows[1].barcode, 'A2');
});

test('ข้อมูลไม่ครบต้องไม่ทำให้ล้ม', () => {
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('barcode,name'), []);
  assert.deepEqual(parseCSV(null), []);
});

test('ค้นแบบไม่สนตัวพิมพ์และช่องว่าง', () => {
  const idx = buildIndex(parseCSV('barcode,total\nT9648559,24\nPMNO260169207,153\n'));
  assert.ok(searchCSV(idx, 't9648559'));
  assert.ok(searchCSV(idx, '  T9648559 '));
  assert.equal(searchCSV(idx, 'T9648558'), null);
});

test('ระยะแก้ไขจำกัดเพดานถูกต้อง', () => {
  assert.equal(editDistance('T9648559', 'T9648559'), 0);
  assert.equal(editDistance('T9648558', 'T9648559'), 1, 'ต่างหลักเดียว');
  assert.equal(editDistance('19648559', 'T9648559'), 1, 'T อ่านเป็น 1');
  assert.equal(editDistance('T964855', 'T9648559'), 1, 'ขาดไปหนึ่งตัว');
  assert.equal(editDistance('T9648111', 'T9648559'), Infinity, 'ต่างเกินเพดาน');
});

test('เสนอค่าใกล้เคียงเมื่อไม่คลุมเครือ', () => {
  const idx = buildIndex(parseCSV('barcode,total\nT9648559,24\nPMNO260169207,153\n'));
  const near = findNearMiss(idx, 'T9648558');
  assert.ok(near, 'ต้องเสนอได้เมื่อมีผู้สมัครรายเดียว');
  assert.equal(near.barcode, 'T9648559');
});

test('ไม่เสนอเมื่อคลุมเครือหรือไม่จำเป็น', () => {
  const idx = buildIndex(parseCSV('barcode\nT9648550\nT9648551\nT9648559\n'));
  assert.equal(findNearMiss(idx, 'T9648559'), null, 'พบตรงตัวแล้วไม่ต้องเสนอ');
  assert.equal(findNearMiss(idx, 'T9648558'), null, 'ใกล้หลายตัว = คลุมเครือ ไม่เสนอ');
  assert.equal(findNearMiss(idx, ''), null);
  assert.equal(findNearMiss(idx, 'ZZZZZZZZ'), null, 'ไม่ใกล้อะไรเลย');
});

test('ตรวจพบความเสี่ยงชนกันของเลขที่ออกเรียงลำดับ', () => {
  // เลข T จริงจากไฟล์ตัวอย่าง — ในไฟล์เดียวมี 8 คู่ที่ต่างกันแค่หลักเดียว
  const idx = buildIndex(parseCSV(
    'barcode\nT9648565\nT9648564\nT9648559\nT9648551\nT9648550\n'));
  assert.equal(hasCollisionRisk(idx, 'T9648565'), true,
    'T9648565 กับ T9648564 ต่างกันหลักเดียว — อ่านผิดแล้วไปตรงใบอื่นได้');
  assert.equal(hasCollisionRisk(idx, 'PMNO260169207'), false);
});

test('ค่าจาก OCR ที่เสี่ยงชนกัน ต้องไม่ผ่านอัตโนมัติแม้จะพบในรายการ', () => {
  const idx = buildIndex(parseCSV('barcode\nT9648565\nT9648564\n'));

  // นี่คือกรณีอันตรายที่สุด: OCR อ่าน T9648565 ผิดเป็น T9648564
  // ซึ่งเป็นเอกสารจริงอีกใบ — การค้นตรงตัวจะผ่านฉลุยทั้งที่เป็นคนละใบ
  const r = classify({ value: 'T9648564', source: 'ocr' }, idx);
  assert.equal(r.tier, 'red');
  assert.equal(r.reason, 'collision_risk');

  // บาร์โค้ดไม่มีปัญหานี้ เพราะมี checksum ในตัว ไม่เพี้ยนทีละหลัก
  const b = classify({ value: 'T9648564', source: 'barcode' }, idx);
  assert.equal(b.tier, 'green');
});

test('ยืนยันสองฟิลด์ทำให้ค่าจาก OCR ผ่านได้อย่างปลอดภัย', () => {
  const idx = buildIndex(parseCSV(
    'barcode,ref_no\nT9648565,260105632\nT9648564,260105626\n'));

  const good = classify(
    { value: 'T9648565', secondary: '260105632', source: 'ocr' },
    idx, { secondaryField: 'ref_no' });
  assert.equal(good.tier, 'green');
  assert.equal(good.reason, 'cross_confirmed');

  // อ่านเลขหลักผิดหนึ่งหลัก ฟิลด์ที่สองจะไม่ตรง → จับได้
  const bad = classify(
    { value: 'T9648564', secondary: '260105632', source: 'ocr' },
    idx, { secondaryField: 'ref_no' });
  assert.equal(bad.tier, 'red');
  assert.equal(bad.reason, 'cross_mismatch');
});

test('crossCheck รายงานเหตุผลได้ครบทุกกรณี', () => {
  const idx = buildIndex(parseCSV('barcode,ref_no\nT1,100\nT2,200\n'));
  assert.equal(crossCheck(idx, 'T1', '100', 'ref_no').ok, true);
  assert.equal(crossCheck(idx, 'T1', '999', 'ref_no').reason, 'cross_mismatch');
  assert.equal(crossCheck(idx, 'ZZ', '100', 'ref_no').reason, 'primary_not_found');
  assert.equal(crossCheck(idx, 'T1', '', 'ref_no').reason, 'no_secondary');
});

test('การแบ่งชั้นยึดรายการอ้างอิงเป็นหลัก', () => {
  const idx = buildIndex(parseCSV('barcode,total\nT9648559,24\nPMNO260169207,153\n'));

  const a = classify({ value: 'T9648559', source: 'ocr', votesDisagree: true }, idx);
  assert.equal(a.tier, 'red', 'โหมดไม่ตรงกันต้องไม่ผ่านแม้พบในรายการ');

  const b = classify({ value: 'T9648558', source: 'ocr' }, idx);
  assert.equal(b.tier, 'red');
  assert.equal(b.suggestion, 'T9648559');

  const c = classify({ value: 'ZZ999999', source: 'barcode' }, idx);
  assert.equal(c.tier, 'red', 'บาร์โค้ดอ่านได้แต่ไม่มีในรายการ ก็ยังต้องตรวจ');

  assert.equal(classify({ value: '', source: 'manual' }, idx).tier, 'red');
});
