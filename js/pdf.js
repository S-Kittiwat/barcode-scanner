// ============================================================
//  DocScan — pdf.js
//  บีบไฟล์ก่อนอัปโหลด และกำหนดโฟลเดอร์จัดเก็บตามเดือน
//
//  ทำไมต้องบีบ: ที่ 20,000 ใบ/เดือน ไฟล์ต้นฉบับกินราว 8.25 GB ต่อเดือน
//  ซึ่งเกินพื้นที่ที่มีภายในไม่กี่เดือน
//
//  ทำไมต้องขาวดำ 200dpi: ทดสอบกับเอกสารจริงแล้ว
//    ต้นฉบับสี      432 KB/หน้า
//    เทา 150dpi     113 KB/หน้า
//    ขาวดำ 200dpi    36 KB/หน้า   ← เลือกอันนี้
//    ขาวดำ 150dpi    25 KB/หน้า   ← เล็กกว่าแต่บาร์โค้ด CMD อ่านไม่ออก
//
//  200dpi คือขั้นต่ำที่ยังอ่านบาร์โค้ดได้ครบและ OCR ได้ 8/8
//  ห้ามลดลงกว่านี้เพื่อประหยัดพื้นที่
// ============================================================

export const SETTINGS = {
  dpi: 200,           // ห้ามต่ำกว่านี้ — วัดแล้วบาร์โค้ดเริ่มไม่มีระยะห่าง
  quality: 0.65,      // คุณภาพ JPEG
  maxPixels: 40e6     // กันหน้าใหญ่ผิดปกติทำให้เบราว์เซอร์ค้าง
};

/* ผลการวัดกับเอกสารจริง (เฉลี่ย 11 หน้าจาก CMD/ECD/LOSCAM)
     ต้นฉบับ        432 KB/หน้า
     สี 200dpi q75  237 KB
     สี 200dpi q65  206 KB   ← ใช้ค่านี้
     สี 200dpi q55  185 KB
     สี 200dpi q45  167 KB

   ทุกค่าอ่านบาร์โค้ดและ OCR ได้ครบเท่ากัน และทนการลดขนาดได้เท่ากันหมด
   (CMD ถึง 70% · ECD ถึง 50%) เพราะตัวจำกัดคือความละเอียด ไม่ใช่คุณภาพ JPEG
   จึงเลือก q65 เพื่อให้ภาพคมพอสำหรับการตรวจสอบย้อนหลังด้วยสายตา

   วิธีที่ลองแล้วไม่ได้ผล อย่าเสียเวลาลองซ้ำ
     ล้างพื้นหลังให้ขาวสนิท  ใหญ่ขึ้น เพราะขอบคมทำให้ JPEG ทำงานหนัก
     ลดจำนวนสีแล้วเก็บ PNG  เบราว์เซอร์สร้าง PNG แบบพาเลทไม่ได้ ได้ 256 KB
     บีบเทาเฉพาะหน้าไม่มีสี  ทุกหน้ามีสี 0.6-1.5% จากลายเซ็นและตราประทับ  */

/** เดือนปัจจุบันในรูปแบบ YYYY-MM ตามเวลาไทย ใช้เป็นชื่อโฟลเดอร์ */
export function storagePeriod(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * เรนเดอร์หน้า PDF เป็นภาพขาวดำ
 * ใช้ค่าตัดแบบคงที่ ไม่ใช่ Otsu เพราะเอกสารสแกนมีพื้นที่ว่างเยอะ
 * ทำให้ Otsu เลือกค่าเพี้ยนได้ในหน้าที่มีข้อความน้อย
 */
async function renderColor(page, dpi, maxPixels) {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  if (base.width * base.height * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (base.width * base.height));
  }
  const vp = page.getViewport({ scale });

  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width);
  cv.height = Math.floor(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return cv;
}

function canvasToJpegBytes(cv, quality) {
  return new Promise((resolve, reject) => {
    cv.toBlob(blob => {
      if (!blob) { reject(new Error('แปลงภาพไม่สำเร็จ')); return; }
      blob.arrayBuffer().then(b => resolve(new Uint8Array(b)), reject);
    }, 'image/jpeg', quality);
  });
}

/**
 * แปลงหนึ่งหน้าของ PDF ต้นฉบับเป็นไฟล์ PDF ขาวดำใบเดียว
 *
 * pdfJsDoc  เอกสารที่เปิดด้วย pdf.js แล้ว (ส่งเข้ามา ไม่เปิดใหม่ทุกหน้า)
 * pageNum   เลขหน้า เริ่มที่ 1
 */
export async function compressPage(pdfJsDoc, pageNum, opts = {}) {
  const o = { ...SETTINGS, ...opts };
  const page = await pdfJsDoc.getPage(pageNum);

  const cv = await renderColor(page, o.dpi, o.maxPixels);
  const jpg = await canvasToJpegBytes(cv, o.quality);
  const w = cv.width, h = cv.height;
  cv.width = cv.height = 0;          // คืนหน่วยความจำทันที
  page.cleanup();

  const out = await PDFLib.PDFDocument.create();
  const embedded = await out.embedJpg(jpg);
  // ขนาดหน้าเป็นจุด (72 ต่อนิ้ว) เพื่อให้พิมพ์ออกมาได้ขนาดเท่าต้นฉบับ
  const pw = w * 72 / o.dpi, ph = h * 72 / o.dpi;
  const p = out.addPage([pw, ph]);
  p.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });

  return out.save();
}

/** แปลง Uint8Array เป็น data URL แบบไม่ล้น call stack เมื่อไฟล์ใหญ่ */
export function toDataUrl(bytes, mime = 'application/pdf') {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:' + mime + ';base64,' + btoa(binary);
}

/** บีบภาพถ่ายเอกสาร (กรณีถ่ายรูปแทนการสแกน) ให้เป็น PDF สีแบบเดียวกัน */
export async function compressImageFile(file, opts = {}) {
  const o = { ...SETTINGS, ...opts };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('เปิดไฟล์ภาพไม่ได้'));
      im.src = url;
    });

    let w = img.naturalWidth, h = img.naturalHeight;
    if (w * h > o.maxPixels) {
      const k = Math.sqrt(o.maxPixels / (w * h));
      w = Math.floor(w * k); h = Math.floor(h * k);
    }

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const jpg = await canvasToJpegBytes(cv, o.quality);
    cv.width = cv.height = 0;

    const out = await PDFLib.PDFDocument.create();
    const em = await out.embedJpg(jpg);
    const pw = w * 72 / o.dpi, ph = h * 72 / o.dpi;
    out.addPage([pw, ph]).drawImage(em, { x: 0, y: 0, width: pw, height: ph });
    return out.save();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** สรุปผลการบีบ ไว้แสดงให้ผู้ใช้เห็นว่าประหยัดไปเท่าไหร่ */
export function compressionSummary(rows) {
  let before = 0, after = 0, n = 0;
  rows.forEach(r => {
    if (r.originalBytes && r.compressedBytes) {
      before += r.originalBytes; after += r.compressedBytes; n++;
    }
  });
  if (!n) return null;
  return {
    count: n, before, after,
    ratio: before ? (1 - after / before) : 0,
    text: (before / 1048576).toFixed(1) + ' MB → ' + (after / 1048576).toFixed(1) +
          ' MB (ลด ' + Math.round((1 - after / before) * 100) + '%)'
  };
}

/* ============================================================
   บีบภาพถ่ายทั่วไป (รูปตำแหน่งจัดเก็บ)
   ต่างจากเอกสาร: ห้ามทำขาวดำ เพราะจะดูไม่ออกว่าเป็นชั้นไหนตู้ไหน
   ใช้ JPEG คุณภาพกลาง ย่อด้านยาวเหลือ 1280 พอให้เห็นป้ายและตำแหน่ง
   ============================================================ */

export const PHOTO_SETTINGS = { maxSide: 1280, quality: 0.62 };

export async function compressPhoto(file, opts = {}) {
  const o = { ...PHOTO_SETTINGS, ...opts };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('เปิดไฟล์รูปไม่ได้'));
      im.src = url;
    });

    let w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, o.maxSide / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const dataUrl = cv.toDataURL('image/jpeg', o.quality);
    cv.width = cv.height = 0;
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** ประเมินขนาดจริงของ data URL เป็นไบต์ */
export function dataUrlBytes(dataUrl) {
  const i = String(dataUrl).indexOf(',');
  if (i < 0) return 0;
  return Math.round((String(dataUrl).length - i - 1) * 3 / 4);
}
