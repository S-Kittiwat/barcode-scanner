# vendor — ไลบรารีภายนอกที่เก็บไว้ในโปรเจกต์

## ทำไมต้องเก็บไว้เอง

เดิมโหลดจาก CDN (cdnjs, jsdelivr, unpkg) แต่**เครือข่ายขององค์กรบล็อก**

ผลคืออ่านบาร์โค้ดไม่ได้เลยทุกหน้า และไม่มีอะไรบอกสาเหตุ
เพราะโค้ดจับ error แล้วรายงานว่า "ไม่พบบาร์โค้ด" ซึ่งเป็นคนละเรื่องกัน

เก็บไว้ในโปรเจกต์แล้วโหลดจากที่เดียวกับหน้าเว็บ จึงไม่ต้องพึ่งเครือข่ายภายนอกเลย

## ไฟล์และที่ใช้

| ไฟล์ | ใช้ที่ | ขนาด |
|---|---|---|
| zxing-reader.js + zxing_reader.wasm | อ่านบาร์โค้ด | 0.9 MB |
| tesseract.min.js + worker.min.js | OCR | 0.2 MB |
| tesseract-core-simd-lstm.wasm(.js) | เอนจิน OCR | 6.7 MB |
| lang/eng.traineddata.gz | ข้อมูลภาษาอังกฤษ | 2.8 MB |
| pdf.min.js + pdf.worker.min.js | อ่าน PDF | 1.4 MB |
| pdf-lib.min.js | สร้าง/รวม PDF | 0.5 MB |
| xlsx.full.min.js | ส่งออก Excel | 0.9 MB |
| JsBarcode.all.min.js | พิมพ์บาร์โค้ด | 0.06 MB |
| html5-qrcode.min.js | สแกนด้วยกล้อง | 0.4 MB |

รวมราว 22 MB — GitHub รับได้สบาย (จำกัด 100 MB ต่อไฟล์, 1 GB ต่อ repo)

## ข้อควรรู้

**ไฟล์ .wasm ต้องอยู่คู่กับตัวโหลดเสมอ** ไลบรารีจะไปหา .wasm เองจาก CDN
ถ้าไม่ระบุที่อยู่ใหม่ ดังนั้นอย่าลบไฟล์ .wasm ทิ้งแม้จะดูใหญ่

**อย่าใส่ vendor/ ใน .gitignore** ไม่งั้นระบบจะพังทันทีที่ deploy

## วิธีอัปเดตเวอร์ชัน

```bash
npm install zxing-wasm@<ver> tesseract.js@<ver> pdfjs-dist@<ver> \
            pdf-lib@<ver> xlsx@<ver> jsbarcode@<ver> html5-qrcode@<ver>
# แล้วคัดลอกไฟล์จาก node_modules มาทับใน vendor/
```

ถ้าเปลี่ยนเวอร์ชัน pdf.js ต้องเปลี่ยน pdf.worker ให้ตรงกันด้วย
ไม่งั้นจะพังแบบหาสาเหตุยาก
