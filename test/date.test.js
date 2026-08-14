import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateInput, toDisplayDate, toInputDate } from '../js/date.js';

test('รับรูปแบบที่คนพิมพ์จริงในคลัง', () => {
  assert.equal(parseDateInput('150126'), '2026-01-15');
  assert.equal(parseDateInput('15012026'), '2026-01-15');
  assert.equal(parseDateInput('15/01/26'), '2026-01-15');
  assert.equal(parseDateInput('15/01/2026'), '2026-01-15');
  assert.equal(parseDateInput('15-01-26'), '2026-01-15');
  assert.equal(parseDateInput('5/1/2026'), '2026-01-05');
  assert.equal(parseDateInput(' 150126 '), '2026-01-15');
});

test('ปฏิเสธวันที่ไม่มีอยู่จริง', () => {
  // ตัวเดิมปล่อยผ่านเพราะตรวจแค่ 1..31 ไม่ได้ดูจำนวนวันของเดือน
  assert.equal(parseDateInput('310226'), null, '31 กุมภาพันธ์ ต้องไม่ผ่าน');
  assert.equal(parseDateInput('310426'), null, '31 เมษายน ต้องไม่ผ่าน');
  assert.equal(parseDateInput('290225'), null, '2025 ไม่ใช่ปีอธิกสุรทิน');
  assert.equal(parseDateInput('290224'), '2024-02-29', '2024 เป็นปีอธิกสุรทิน');
});

test('ปฏิเสธค่าที่ไม่ใช่วันที่', () => {
  for (const bad of ['', '   ', 'abc', '1234', '1234567', '00/01/26',
                     '15/13/26', '15/00/26', '15/01/1999', null, undefined]) {
    assert.equal(parseDateInput(bad), null, 'ต้องไม่ผ่าน: ' + String(bad));
  }
});

test('แปลงกลับไปแสดงผลได้ตรงกัน', () => {
  assert.equal(toDisplayDate('2026-01-15'), '15/01/2026');
  assert.equal(toDisplayDate(''), '');
  const iso = parseDateInput('150126');
  assert.equal(parseDateInput(toDisplayDate(iso)), iso, 'แปลงไปกลับต้องได้ค่าเดิม');
});

test('toInputDate รับค่าจาก Sheet ได้หลายรูปแบบ', () => {
  assert.equal(toInputDate('2026-01-15'), '2026-01-15');
  assert.equal(toInputDate('15/01/2026'), '2026-01-15');
  assert.equal(toInputDate(''), '');
  assert.equal(toInputDate('ไม่ใช่วันที่'), '');
});
