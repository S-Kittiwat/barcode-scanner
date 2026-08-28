// ============================================================
//  DocScan — date.js
//  แปลงวันที่ระหว่างรูปแบบที่คนพิมพ์ กับรูปแบบที่ระบบเก็บ
//  ระบบเก็บเป็น ISO (YYYY-MM-DD) เสมอ แสดงผลเป็น DD/MM/YYYY เสมอ
// ============================================================

/** ISO (2026-01-15) → ที่แสดงบนหน้าจอ (15/01/2026) */
export function toDisplayDate(isoVal) {
  if (!isoVal) return '';
  const p = String(isoVal).split('-');
  if (p.length === 3 && p[0].length === 4) return p[2] + '/' + p[1] + '/' + p[0];
  return isoVal;
}

/** ค่าจาก CSV/Sheet ที่อาจมาหลายรูปแบบ → ISO สำหรับใส่ input[type=date] */
export function toInputDate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = parseDateInput(s);
  if (iso) return iso;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }
  return '';
}

function validate(d, m, y) {
  const dd = parseInt(d, 10), mm = parseInt(m, 10), yy = parseInt(y, 10);
  if (!(dd >= 1 && mm >= 1 && mm <= 12 && yy >= 2000 && yy <= 2099)) return null;
  // ตรวจจำนวนวันจริงของเดือนนั้น — 31/02 ต้องไม่ผ่าน
  const last = new Date(yy, mm, 0).getDate();
  if (dd > last) return null;
  return String(yy) + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}

/**
 * สิ่งที่คนพิมพ์ → ISO หรือ null ถ้าไม่ถูกต้อง
 * รับ: 150126 · 15012026 · 15/01/26 · 15/01/2026 · 15-01-26 · 15 01 2026
 * ปีสองหลักตีความเป็น 20xx เสมอ (เอกสารชุดนี้ไม่มีย้อนไปก่อนปี 2000)
 */
export function parseDateInput(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[-.\s]/g, '/');
  if (!s) return null;

  if (s.indexOf('/') > -1) {
    const p = s.split('/').filter(x => x !== '');
    if (p.length !== 3) return null;
    if (!/^\d{1,2}$/.test(p[0]) || !/^\d{1,2}$/.test(p[1])) return null;
    if (!/^\d{2}$|^\d{4}$/.test(p[2])) return null;
    const y = p[2].length === 2 ? '20' + p[2] : p[2];
    return validate(p[0], p[1], y);
  }

  const digits = s.replace(/\D/g, '');
  if (digits.length !== s.length) return null;          // มีอักขระแปลกปน
  if (digits.length === 6) return validate(digits.slice(0,2), digits.slice(2,4), '20' + digits.slice(4,6));
  if (digits.length === 8) return validate(digits.slice(0,2), digits.slice(2,4), digits.slice(4,8));
  return null;
}

/** วันนี้ในรูปแบบ ISO ตามเวลาเครื่อง (ไม่ใช่ UTC — สำคัญสำหรับไทย UTC+7) */
export function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}
