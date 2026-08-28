// ============================================================
//  DocScan — store.js
//  ที่เก็บข้อมูลในเครื่อง 3 อย่าง
//    draft  — งานที่ทำค้างอยู่ (กันหายตอน refresh/ปิดเครื่อง)
//    outbox — คิวรอส่งขึ้นเซิร์ฟเวอร์ (ทำงานต่อได้ตอนเน็ตล่ม)
//    ref    — ข้อมูลอ้างอิงเอกสาร พร้อมเวอร์ชัน
//
//  ใช้ IndexedDB ไม่ใช่ localStorage เพราะ
//   · localStorage เพดาน 5 MB และเป็น synchronous — บล็อก UI
//   · IndexedDB เก็บ Uint8Array ได้ตรง ๆ ไม่ต้องแปลงเป็น base64 ที่เปลืองอีก 33%
// ============================================================

const DB_NAME = 'docscan';
const DB_VERSION = 1;
const STORES = { draft: 'draft', outbox: 'outbox', ref: 'ref' };

let _db = null;

export function openDB(indexedDBImpl) {
  const idb = indexedDBImpl || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.draft))
        db.createObjectStore(STORES.draft, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.outbox))
        db.createObjectStore(STORES.outbox, { keyPath: 'client_id' });
      if (!db.objectStoreNames.contains(STORES.ref))
        db.createObjectStore(STORES.ref, { keyPath: 'key' });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ---------------- draft ---------------- */

export async function saveDraft(id, payload) {
  const db = await openDB();
  return tx(db, STORES.draft, 'readwrite', s =>
    s.put({ id, savedAt: Date.now(), payload }));
}
export async function loadDraft(id) {
  const db = await openDB();
  const rec = await tx(db, STORES.draft, 'readonly', s => s.get(id));
  return rec || null;
}
export async function clearDraft(id) {
  const db = await openDB();
  return tx(db, STORES.draft, 'readwrite', s => s.delete(id));
}

/** หน่วงการเขียน — กันการเขียนถี่ตอนคนพิมพ์ */
export function makeDraftSaver(id, waitMs = 1500) {
  let timer = null, pending = null;
  const flush = async () => {
    if (!pending) return;
    const data = pending; pending = null;
    try { await saveDraft(id, data); } catch (e) { console.warn('[draft] เขียนไม่สำเร็จ', e); }
  };
  return {
    schedule(data) {
      pending = data;
      clearTimeout(timer);
      timer = setTimeout(flush, waitMs);
    },
    flushNow() { clearTimeout(timer); return flush(); }
  };
}

/* ---------------- outbox ---------------- */

export async function enqueue(item) {
  const db = await openDB();
  return tx(db, STORES.outbox, 'readwrite', s =>
    s.put({ ...item, queuedAt: Date.now(), attempts: 0, lastError: '' }));
}
export async function listQueue() {
  const db = await openDB();
  const items = await tx(db, STORES.outbox, 'readonly', s => s.getAll());
  return (items || []).sort((a, b) => a.queuedAt - b.queuedAt);
}
export async function markAttempt(clientId, error) {
  const db = await openDB();
  const rec = await tx(db, STORES.outbox, 'readonly', s => s.get(clientId));
  if (!rec) return null;
  rec.attempts = (rec.attempts || 0) + 1;
  rec.lastError = error || '';
  rec.lastTriedAt = Date.now();
  return tx(db, STORES.outbox, 'readwrite', s => s.put(rec));
}
export async function dequeue(clientId) {
  const db = await openDB();
  return tx(db, STORES.outbox, 'readwrite', s => s.delete(clientId));
}
export async function queueSize() {
  const db = await openDB();
  const n = await tx(db, STORES.outbox, 'readonly', s => s.count());
  return n || 0;
}

/* ---------------- reference data ---------------- */

export async function saveReference(rowsData, version) {
  const db = await openDB();
  return tx(db, STORES.ref, 'readwrite', s =>
    s.put({ key: 'csv', version: version || '', syncedAt: Date.now(), rows: rowsData }));
}
export async function loadReference() {
  const db = await openDB();
  const rec = await tx(db, STORES.ref, 'readonly', s => s.get('csv'));
  return rec || null;
}

/** ข้อมูลอ้างอิงเก่ากี่ชั่วโมงแล้ว — ใช้เตือนบนหน้าจอ */
export function ageHours(rec, now = Date.now()) {
  if (!rec || !rec.syncedAt) return null;
  return (now - rec.syncedAt) / 3600000;
}
