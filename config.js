// ============================================================
//  DocScan Global Config
//  แก้ไขที่นี่ที่เดียว มีผลทุกหน้า
//
//  สำคัญ: ทุกครั้งที่แก้ไฟล์นี้ ต้องเปลี่ยน VERSION ด้วย
//  และเปลี่ยนเลข ?v= ในทุกหน้า HTML ให้ตรงกัน
//
//  ถ้าไม่เปลี่ยน เบราว์เซอร์จะใช้ไฟล์ที่แคชไว้
//  แล้วยังชี้ไป URL เก่า ทำให้ action ใหม่ใช้ไม่ได้
//  ทั้งที่ Deploy ฝั่งเซิร์ฟเวอร์ไปแล้ว — หาสาเหตุยากมาก
// ============================================================
var DOCSCAN_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzPUMnSaQKw_DB7xyCEiR0EEsrJXZG4-t3Kzed9EV_uUM44Ic_S71rel0RmqLeBbsBKQg/exec',
  APP_NAME: 'DocScan',
  VERSION: '2.15.4'
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
