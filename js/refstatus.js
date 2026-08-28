/**
 * ============================================================
 *  แถบสถานะข้อมูลอ้างอิง — ใช้ร่วมกันทุกหน้า
 * ============================================================
 *  เดิมมีแค่หน้านำเข้าเอกสาร หน้าอื่นจึงไม่รู้ว่าข้อมูลพร้อมไหม
 *  คนต้องเริ่มทำงานแล้วค่อยพบว่าข้อมูลไม่มา ซึ่งสายเกินไป
 *
 *  แถบนี้บอกสามอย่างที่ต้องรู้ก่อนเริ่มทำอะไร
 *    ข้อมูลอ้างอิงมีไหม เก่าแค่ไหน
 *    เชื่อมเซิร์ฟเวอร์ได้ไหม
 *    โค้ดฝั่งเซิร์ฟเวอร์เป็นรุ่นที่ใช้ได้ไหม
 * ============================================================
 */

/** บอกอายุเป็นหน่วยที่อ่านเข้าใจ ไม่ใช่ "4342 นาทีที่แล้ว" */
export function thaiAgo(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'เมื่อครู่นี้';
  if (m < 60) return m + ' นาทีที่แล้ว';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' ชั่วโมงที่แล้ว';
  const d = Math.round(h / 24);
  if (d < 7) return d + ' วันที่แล้ว';
  return Math.round(d / 7) + ' สัปดาห์ที่แล้ว';
}

const CSS = `
.refbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r);
  padding:9px 14px;margin-bottom:14px;font-size:12.5px}
.refbar .dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
.refbar.ok .dot{background:var(--success)}
.refbar.warn .dot{background:var(--warn)}
.refbar.bad .dot{background:var(--danger)}
.refbar.ok{border-color:rgba(52,211,153,.35)}
.refbar.warn{border-color:var(--warn)}
.refbar.bad{border-color:var(--danger)}
.refbar .sep{color:var(--muted);opacity:.5}
.refbar .muted{color:var(--muted)}
.refbar .grow{flex:1}
.refbar button{background:none;border:1px solid var(--border);border-radius:var(--rs);
  color:var(--muted);padding:4px 10px;font-family:var(--font);font-size:11.5px;cursor:pointer}
.refbar button:hover{border-color:var(--accent);color:var(--text)}
`;

/**
 * ติดแถบสถานะไว้บนสุดของพื้นที่เนื้อหา
 *
 * @param call   ฟังก์ชันเรียก API ของหน้านั้น (action, payload) => Promise
 * @param opts   { mount: element, staleDays: number }
 */
export function installRefBar(call, opts = {}) {
  /* หาจุดติดตั้งเอง เพราะแต่ละหน้าโครงไม่เหมือนกัน
   *
   * เดิมหาแค่ .wrap ซึ่ง 5 หน้าไม่มี แถบจึงไม่ขึ้นและคืน null เงียบ ๆ
   * ไม่มีอะไรบอกว่าติดตั้งไม่สำเร็จ จึงหาสาเหตุยาก
   *
   * ลองหลายแบบตามลำดับ แล้วถ้ายังไม่เจอก็แทรกไว้บนสุดของ body
   * ดีกว่าไม่แสดงอะไรเลย
   */
  const mount = opts.mount ||
    document.querySelector('.wrap') ||
    document.querySelector('main') ||
    document.querySelector('.container') ||
    document.querySelector('.page') ||
    document.body;

  if (!mount) {
    console.warn('[DocScan] ติดตั้งแถบสถานะไม่ได้ — ไม่พบจุดติดตั้ง');
    return null;
  }

  if (!document.getElementById('refbar-css')) {
    const st = document.createElement('style');
    st.id = 'refbar-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  if (document.getElementById('refBar')) return null;   // กันติดตั้งซ้ำ

  const bar = document.createElement('div');
  bar.className = 'refbar';
  bar.id = 'refBar';
  bar.innerHTML = '<span class="dot"></span><span>กำลังตรวจข้อมูลอ้างอิง…</span>';

  /* ถ้าลงที่ body ต้องเลี่ยงแถบบนที่เป็น sticky
     ไม่งั้นจะไปแทรกอยู่เหนือหัวหน้าจนดูแปลก */
  if (mount === document.body) {
    const bar2 = document.querySelector('.topbar, .nav-top, header');
    if (bar2 && bar2.nextSibling) {
      bar.style.margin = '14px 24px 0';
      mount.insertBefore(bar, bar2.nextSibling);
    } else {
      bar.style.margin = '14px 24px 0';
      mount.insertBefore(bar, mount.firstChild);
    }
  } else {
    mount.insertBefore(bar, mount.firstChild);
  }

  const staleMs = (opts.staleDays || 2) * 86400000;

  async function refresh() {
    bar.className = 'refbar';
    bar.innerHTML = '<span class="dot"></span><span>กำลังตรวจข้อมูลอ้างอิง…</span>';
    try {
      const r = await call('refsStatus', {}, 30000);

      if (!r || r.status !== 'ok') {
        /* แยกสองกรณีให้ชัด
           ไม่มีไฟล์ = ต้องนำเข้าข้อมูล
           เรียกไม่ได้ = ปัญหาที่เซิร์ฟเวอร์หรือการ Deploy */
        const msg = (r && r.message) || 'เรียกข้อมูลอ้างอิงไม่ได้';
        bar.className = 'refbar bad';
        bar.innerHTML = '<span class="dot"></span>' +
          '<b>ไม่มีข้อมูลอ้างอิง</b><span class="sep">·</span>' +
          '<span class="muted">' + esc(msg) + '</span>' +
          '<span class="grow"></span>' +
          '<button data-r>ลองใหม่</button>';
        wire();
        return;
      }

      const age = r.updated_at ? Date.now() - new Date(r.updated_at).getTime() : 0;
      const stale = age > staleMs;

      /* เทียบเวอร์ชันโค้ดฝั่งเซิร์ฟเวอร์กับหน้าเว็บ
         ถ้าไม่ตรง แปลว่าอัปไฟล์แล้วแต่ยังไม่ได้ Deploy
         ซึ่งเป็นสาเหตุที่เจอบ่อยและหายากที่สุด */
      const web = (window.DOCSCAN_CONFIG || {}).VERSION || '';
      const srv = r._gv || '';
      if (web && srv && web !== srv) {
        bar.className = 'refbar warn';
        bar.innerHTML = '<span class="dot"></span>' +
          '<b>เซิร์ฟเวอร์ยังไม่ได้ Deploy เวอร์ชันใหม่</b>' +
          '<span class="sep">·</span>' +
          '<span class="muted">หน้าเว็บ ' + esc(web) +
          ' · เซิร์ฟเวอร์ ' + esc(srv) + '</span>' +
          '<span class="grow"></span><button data-r>ตรวจใหม่</button>';
        wire();
        return;
      }

      bar.className = 'refbar ' + (stale ? 'warn' : 'ok');
      bar.innerHTML = '<span class="dot"></span>' +
        '<b>ข้อมูลอ้างอิง ' + (r.rows || 0).toLocaleString() + ' รายการ</b>' +
        '<span class="sep">·</span>' +
        '<span class="muted">อัปเดต ' + thaiAgo(age) + '</span>' +
        (stale ? '<span class="sep">·</span><span>เก่ากว่า ' + (opts.staleDays || 2) +
                 ' วัน เอกสารใหม่อาจเทียบไม่เจอ</span>' : '') +
        '<span class="grow"></span>' +
        '<button data-r>ตรวจใหม่</button>';
      wire();

    } catch (e) {
      /* เรียกไม่ได้เลย มักเป็นเรื่อง Deploy หรือ URL ผิดรุ่น
         บอกไปเลยว่าให้ตรวจอะไร ดีกว่าให้ไปเดาเอง */
      bar.className = 'refbar bad';
      bar.innerHTML = '<span class="dot"></span>' +
        '<b>เชื่อมเซิร์ฟเวอร์ไม่ได้</b><span class="sep">·</span>' +
        '<span class="muted">' + esc(e.message || String(e)) + '</span>' +
        '<span class="grow"></span>' +
        '<button data-c>ตรวจการติดตั้ง</button>' +
        '<button data-r>ลองใหม่</button>';
      wire();
    }
  }

  function wire() {
    const r = bar.querySelector('[data-r]');
    if (r) r.addEventListener('click', refresh);
    const c = bar.querySelector('[data-c]');
    if (c) c.addEventListener('click', () => {
      if (typeof window.checkDeployed === 'function') {
        window.checkDeployed();
        alert('ผลการตรวจอยู่ใน Console\nกด F12 แล้วดูแท็บ Console');
      } else {
        alert('ตรวจไม่ได้ — config.js เป็นรุ่นเก่า\nกด Ctrl+Shift+R เพื่อโหลดใหม่');
      }
    });
  }

  refresh();
  return { refresh, el: bar };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
