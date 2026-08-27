// ============================================================
//  DocScan — nav.js
//  แหล่งข้อมูลเดียวว่าหน้าไหนใครเข้าได้ และเมนูหน้าตาเป็นอย่างไร
//
//  ทำไมต้องรวมไว้ที่เดียว
//   เดิมแต่ละหน้าเขียนเงื่อนไข role ของตัวเอง กระจายอยู่ 16 ไฟล์
//   เวลาเพิ่มหน้าใหม่หรือเปลี่ยนสิทธิ์ต้องไล่แก้ทุกที่ และลืมง่าย
//
//  ข้อจำกัดสำคัญ
//   เมนูนี้แค่ซ่อนลิงก์ที่ผู้ใช้ไม่มีสิทธิ์ ซึ่งกันคนกดผิดเท่านั้น
//   การกันจริงอยู่ฝั่ง GAS (withAdmin_ / withArchive_ / ACTION_ROLES)
//   ใครแก้ localStorage แล้วเปิดหน้าตรง ๆ ก็ยังยิง API ไม่ผ่านอยู่ดี
// ============================================================

export const ROLE_LABEL = {
  warehouse: 'ทีมคลังพาเลท',
  delivery: 'ทีมจัดส่ง',
  admin: 'ผู้ดูแลระบบ'
};

/**
 * ผังเมนู จัดกลุ่มตามลักษณะงาน ไม่ใช่ตามลำดับที่เคยสร้างไฟล์
 * roles = null หมายถึงทุกคนที่ล็อกอินแล้วเข้าได้
 */
export const NAV = [
  {
    group: 'งานเอกสาร',
    items: [
      {
        id: 'scan', file: 'batch.html', icon: '📄',
        title: 'นำเข้าเอกสาร',
        desc: 'สแกนเอกสารเข้าระบบ — อ่านบาร์โค้ดและ OCR อัตโนมัติ',
        owner: 'ทีมจัดส่ง',
        roles: ['delivery', 'warehouse', 'admin']
      },
      {
        id: 'send', file: 'delivery_batches.html', icon: '🚚',
        title: 'ส่งเอกสารตัวจริง',
        desc: 'รวมเอกสารเป็นชุด บันทึกการส่ง และพิมพ์ใบปะหน้า',
        owner: 'ทีมจัดส่ง',
        roles: ['delivery', 'admin'],
        steps: [
          { file: 'delivery.html',         label: 'เลือกเอกสาร' },
          { file: 'delivery_batches.html', label: 'จัดชุดและส่ง' }
        ]
      },
      {
        id: 'store', file: 'incoming.html', icon: '📦',
        title: 'รับและจัดเก็บเอกสาร',
        desc: 'รับชุดที่ส่งมา ตรวจครบถ้วน แล้วลงทะเบียนเข้ากล่องจัดเก็บ',
        owner: 'ทีมคลังพาเลท',
        roles: ['warehouse', 'admin'],
        steps: [
          { file: 'incoming.html', label: 'ชุดที่มาถึง' },
          { file: 'receive.html',  label: 'ตรวจรับ' },
          { file: 'archive.html',  label: 'เข้ากล่อง' }
        ]
      }
    ]
  },
  {
    group: 'ติดตามและรายงาน',
    items: [
      /* สองหน้านี้เคยเป็นหน้าเดียวกัน แต่ตอบคนละคำถาม
         ค้นหา = รู้เลขอยู่แล้ว อยากได้ไฟล์
         ติดตาม = ไม่รู้ว่าใบไหนมีปัญหา อยากรู้ว่าต้องทำอะไร
         หน้าจอที่ตอบทั้งสองอย่างจะไม่ตอบอันไหนได้ดี */
      { id: 'tracking',  file: 'tracking.html',  icon: '🔎',
        title: 'ค้นหาเอกสาร',
        desc: 'ค้นหาแล้วดาวน์โหลดไฟล์ ทั้งใบเดียวและหลายใบพร้อมกัน', roles: null },
      { id: 'followup',  file: 'followup.html',  icon: '⏱',
        title: 'ติดตามเอกสาร',
        desc: 'ดูว่าใบไหนค้าง อยู่ขั้นไหน นานแค่ไหน และระบุเหตุผล', roles: null },
      { id: 'dashboard', file: 'dashboard.html', icon: '📊',
        title: 'Dashboard',
        desc: 'สรุปภาพรวมและความคืบหน้า', roles: null }
    ]
  },
  {
    group: 'บัญชีและการตั้งค่า',
    items: [
      { id: 'admin', file: 'admin.html', icon: '⚙️',
        title: 'ผู้ดูแลระบบ',
        desc: 'อนุมัติผู้ใช้ จัดการสิทธิ์และรหัสผ่าน', roles: ['admin'] },
      { id: 'pw', file: 'change-password.html', icon: '🔑',
        title: 'เปลี่ยนรหัสผ่าน', desc: '', roles: null }
    ]
  }
];

/** หน้าที่ไม่อยู่ในเมนู แต่ยังต้องรู้ว่าใครเข้าได้ */
export const EXTRA_ROLES = {
  '_scan.html': ['warehouse', 'admin'],
  'admin-tool.html': ['admin'],
  'home.html': null
};

const flat = () => NAV.reduce((a, g) => a.concat(g.items), []);

/**
 * ทุกไฟล์ที่อยู่ในผัง รวมหน้าย่อยของแต่ละขั้นตอน
 * หน้าย่อยใช้สิทธิ์เดียวกับหน้าหลักของกลุ่มนั้น
 */
function fileRoles_(file) {
  for (const it of flat()) {
    if (it.file === file) return it.roles;
    if (it.steps && it.steps.some(s => s.file === file)) return it.roles;
  }
  return undefined;
}

/** หา flow ที่ไฟล์นี้อยู่ ใช้วาดแถบขั้นตอน */
export function flowOf(file) {
  return flat().find(it => it.steps &&
    (it.file === file || it.steps.some(s => s.file === file))) || null;
}

/**
 * ข้อความบอกว่าใครใช้หน้านี้ได้
 * ตัด admin ออกเพราะเข้าได้ทุกหน้าอยู่แล้ว การใส่ไปด้วยทำให้อ่านแล้วสับสน
 * ยกเว้นหน้าที่มีแต่ admin เท่านั้น ต้องบอกให้ชัด
 */
function forRolesText_(roles) {
  if (!roles || !roles.length) return '';
  const others = roles.filter(r => r !== 'admin');
  const list = others.length ? others : roles;
  return list.map(r => ROLE_LABEL[r] || r).join(' · ');
}

/** ชื่อไฟล์ของหน้าปัจจุบัน */
export function currentPage() {
  const p = location.pathname.split('/').pop();
  return p || 'index.html';
}

/** role นี้เปิดหน้านี้ได้ไหม — undefined = ไม่รู้จักหน้านี้ ปล่อยผ่าน */
export function canAccess(role, file) {
  let roles = fileRoles_(file);
  if (roles === undefined) {
    roles = Object.prototype.hasOwnProperty.call(EXTRA_ROLES, file)
      ? EXTRA_ROLES[file] : undefined;
  }
  if (roles === undefined) return true;
  if (roles === null) return true;
  return roles.indexOf(role) !== -1;
}

/**
 * หน้าแรกหลังล็อกอิน — ทุก role ไปหน้ารวมงานเหมือนกัน
 * จะได้เห็นว่าระบบมีอะไรบ้างและตัวเองอยู่ตรงไหนของกระบวนการ
 * แทนที่จะถูกโยนเข้าหน้าใดหน้าหนึ่งโดยไม่เห็นภาพรวม
 */
export function homeFor(role) {
  return 'home.html';
}

/**
 * รายการเมนูทั้งหมดพร้อมธงว่า role นี้เข้าได้ไหม
 *
 * คืนทุกรายการ ไม่ตัดของที่เข้าไม่ได้ทิ้ง แล้วให้หน้าจอแสดงเป็นสีจาง
 * เหตุผล: การซ่อนทำให้คนไม่รู้ว่าระบบมีอะไรบ้าง พอต้องขอสิทธิ์เพิ่ม
 * ก็ไม่รู้ว่าจะขออะไร และผู้ดูแลก็เห็นภาพรวมทั้งระบบได้จากที่เดียว
 */
export function menuFor(role) {
  return NAV.map(g => ({
    group: g.group,
    items: g.items.map(it => ({
      ...it,
      allowed: it.roles === null || it.roles.indexOf(role) !== -1,
      forRoles: forRolesText_(it.roles)
    }))
  }));
}

/** เฉพาะรายการที่เข้าได้ ใช้เวลาต้องนับจำนวนงานจริง */
export function allowedItems(role) {
  return flat().filter(it => it.roles === null || it.roles.indexOf(role) !== -1);
}

/**
 * กันคนเปิดหน้าที่ไม่มีสิทธิ์ — เรียกหลัง requireAuth()
 * ส่งกลับไปหน้าที่เขาเข้าได้ แทนที่จะขึ้นหน้าเปล่า
 */
export function guardPage(session) {
  if (!session) return false;
  const file = currentPage();
  if (canAccess(session.role, file)) return true;
  alert('บัญชีนี้ไม่มีสิทธิ์ใช้งานหน้านี้');
  location.replace(homeFor(session.role));
  return false;
}

/* ============================================================
   ปุ่มเมนูลอย + แผงเมนูเต็มจอ
   ออกแบบให้ไม่แตะ layout ของหน้าเดิมเลย เพราะแต่ละหน้ามีโครงต่างกัน
   การแทรกแถบบนจะทำให้หน้าเดิมเพี้ยนได้ง่าย
   ============================================================ */

const CSS = `
.dsnav-btn{position:fixed;right:18px;bottom:18px;z-index:900;width:52px;height:52px;
  border-radius:50%;border:none;cursor:pointer;background:#38bdf8;color:#0f172a;
  font-size:20px;box-shadow:0 4px 16px rgba(0,0,0,.45);display:flex;
  align-items:center;justify-content:center;font-family:inherit}
.dsnav-btn:hover{background:#0ea5e9}
.dsnav-ov{position:fixed;inset:0;z-index:901;background:rgba(15,23,42,.88);
  display:none;overflow-y:auto;padding:28px 20px 90px}
.dsnav-ov.on{display:block}
.dsnav-in{max-width:760px;margin:0 auto;font-family:'IBM Plex Sans Thai',system-ui,sans-serif}
.dsnav-hd{display:flex;align-items:flex-start;gap:14px;margin-bottom:22px;color:#f1f5f9}
.dsnav-hd .nm{font-size:17px;font-weight:600}
.dsnav-hd .sb{font-size:12.5px;color:#94a3b8;margin-top:3px;line-height:1.6}
.dsnav-hd .x{margin-left:auto;background:none;border:1px solid #334155;color:#94a3b8;
  border-radius:8px;padding:7px 13px;cursor:pointer;font-family:inherit;font-size:13px}
.dsnav-gp{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;
  margin:20px 0 10px;font-family:'IBM Plex Mono',monospace}
.dsnav-gd{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.dsnav-it{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:10px;
  background:#1e293b;border:1px solid #334155;text-decoration:none;color:#f1f5f9;
  transition:border-color .15s}
.dsnav-it:hover{border-color:#38bdf8}
.dsnav-it.cur{border-color:#38bdf8;background:#263348}
.dsnav-it.off{opacity:.38;cursor:not-allowed;background:#172033}
.dsnav-it.off:hover{border-color:#334155}
.dsnav-it .lk{font-size:11px;color:#64748b;margin-top:5px;display:block;
  font-family:'IBM Plex Mono',monospace}
.dsnav-it .ic{font-size:20px;line-height:1}
.dsnav-it .tt{font-size:14.5px;font-weight:600}
.dsnav-it .dd{font-size:12px;color:#94a3b8;margin-top:3px;line-height:1.55}
.dsnav-ft{margin-top:26px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dsnav-out{background:none;border:1px solid #f87171;color:#f87171;border-radius:8px;
  padding:9px 16px;cursor:pointer;font-family:inherit;font-size:13.5px}
.dsnav-ver{margin-left:auto;font-size:11.5px;color:#64748b;font-family:'IBM Plex Mono',monospace}
@media (max-width:520px){.dsnav-gd{grid-template-columns:1fr}}

/* แถบขั้นตอน — ทำให้หลายหน้าในงานเดียวกันดูเป็นระบบเดียว
   วางบนสุดแบบ sticky ไม่แตะ layout เดิมของแต่ละหน้า */
.dsflow{position:sticky;top:0;z-index:800;background:#111a2b;
  border-bottom:1px solid #334155;padding:9px 16px;
  font-family:'IBM Plex Sans Thai',system-ui,sans-serif;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsflow .ti{font-size:13px;font-weight:600;color:#f1f5f9;margin-right:4px}
.dsflow .ow{font-size:11px;color:#64748b;font-family:'IBM Plex Mono',monospace}
.dsflow .sp{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.dsflow a,.dsflow span.st{display:inline-flex;align-items:center;gap:7px;
  padding:6px 13px;border-radius:20px;font-size:12.5px;text-decoration:none;
  border:1px solid #334155;color:#94a3b8;background:#1e293b;white-space:nowrap}
.dsflow a:hover{border-color:#38bdf8;color:#38bdf8}
.dsflow .st.cur{background:#38bdf8;border-color:#38bdf8;color:#0f172a;font-weight:600}
.dsflow .no{font-family:'IBM Plex Mono',monospace;font-size:11px;opacity:.8}
.dsflow .ar{color:#475569;font-size:12px}
@media (max-width:640px){.dsflow .ow{display:none}}
`;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * วาดแถบขั้นตอนบนสุด ถ้าหน้านี้อยู่ในงานที่มีหลายขั้น
 * เรียกอัตโนมัติจาก installNav ไม่ต้องเรียกเอง
 */
export function installFlowBar(session) {
  if (!session || document.getElementById('dsflow')) return;
  const here = currentPage();
  const flow = flowOf(here);
  if (!flow || !flow.steps || flow.steps.length < 2) return;
  if (!canAccess(session.role, here)) return;

  const bar = document.createElement('div');
  bar.className = 'dsflow';
  bar.id = 'dsflow';
  bar.innerHTML =
    `<span class="ti">${flow.icon} ${esc(flow.title)}</span>` +
    (flow.owner ? `<span class="ow">${esc(flow.owner)}</span>` : '') +
    '<span class="sp">' +
    flow.steps.map((st, i) => {
      const num = `<span class="no">${i + 1}</span>`;
      const body = num + esc(st.label);
      const el = st.file === here
        ? `<span class="st cur">${body}</span>`
        : `<a class="st" href="${st.file}">${body}</a>`;
      return (i ? '<span class="ar">›</span>' : '') + el;
    }).join('') +
    '</span>';
  document.body.insertBefore(bar, document.body.firstChild);
}

/**
 * ติดตั้งปุ่มเมนู
 * onLogout ให้ส่งฟังก์ชันของหน้านั้นมา เพราะแต่ละหน้าอาจต้องเก็บงานก่อนออก
 */
export function installNav(session, opts = {}) {
  if (!session || document.getElementById('dsnav-btn')) return;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  installFlowBar(session);

  const here = currentPage();
  const groups = menuFor(session.role);

  const ov = document.createElement('div');
  ov.className = 'dsnav-ov';
  ov.id = 'dsnav-ov';
  ov.innerHTML = `
    <div class="dsnav-in">
      <div class="dsnav-hd">
        <div>
          <div class="nm">${esc(session.empName || session.empId)}</div>
          <div class="sb">${esc(session.empId)} · ${esc(ROLE_LABEL[session.role] || session.role)}<br>
            ${esc(session.site || '')}</div>
        </div>
        <button class="x" id="dsnav-x">ปิด</button>
      </div>
      ${groups.map(g => `
        <div class="dsnav-gp">${esc(g.group)}</div>
        <div class="dsnav-gd">
          ${g.items.map(it => it.allowed ? `
            <a class="dsnav-it${it.file === here ? ' cur' : ''}" href="${it.file}">
              <span class="ic">${it.icon}</span>
              <span><span class="tt">${esc(it.title)}</span>
                ${it.desc ? `<span class="dd">${esc(it.desc)}</span>` : ''}</span>
            </a>` : `
            <span class="dsnav-it off" title="สำหรับ${esc(it.forRoles)}">
              <span class="ic">${it.icon}</span>
              <span><span class="tt">${esc(it.title)}</span>
                ${it.desc ? `<span class="dd">${esc(it.desc)}</span>` : ''}
                <span class="lk">สำหรับ${esc(it.forRoles)}</span></span>
            </span>`).join('')}
        </div>`).join('')}
      <div class="dsnav-ft">
        <button class="dsnav-out" id="dsnav-out">ออกจากระบบ</button>
        <span class="dsnav-ver">v${esc((window.DOCSCAN_CONFIG || {}).VERSION || '')}</span>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const btn = document.createElement('button');
  btn.className = 'dsnav-btn';
  btn.id = 'dsnav-btn';
  btn.title = 'เมนู';
  btn.textContent = '☰';
  btn.addEventListener('click', () => ov.classList.add('on'));
  document.body.appendChild(btn);

  const close = () => ov.classList.remove('on');
  document.getElementById('dsnav-x').addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ov.classList.contains('on')) close();
  });

  document.getElementById('dsnav-out').addEventListener('click', () => {
    if (!confirm('ออกจากระบบ?')) return;
    if (typeof opts.onLogout === 'function') { opts.onLogout(); return; }
    try { localStorage.removeItem('docScanSession'); } catch (e) {}
    location.replace('login.html');
  });
}
