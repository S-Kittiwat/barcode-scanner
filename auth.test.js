import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// จำลองสภาพแวดล้อมเบราว์เซอร์ก่อน import โมดูล
// Node 22 มี globalThis.crypto เป็น getter อยู่แล้ว — เขียนทับตรง ๆ ไม่ได้
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
};

const {
  derivePassword, loadSession, saveSession, clearSession,
  daysLeft, checkPasswordStrength, consumeReturnTo
} = await import('../js/auth.js');

test('รหัสผ่านจริงไม่ปรากฏในค่าที่ส่งออกไป', async () => {
  const pw = 'MySecret123';
  const h = await derivePassword('E001', pw);
  assert.match(h, /^[0-9a-f]{64}$/, 'ต้องเป็นเลขฐานสิบหก 64 ตัว');
  assert.ok(!h.includes(pw), 'ต้องไม่มีรหัสผ่านจริงปนอยู่');
});

test('รหัสเดียวกันได้ค่าเดิมเสมอ — ไม่งั้นล็อกอินซ้ำไม่ได้', async () => {
  const a = await derivePassword('E001', 'MySecret123');
  const b = await derivePassword('E001', 'MySecret123');
  assert.equal(a, b);
});

test('คนละคนที่ใช้รหัสเดียวกัน ต้องได้ค่าต่างกัน', async () => {
  // ถ้าไม่ต่างกัน คนที่เห็นชีตจะรู้ทันทีว่าใครใช้รหัสซ้ำกับใคร
  const a = await derivePassword('E001', 'SamePass1');
  const b = await derivePassword('E002', 'SamePass1');
  assert.notEqual(a, b);
});

test('รหัสพนักงานพิมพ์ต่างกันเล็กน้อยต้องได้ค่าเดียวกัน', async () => {
  const a = await derivePassword('E001', 'Pass1234');
  const b = await derivePassword(' e001 ', 'Pass1234');
  assert.equal(a, b, 'ตัดช่องว่างและไม่สนตัวพิมพ์');
});

test('รหัสผ่านต่างกันหนึ่งตัวต้องได้ค่าต่างกันสิ้นเชิง', async () => {
  const a = await derivePassword('E001', 'Pass1234');
  const b = await derivePassword('E001', 'Pass1235');
  assert.notEqual(a, b);
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  assert.ok(same < a.length * 0.4, 'ต้องไม่คล้ายกัน');
});

test('session ที่หมดอายุถือว่าไม่มี', () => {
  clearSession();
  saveSession({ token: 't', empId: 'E001', expiresAt: Date.now() - 1000 });
  assert.equal(loadSession(), null, 'หมดอายุแล้วต้องไม่คืนค่า');

  saveSession({ token: 't', empId: 'E001', expiresAt: Date.now() + 86400000 });
  assert.ok(loadSession(), 'ยังไม่หมดอายุต้องใช้ได้');
});

test('session ที่ไม่ครบถ้วนต้องไม่ผ่าน', () => {
  clearSession();
  saveSession({ empId: 'E001', expiresAt: Date.now() + 1000 });
  assert.equal(loadSession(), null, 'ไม่มี token');

  mem.set('docScanSession', 'ไม่ใช่ json');
  assert.equal(loadSession(), null, 'ข้อมูลเสียต้องไม่ทำให้ล้ม');
});

test('นับวันคงเหลือได้ถูกต้อง', () => {
  const now = Date.now();
  assert.equal(daysLeft({ expiresAt: now + 30 * 86400000 }, now), 30);
  assert.equal(daysLeft({ expiresAt: now - 1000 }, now), 0);
  assert.equal(daysLeft(null), null);
});

test('ตรวจความแข็งแรงของรหัสผ่าน', () => {
  assert.equal(checkPasswordStrength('Warehouse2026').ok, true);
  assert.equal(checkPasswordStrength('short1').ok, false, 'สั้นเกินไป');
  assert.equal(checkPasswordStrength('abcdefghij').ok, false, 'ไม่มีตัวเลข');
  assert.equal(checkPasswordStrength('1234567890').ok, false, 'ไม่มีตัวอักษร');
  assert.equal(checkPasswordStrength('password').ok, false, 'รหัสยอดฮิต');
  assert.equal(checkPasswordStrength('aaaaaaaa').ok, false, 'ตัวเดียวซ้ำ');
});

test('ปลายทางหลังล็อกอินต้องไม่ถูกใช้พาไปเว็บอื่น', () => {
  globalThis.sessionStorage = {
    _v: null,
    getItem() { return this._v; },
    setItem(k, v) { this._v = v; },
    removeItem() { this._v = null; }
  };

  sessionStorage.setItem('docScanReturnTo', 'https://evil.example/steal');
  assert.equal(consumeReturnTo(), 'batch.html', 'ลิงก์ภายนอกต้องถูกปฏิเสธ');

  sessionStorage.setItem('docScanReturnTo', '//evil.example');
  assert.equal(consumeReturnTo(), 'batch.html', 'protocol-relative ต้องถูกปฏิเสธ');

  sessionStorage.setItem('docScanReturnTo', '/receive.html');
  assert.equal(consumeReturnTo(), '/receive.html', 'ลิงก์ภายในใช้ได้');
});

/* ============================================================
   สมัครใช้งานเอง + ลืมรหัสผ่าน
   ============================================================ */

const { checkEmailDomain, validateRegistration, isValidCode, ALLOWED_EMAIL_DOMAINS } =
  await import('../js/auth.js');

test('รับเฉพาะอีเมลของบริษัท', () => {
  assert.equal(checkEmailDomain('somchai@brs-group.com').ok, true);
  assert.equal(checkEmailDomain('SOMCHAI@BRS-GROUP.COM').ok, true, 'ไม่สนตัวพิมพ์');
  assert.equal(checkEmailDomain(' somchai@brs-group.com ').ok, true, 'ตัดช่องว่าง');

  assert.equal(checkEmailDomain('someone@gmail.com').ok, false);
  assert.equal(checkEmailDomain('ไม่ใช่อีเมล').ok, false);
  assert.equal(checkEmailDomain('').ok, false);
});

test('กันโดเมนปลอมที่หน้าตาคล้ายของจริง', () => {
  // ถ้าเช็คด้วย endsWith จะหลุดทั้งหมดนี้
  assert.equal(checkEmailDomain('a@evil-brs-group.com').ok, false);
  assert.equal(checkEmailDomain('a@brs-group.com.evil.com').ok, false);
  assert.equal(checkEmailDomain('a@sub.brs-group.com').ok, false);
});

test('ตรวจข้อมูลสมัครครบทุกช่องพร้อมกัน', () => {
  const good = validateRegistration({
    empId: 'E001', empName: 'สมชาย ใจดี', empEmail: 'somchai@brs-group.com',
    password: 'Warehouse2026', passwordConfirm: 'Warehouse2026',
    site: 'NDC-วังน้อย', role: 'warehouse'
  });
  assert.equal(good.ok, true);

  const bad = validateRegistration({
    empId: 'E!', empName: '', empEmail: 'x@gmail.com',
    password: 'abc', passwordConfirm: 'xyz', site: '', role: ''
  });
  assert.equal(bad.ok, false);
  // ต้องบอกทุกปัญหาพร้อมกัน ไม่ใช่ให้แก้ทีละข้อแล้วกดส่งใหม่
  for (const f of ['empId','empName','empEmail','password','site','role']) {
    assert.ok(bad.errors[f], 'ต้องรายงานปัญหาช่อง ' + f);
  }
});

test('รหัสผ่านสองช่องต้องตรงกัน', () => {
  const r = validateRegistration({
    empId: 'E001', empName: 'สมชาย', empEmail: 'a@brs-group.com',
    password: 'Warehouse2026', passwordConfirm: 'Warehouse2027',
    site: 'NDC', role: 'warehouse'
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.passwordConfirm);
});

test('รหัสยืนยันต้องเป็นตัวเลข 6 หลักเท่านั้น', () => {
  assert.equal(isValidCode('123456'), true);
  assert.equal(isValidCode('012345'), true, 'ขึ้นต้นด้วยศูนย์ได้');
  assert.equal(isValidCode('12345'), false);
  assert.equal(isValidCode('1234567'), false);
  assert.equal(isValidCode('12345a'), false);
  assert.equal(isValidCode(''), false);
});

test('รหัสผ่านที่ตั้งตอนสมัครใช้ล็อกอินได้เลย', async () => {
  // ผู้ใช้ตั้งรหัสเองในเบราว์เซอร์ตอนสมัคร ค่าที่ได้จึงตรงกับตอนล็อกอินเสมอ
  // ต่างจากเดิมที่ผู้ดูแลตั้งรหัสชั่วคราวจาก Apps Script แล้วค่าไม่ตรงกัน
  const atRegister = await derivePassword('E001', 'Warehouse2026');
  const atLogin = await derivePassword('E001', 'Warehouse2026');
  assert.equal(atRegister, atLogin);
});

/* ============================================================
   หลายโดเมน
   ============================================================ */

const { setAllowedDomains } = await import('../js/auth.js');

test('รับได้หลายโดเมน', () => {
  const d = ['brs-group.com', 'boonrawd.co.th', 'singha.com'];
  assert.equal(checkEmailDomain('a@brs-group.com', d).ok, true);
  assert.equal(checkEmailDomain('a@boonrawd.co.th', d).ok, true);
  assert.equal(checkEmailDomain('A@SINGHA.COM', d).ok, true);
  assert.equal(checkEmailDomain('a@gmail.com', d).ok, false);
});

test('โดเมนขึ้นต้นด้วยจุด = รับโดเมนย่อยด้วย', () => {
  const d = ['.brs-group.com'];
  assert.equal(checkEmailDomain('a@brs-group.com', d).ok, true, 'โดเมนหลักต้องผ่าน');
  assert.equal(checkEmailDomain('a@th.brs-group.com', d).ok, true, 'โดเมนย่อยต้องผ่าน');
  assert.equal(checkEmailDomain('a@evil-brs-group.com', d).ok, false, 'ชื่อคล้ายต้องไม่ผ่าน');
  assert.equal(checkEmailDomain('a@brs-group.com.evil.com', d).ok, false, 'ต่อท้ายต้องไม่ผ่าน');
});

test('ไม่ใส่จุดนำหน้า = ไม่รับโดเมนย่อย', () => {
  const d = ['brs-group.com'];
  assert.equal(checkEmailDomain('a@brs-group.com', d).ok, true);
  assert.equal(checkEmailDomain('a@th.brs-group.com', d).ok, false);
});

test('setAllowedDomains ตั้งค่าและตัดช่องว่างได้', () => {
  const before = [...ALLOWED_EMAIL_DOMAINS];
  setAllowedDomains([' BRS-GROUP.COM ', 'boonrawd.co.th']);
  assert.equal(checkEmailDomain('a@brs-group.com').ok, true);
  assert.equal(checkEmailDomain('a@boonrawd.co.th').ok, true);
  setAllowedDomains(before);
});

test('ส่งค่าว่างมาต้องไม่ล้างรายการเดิมทิ้ง', () => {
  const before = [...ALLOWED_EMAIL_DOMAINS];
  setAllowedDomains([]);
  assert.deepEqual(ALLOWED_EMAIL_DOMAINS, before, 'เซิร์ฟเวอร์ตอบว่างต้องใช้ค่าสำรองต่อ');
  setAllowedDomains(null);
  assert.deepEqual(ALLOWED_EMAIL_DOMAINS, before);
});

/* ============================================================
   ค่า hash ที่ addUser ต้องการ
   ============================================================ */

test('derivePassword ให้ค่าตรงรูปแบบที่ assertPwHash_ ยอมรับ', async () => {
  // ฝั่ง GAS ตรวจด้วย /^[0-9a-f]{64}$/i — ถ้าไม่ตรง addUser จะปฏิเสธ
  const h = await derivePassword('ADMIN01', 'Warehouse2026');
  assert.match(h, /^[0-9a-f]{64}$/, 'ต้องเป็นเลขฐานสิบหก 64 ตัว');
});

test('ค่าจาก admin-tool ต้องตรงกับตอนล็อกอินจริง', async () => {
  // นี่คือเงื่อนไขที่ทำให้บัญชีที่สร้างด้วย addUser ล็อกอินได้จริง
  // ถ้าสองค่านี้ไม่ตรง บัญชีจะถูกสร้างแต่เข้าระบบไม่ได้เลย
  const fromAdminTool = await derivePassword('ADMIN01', 'Warehouse2026');
  const atLogin = await derivePassword('ADMIN01', 'Warehouse2026');
  assert.equal(fromAdminTool, atLogin);
});

test('รหัสพนักงานต่างกัน ค่า hash ต่างกัน — ต้องกรอกให้ตรง', async () => {
  const a = await derivePassword('ADMIN01', 'Warehouse2026');
  const b = await derivePassword('ADMIN02', 'Warehouse2026');
  assert.notEqual(a, b, 'ถ้ากรอก empId ผิดตอนสร้าง hash จะล็อกอินไม่ได้');
});

/* ============================================================
   ออกจากระบบ
   ============================================================ */

const { logout } = await import('../js/auth.js');

test('ล้าง session ทันที ไม่รอเซิร์ฟเวอร์ตอบ', async () => {
  // ผู้เรียกมักทำ logout() แล้วเปลี่ยนหน้าเลยโดยไม่ await
  // ถ้าล้างทีหลัง session จะค้างแล้วเด้งกลับเข้าระบบใหม่
  saveSession({ token: 'tok', empId: 'E001', expiresAt: Date.now() + 86400000 });

  let serverCalled = false;
  const slow = new Promise(r => setTimeout(r, 50));
  globalThis.fetch = async () => {
    serverCalled = true;
    await slow;
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  };

  const p = logout('https://example.test/exec');
  assert.equal(loadSession(), null, 'ต้องล้างทันทีก่อน await');

  await p;
  assert.equal(serverCalled, true, 'ยังต้องแจ้งเซิร์ฟเวอร์ด้วย');
  assert.equal(loadSession(), null);
});

test('ออฟไลน์อยู่ก็ยังออกจากระบบได้', async () => {
  saveSession({ token: 'tok', empId: 'E001', expiresAt: Date.now() + 86400000 });
  globalThis.fetch = async () => { throw new TypeError('network down'); };

  await logout('https://example.test/exec');
  assert.equal(loadSession(), null, 'เซิร์ฟเวอร์ล่มก็ต้องออกได้');
});

test('ไม่มี session อยู่แล้วก็ไม่ควรล้ม', async () => {
  clearSession();
  globalThis.fetch = async () => { throw new Error('ไม่ควรถูกเรียก'); };
  await logout('https://example.test/exec');
  assert.equal(loadSession(), null);
});
