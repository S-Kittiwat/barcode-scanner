/**
 * ============================================================
 *  แจ้งปัญหาถึงส่วนกลาง
 * ============================================================
 *  ระบบใช้หลายไซต์ การถามกลับไปกลับมาว่า "กด F12 แล้วส่งภาพมา"
 *  ไม่ได้ผลกับคนหน้างาน และเสียเวลาทั้งสองฝ่าย
 *
 *  ปุ่มนี้เก็บสภาพระบบให้อัตโนมัติ พร้อมกับสิ่งที่คนพิมพ์อธิบาย
 *  ปัญหาที่เราเพิ่งไล่กันหลายรอบ — Deploy ไม่ครบ แคชไฟล์เก่า
 *  ข้อมูลอ้างอิงเก่า — ตอบได้ทันทีจากข้อมูลชุดนี้
 * ============================================================
 */

const ERR_KEY = 'docscan.errors.v1';
const MAX_ERRORS = 20;

/**
 * เก็บ error ที่เกิดในหน้า
 *
 * เดิมไม่เก็บเลย พอคนแจ้งว่า "กดแล้วไม่ขึ้น" จึงไม่มีอะไรให้ดู
 * เก็บไว้ในเครื่อง ไม่ส่งไปไหนจนกว่าคนจะกดแจ้งปัญหาเอง
 */
export function installErrorCapture() {
  function push(kind, msg, extra) {
    try {
      const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
      list.push({
        at: new Date().toISOString(),
        page: location.pathname.split('/').pop(),
        kind, msg: String(msg || '').slice(0, 400),
        ...extra
      });
      // เก็บเฉพาะล่าสุด ไม่ให้กินที่ไปเรื่อย ๆ
      localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-MAX_ERRORS)));
    } catch (e) {}
  }

  window.addEventListener('error', e => {
    push('error', e.message, {
      src: (e.filename || '').split('/').pop(),
      line: e.lineno, col: e.colno
    });
  });

  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    push('promise', (r && r.message) || String(r));
  });
}

export function recentErrors() {
  try { return JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); }
  catch (e) { return []; }
}

export function clearErrors() {
  try { localStorage.removeItem(ERR_KEY); } catch (e) {}
}

/**
 * รวบรวมสภาพระบบตอนนี้
 * ทุกอย่างที่จำเป็นต่อการวินิจฉัย โดยไม่มีข้อมูลเอกสารของลูกค้า
 */
export async function collectDiagnostics(session, call) {
  const cfg = window.DOCSCAN_CONFIG || {};
  const d = {
    at: new Date().toISOString(),
    page: location.pathname.split('/').pop() || 'index.html',
    url: location.href,

    app_version: cfg.VERSION || '?',
    api_tail: String(cfg.API_URL || '').slice(-14),

    user: session ? (session.empName || session.empId || '') : '',
    emp_id: session ? (session.empId || '') : '',
    site: session ? (session.site || '') : '',
    role: session ? (session.role || '') : '',

    browser: navigator.userAgent.slice(0, 160),
    screen: window.innerWidth + '×' + window.innerHeight,
    online: navigator.onLine,
    lang: navigator.language,

    errors: recentErrors().slice(-8)
  };

  /* ตรวจว่าเซิร์ฟเวอร์มี action ที่หน้านี้ต้องใช้ไหม
     เป็นสาเหตุอันดับหนึ่งของปัญหาที่เจอมา */
  if (call) {
    try {
      const r = await call('refsStatus', {}, 15000);
      if (r && r.status === 'ok') {
        d.refs_rows = r.rows;
        d.refs_age_days = r.updated_at
          ? Math.round((Date.now() - new Date(r.updated_at).getTime()) / 86400000) : null;
      } else {
        d.refs_error = (r && r.message) || 'ไม่ทราบ';
      }
    } catch (e) {
      d.refs_error = e.message || String(e);
    }
  }

  return d;
}

/** สรุปให้คนอ่านเข้าใจ ก่อนกดส่ง */
export function summarize(d) {
  const L = [];
  L.push('หน้า ' + d.page + ' · เวอร์ชัน ' + d.app_version);
  L.push('ผู้ใช้ ' + (d.user || '—') + ' · ไซต์ ' + (d.site || '—') +
         ' · สิทธิ์ ' + (d.role || '—'));

  if (d.refs_error) L.push('ข้อมูลอ้างอิง: เรียกไม่ได้ — ' + d.refs_error);
  else if (d.refs_rows != null) {
    L.push('ข้อมูลอ้างอิง ' + d.refs_rows.toLocaleString() + ' รายการ' +
           (d.refs_age_days != null ? ' · เก่า ' + d.refs_age_days + ' วัน' : ''));
  }

  L.push('error ที่เก็บได้ ' + (d.errors || []).length + ' รายการ');
  if (!d.online) L.push('เครื่องนี้ออฟไลน์อยู่');
  return L;
}


/* ============================================================
   ปุ่มและกล่องแจ้งปัญหา
   ============================================================ */

const CSS = `
.sup-btn{position:fixed;right:18px;bottom:78px;z-index:850;
  width:44px;height:44px;border-radius:50%;border:1px solid var(--border);
  background:var(--surface);color:var(--muted);font-size:19px;cursor:pointer;
  box-shadow:0 4px 14px rgba(0,0,0,.35)}
.sup-btn:hover{border-color:var(--accent);color:var(--accent)}
@media print{.sup-btn{display:none}}

#dlgSup{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);
  color:var(--text);padding:20px;max-width:560px;width:94vw;margin:auto;inset:0;
  max-height:90vh;overflow:auto}
#dlgSup::backdrop{background:rgba(15,23,42,.82)}
.sup-h{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.sup-t{font-size:16px;font-weight:600}
.sup-s{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.6}
.sup-x{margin-left:auto;background:none;border:none;color:var(--muted);
  font-size:18px;cursor:pointer;padding:0 5px}
.sup-l{display:block;font-size:11.5px;color:var(--muted);margin:10px 0 4px}
#supText{width:100%;height:92px;background:var(--surface2);border:1px solid var(--border);
  border-radius:var(--rs);color:var(--text);font-family:var(--font);font-size:13.5px;
  padding:10px;resize:vertical;line-height:1.7}
#supFile{font-size:12px;color:var(--muted)}
.sup-diag{background:var(--surface2);border:1px solid var(--border);
  border-radius:var(--rs);margin-top:12px}
.sup-diag summary{cursor:pointer;padding:9px 12px;font-size:12.5px}
.sup-diag ul{margin:0;padding:0 12px 12px 30px;font-size:12px;
  color:var(--muted);line-height:1.9}
.sup-act{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;
  padding-top:14px;border-top:1px solid var(--border)}
.sup-act .grow{flex:1}
`;

/**
 * ติดปุ่มแจ้งปัญหาไว้ทุกหน้า
 * @param session ข้อมูลผู้ใช้
 * @param call    ฟังก์ชันเรียก API ของหน้านั้น
 */
export function installSupport(session, call) {
  if (document.getElementById('supBtn')) return;

  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const btn = document.createElement('button');
  btn.id = 'supBtn';
  btn.className = 'sup-btn';
  btn.title = 'แจ้งปัญหาถึงส่วนกลาง';
  btn.textContent = '？';
  document.body.appendChild(btn);

  const dlg = document.createElement('dialog');
  dlg.id = 'dlgSup';
  dlg.innerHTML = `
    <div class="sup-h">
      <div>
        <div class="sup-t">แจ้งปัญหาถึงส่วนกลาง</div>
        <div class="sup-s">ระบบจะแนบสภาพเครื่องและข้อผิดพลาดไปให้อัตโนมัติ<br>
          ไม่มีข้อมูลเอกสารของลูกค้าติดไปด้วย</div>
      </div>
      <button class="sup-x" id="supClose">✕</button>
    </div>

    <label class="sup-l">เกิดอะไรขึ้น <span style="color:var(--danger)">*</span></label>
    <textarea id="supText" placeholder="เช่น กดอ่านเอกสารแล้วไม่ขึ้นอะไรเลย ลองใหม่ 3 รอบแล้ว"></textarea>

    <label class="sup-l">แนบภาพหน้าจอ (ถ้ามี)</label>
    <input type="file" id="supFile" accept="image/*">

    <details class="sup-diag">
      <summary>ข้อมูลที่จะแนบไปด้วย — กดดูได้</summary>
      <ul id="supDiag"><li>กำลังตรวจ…</li></ul>
    </details>

    <div class="sup-act">
      <span class="grow"></span>
      <button class="btn ghost" id="supCancel">ยกเลิก</button>
      <button class="btn" id="supSend" disabled>ส่งให้ส่วนกลาง</button>
    </div>`;
  document.body.appendChild(dlg);

  const $ = id => document.getElementById(id);
  let diag = null;

  btn.addEventListener('click', async () => {
    $('supText').value = '';
    $('supFile').value = '';
    $('supSend').disabled = true;
    $('supDiag').innerHTML = '<li>กำลังตรวจ…</li>';
    dlg.showModal();

    diag = await collectDiagnostics(session, call);
    /* ให้ดูได้ก่อนส่งเสมอ คนต้องรู้ว่าส่งอะไรไป
       ไม่ใช่เก็บข้อมูลลับหลังแล้วส่งโดยไม่บอก */
    $('supDiag').innerHTML = summarize(diag)
      .map(x => '<li>' + escHtml(x) + '</li>').join('');
  });

  $('supText').addEventListener('input', () => {
    $('supSend').disabled = $('supText').value.trim().length < 5;
  });

  $('supClose').addEventListener('click', () => dlg.close());
  $('supCancel').addEventListener('click', () => dlg.close());

  $('supSend').addEventListener('click', async () => {
    const b = $('supSend');
    b.disabled = true; b.textContent = 'กำลังส่ง…';
    try {
      let photo = '';
      const f = $('supFile').files[0];
      if (f) {
        if (f.size > 4 * 1024 * 1024) {
          alert('ภาพใหญ่เกิน 4 MB\nกรุณาย่อขนาดก่อนแนบ');
          return;
        }
        photo = await toDataUrl(f);
      }

      const r = await call('supportSend', {
        message: $('supText').value.trim(),
        diag: diag || {},
        photo: photo
      }, 90000);

      if (!r || r.status !== 'ok') {
        alert((r && r.message) || 'ส่งไม่สำเร็จ');
        return;
      }

      dlg.close();
      alert('ส่งเรื่องแล้ว เลขที่ ' + r.ticket +
            '\n\nส่วนกลางจะได้รับอีเมลแจ้งทันที');
      clearErrors();
    } catch (e) {
      alert('ส่งไม่สำเร็จ: ' + (e.message || e) +
            '\n\nถ้าเชื่อมเซิร์ฟเวอร์ไม่ได้เลย ให้แจ้งทางอื่นแทน');
    } finally {
      b.disabled = false; b.textContent = 'ส่งให้ส่วนกลาง';
    }
  });
}

function toDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(file);
  });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
