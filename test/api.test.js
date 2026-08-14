import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, uploadBatch, newClientId, ApiError } from '../js/api.js';

const URL_ = 'https://example.test/exec';
const ok = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });

test('client_id ไม่ซ้ำและถูกส่งไปด้วยเสมอ', async () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(newClientId());
  assert.equal(ids.size, 500);

  let sent = null;
  await apiFetch(URL_, { action: 'updateItems' }, {
    fetchImpl: async (u, o) => { sent = JSON.parse(o.body); return ok({ status: 'ok' }); }
  });
  assert.ok(sent.client_id, 'ต้องแนบ client_id ให้อัตโนมัติ');
});

test('client_id เดิมถูกใช้ซ้ำตอน retry — นี่คือสิ่งที่กันข้อมูลซ้ำ', async () => {
  const seen = [];
  let n = 0;
  const res = await apiFetch(URL_, { action: 'updateItems', client_id: 'FIXED-1' }, {
    backoffMs: 1,
    fetchImpl: async (u, o) => {
      seen.push(JSON.parse(o.body).client_id);
      if (++n < 3) throw new TypeError('network down');
      return ok({ status: 'ok' });
    }
  });
  assert.equal(res.status, 'ok');
  assert.deepEqual(seen, ['FIXED-1', 'FIXED-1', 'FIXED-1'],
    'ทุกครั้งที่ retry ต้องใช้ client_id เดิม ไม่งั้น GAS จะ upsert ไม่ได้');
});

test('timeout ทำงานจริง ไม่ค้างรอตลอดไป', async () => {
  const err = await apiFetch(URL_, { action: 'x' }, {
    timeoutMs: 40, retries: 0,
    fetchImpl: (u, o) => new Promise((_, rej) => {
      o.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
      });
    })
  }).catch(e => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.kind, 'timeout');
});

test('retry เฉพาะที่ควร retry', async () => {
  let calls = 0;
  const fail = status => apiFetch(URL_, { action: 'x' }, {
    retries: 2, backoffMs: 1,
    fetchImpl: async () => { calls++; return { ok: false, status, text: async () => '' }; }
  }).catch(e => e);

  calls = 0; await fail(500);
  assert.equal(calls, 3, '500 ควร retry');

  calls = 0; await fail(403);
  assert.equal(calls, 1, '403 ไม่ควร retry — ยิงซ้ำก็ไม่ช่วย');
});

test('เซิร์ฟเวอร์ตอบ error ต้องไม่ถูกตีความว่าสำเร็จ', async () => {
  const err = await apiFetch(URL_, { action: 'x' }, {
    retries: 0,
    fetchImpl: async () => ok({ status: 'error', message: 'ไม่มีสิทธิ์' })
  }).catch(e => e);
  assert.equal(err.kind, 'app');
  assert.match(err.message, /ไม่มีสิทธิ์/);
});

test('ตอบกลับที่ไม่ใช่ JSON (เช่นหน้า login ของ Google) ต้องจับได้', async () => {
  const err = await apiFetch(URL_, { action: 'x' }, {
    retries: 0,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html>' })
  }).catch(e => e);
  assert.equal(err.kind, 'app');
});

test('อัปโหลดเป็นชุด ลดจำนวนคำขอตามที่ตั้งใจ', async () => {
  let requests = 0;
  const files = Array.from({ length: 50 }, (_, i) =>
    ({ client_id: 'c' + i, barcode: 'B' + i, image: 'data:...' }));

  const result = await uploadBatch(URL_, files, {
    uploadChunk: 5,
    fetchImpl: async (u, o) => {
      requests++;
      const body = JSON.parse(o.body);
      return ok({ status: 'ok',
        results: body.files.map(f => ({ client_id: f.client_id, url: 'https://d/' + f.client_id })) });
    }
  });

  assert.equal(requests, 10, '50 ไฟล์ต้องเหลือ 10 คำขอ (เดิม 50)');
  assert.equal(result.size, 50);
  assert.ok([...result.values()].every(r => r.ok));
});

test('ก้อนที่ล้มไม่ทำให้ก้อนอื่นล้มตาม และรายงานรายรายการ', async () => {
  let n = 0;
  const files = Array.from({ length: 10 }, (_, i) => ({ client_id: 'c' + i, barcode: 'B' + i }));

  const result = await uploadBatch(URL_, files, {
    uploadChunk: 5, retries: 0,
    fetchImpl: async (u, o) => {
      if (++n === 1) throw new TypeError('network down');
      const body = JSON.parse(o.body);
      return ok({ status: 'ok',
        results: body.files.map(f => ({ client_id: f.client_id, url: 'https://d/' + f.client_id })) });
    }
  });

  const fails = [...result.values()].filter(r => !r.ok);
  assert.equal(fails.length, 5, 'ก้อนแรกล้ม 5 รายการ');
  assert.equal([...result.values()].filter(r => r.ok).length, 5, 'ก้อนสองยังสำเร็จ');
});

test('รายการที่เซิร์ฟเวอร์ไม่ตอบถึง ต้องนับว่ายังไม่สำเร็จ', async () => {
  const files = [{ client_id: 'a' }, { client_id: 'b' }];
  const result = await uploadBatch(URL_, files, {
    uploadChunk: 5,
    // ตอบกลับมาแค่รายการเดียว
    fetchImpl: async () => ok({ status: 'ok', results: [{ client_id: 'a', url: 'https://d/a' }] })
  });
  assert.equal(result.get('a').ok, true);
  assert.equal(result.get('b').ok, false, 'ห้ามเดาว่าสำเร็จ');
});
