// ============================================================
//  DocScan Global Config
//  แก้ไขที่นี่ที่เดียว มีผลทุกหน้า
//
//  ไม่ใช้ ?v= ต่อท้ายไฟล์แล้ว
//
//  เดิมใส่เลขเวอร์ชันต่อท้ายทุกไฟล์เพื่อบังคับให้เบราว์เซอร์โหลดใหม่
//  แต่ต้องแก้ 108 จุดใน 20 หน้าทุกครั้งที่แก้ไฟล์เดียว ซึ่งลืมง่ายมาก
//
//  GitHub Pages ส่ง Cache-Control: max-age=600 มาอยู่แล้ว
//  ผู้ใช้จึงได้ไฟล์ใหม่เองภายใน 10 นาที โดยไม่ต้องทำอะไร
//
//  ถ้าต้องการให้เห็นทันที ให้กด Ctrl+Shift+R
// ============================================================
var DOCSCAN_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwLLuKrYYnKp-xwqZX5A-kBQjPkgfQfxjKeZQ2QTARAZrK4a0TFJzKHqY2yLxcJcGRqhA/exec',
  APP_NAME: 'DocScan',
  VERSION: '2.15.6'
};


/**
 * ตรวจว่าหน้าที่เปิดอยู่ใช้โค้ดและ URL รุ่นไหน
 *
 * เรียกจาก Console: checkDeployed()
 *
 * มีไว้เพราะการหาสาเหตุ "Deploy แล้วแต่ยังไม่ได้ผล" ใช้เวลานานมาก
 * ต้นเหตุมักเป็นเบราว์เซอร์แคช config.js ตัวเก่าไว้
 * แล้วยังชี้ไป URL เดิม ทั้งที่แก้ไฟล์ไปแล้ว
 */
function checkDeployed() {
  var out = {
    version: DOCSCAN_CONFIG.VERSION,
    api_url: DOCSCAN_CONFIG.API_URL,
    api_tail: String(DOCSCAN_CONFIG.API_URL).slice(-14)
  };
  console.log('%c[DocScan] หน้านี้ใช้', 'font-weight:bold');
  console.table(out);

  console.log('กำลังถามเซิร์ฟเวอร์ว่ามี action อะไรบ้าง…');
  var want = ['docsDashboard', 'docsReadyToShip', 'docsScanned',
              'docsFollowup', 'shipCreateBatch', 'shipOpenBatch'];
  var done = 0, miss = [];

  want.forEach(function (a) {
    fetch(DOCSCAN_CONFIG.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: a, token: 'probe' })
    }).then(function (r) { return r.text(); })
      .then(function (t) {
        if (/ไม่รู้จัก action/.test(t)) miss.push(a);
      })
      .catch(function () { miss.push(a + ' (เรียกไม่ได้)'); })
      .finally(function () {
        if (++done === want.length) {
          if (miss.length) {
            console.error('[DocScan] เซิร์ฟเวอร์ยังไม่มี ' + miss.length + ' action:', miss);
            console.error('→ ต้อง Deploy ใหม่ หรือ URL ใน config.js ชี้ผิดรุ่น');
          } else {
            console.log('%c[DocScan] เซิร์ฟเวอร์มี action ครบทุกตัว',
                        'color:#34d399;font-weight:bold');
          }
        }
      });
  });
  return out;
}


/* ============================================================
   ตรวจว่าโมดูลโหลดครบ
   ============================================================
   ไฟล์ใน js/ โหลดเป็น ES module ถ้าไฟล์ใดไฟล์หนึ่งขาด
   ทั้งบล็อกจะไม่ทำงาน หน้าจะว่างเปล่าหรือปุ่มกดไม่ได้
   โดยไม่มีอะไรบอกว่าเพราะอะไร

   เกิดบ่อยเมื่ออัปไฟล์ HTML ใหม่แต่ลืมอัปไฟล์ js ที่เพิ่มมาใหม่
   ตัวนี้จับได้แล้วบอกตรง ๆ ว่าไฟล์ไหนขาด
   ============================================================ */
(function () {
  var failed = [];

  // ดักไฟล์ที่โหลดไม่ได้ ต้องดักก่อนสคริปต์อื่นทำงาน
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT' && t.src) {
      failed.push(String(t.src).split('/').pop().split('?')[0]);
    }
  }, true);

  window.addEventListener('load', function () {
    // ให้โมดูลมีเวลาทำงานก่อนตัดสิน
    setTimeout(check, 900);
  });

  function check() {
    /* หน้าที่ใช้โมดูลจะประกาศ window.DocScan หรือมี import
       ถ้ามี import แต่ไม่มีอะไรทำงานเลย แปลว่าโหลดไม่สำเร็จ */
    var mods = document.querySelectorAll('script[type="module"]');
    if (!mods.length) return;

    var ok = !!(window.DocScan || window.__pageReady ||
                document.querySelector('.dsnav-btn'));
    if (ok && !failed.length) return;

    show(failed);
  }

  function show(list) {
    var files = list.length
      ? list.join(' · ')
      : 'ตรวจไม่ได้ว่าไฟล์ไหน — ดูแท็บ Console หาบรรทัดที่ขึ้น 404';

    var box = document.createElement('div');
    box.setAttribute('style',
      'position:fixed;inset:0;z-index:99999;overflow:auto;' +
      'background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;' +
      'padding:60px 20px;line-height:1.9');
    box.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:26px;' +
      'background:#1e293b;border:1px solid #f87171;border-radius:12px">' +
      '<h2 style="margin:0 0 12px;color:#f87171;font-size:19px">' +
      'หน้านี้โหลดไม่ครบ</h2>' +
      '<p style="margin:0 0 14px">ไฟล์ที่โหลดไม่ได้<br>' +
      '<code style="color:#fbbf24">' + files + '</code></p>' +
      '<p style="margin:0 0 14px"><b>สาเหตุที่พบบ่อยที่สุด</b><br>' +
      'อัปไฟล์ HTML ขึ้นเซิร์ฟเวอร์แล้ว แต่ยังไม่ได้อัปไฟล์ในโฟลเดอร์ ' +
      '<code>js/</code> ที่เพิ่มเข้ามาใหม่</p>' +
      '<p style="margin:0 0 18px;color:#94a3b8;font-size:13px">' +
      'ถ้าเพิ่งอัปไฟล์ไป ลองกด Ctrl+Shift+R เพื่อล้างแคชก่อน</p>' +
      '<button onclick="location.reload(true)" style="background:#60a5fa;' +
      'border:none;border-radius:8px;color:#0f172a;padding:10px 20px;' +
      'font-family:inherit;font-size:14px;font-weight:600;cursor:pointer">' +
      'โหลดใหม่</button></div>';
    document.body.appendChild(box);
    console.error('[DocScan] โหลดโมดูลไม่ครบ', list);
  }
})();
