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
  API_URL: 'https://script.google.com/macros/s/AKfycby_hhEFOlCFXft7Uj7i3zJX5m3LkXYnmJkfMbkrMOIjTd7e7znx9_zlIP1X61FPSEyLmw/exec',
  APP_NAME: 'DocScan',
  VERSION: '2.15.7'
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
   ตรวจว่าไฟล์โหลดครบ
   ============================================================
   ไฟล์ใน js/ โหลดเป็น ES module ถ้าไฟล์ใดขาด ทั้งบล็อกจะไม่ทำงาน
   หน้าจะว่างเปล่าหรือปุ่มกดไม่ได้ โดยไม่มีอะไรบอกว่าเพราะอะไร

   เกิดเมื่ออัป HTML ใหม่แต่ลืมอัปไฟล์ js ที่เพิ่มมาใหม่

   บทเรียน: รุ่นแรกเดาจากการที่โมดูล "ไม่ประกาศตัวบอก"
   แต่โมดูลหยุดกลางคันโดยตั้งใจได้หลายกรณี เช่นล็อกอินไม่ผ่าน
   แล้วเปลี่ยนหน้า จึงฟ้องผิดและบล็อกทั้งหน้าจนใช้งานไม่ได้
   ซึ่งแย่กว่าปัญหาที่ตั้งใจจะแก้

   รุ่นนี้จึงตรวจเฉพาะสิ่งที่วัดได้จริง คือมีไฟล์โหลดไม่สำเร็จ
   ============================================================ */
(function () {
  var failed = [];

  window.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || !t.src) return;
    if (t.tagName !== 'SCRIPT') return;
    var name = String(t.src).split('/').pop().split('?')[0];
    if (failed.indexOf(name) === -1) failed.push(name);
  }, true);

  window.addEventListener('load', function () {
    // ให้โมดูลมีเวลาโหลดก่อน แล้วค่อยตัดสิน
    setTimeout(function () {
      if (failed.length) show(failed);
    }, 1200);
  });

  function show(list) {
    /* เตือนแบบไม่บังหน้า
       ถ้าบังทั้งจอแล้วเดาผิด คนจะใช้งานอะไรไม่ได้เลย
       ซึ่งเสียหายกว่าการปล่อยให้เจอปัญหาปลายทาง */
    var bar = document.createElement('div');
    bar.setAttribute('style',
      'position:fixed;left:0;right:0;top:0;z-index:99999;' +
      'background:#7f1d1d;color:#fee2e2;font-family:system-ui,sans-serif;' +
      'font-size:13px;line-height:1.7;padding:10px 16px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.4)');
    bar.innerHTML =
      '<b>โหลดไฟล์ไม่สำเร็จ ' + list.length + ' ไฟล์</b> — ' +
      list.join(' · ') +
      '<br><span style="opacity:.85">' +
      'มักเกิดเมื่ออัป HTML แล้วยังไม่ได้อัปไฟล์ใน js/ · ' +
      'ลองกด Ctrl+Shift+R ก่อน</span>' +
      '<button onclick="this.parentNode.remove()" style="float:right;' +
      'background:none;border:1px solid #fca5a5;border-radius:6px;' +
      'color:#fee2e2;padding:3px 10px;cursor:pointer;font-family:inherit">' +
      'ปิด</button>';
    document.body.appendChild(bar);
    console.error('[DocScan] ไฟล์ที่โหลดไม่ได้', list);
  }
})();
