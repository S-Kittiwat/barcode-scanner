# สัญญาระหว่างหน้าเว็บกับ Google Apps Script

เอกสารนี้เป็นข้อตกลงที่ทั้งสองฝั่งต้องตรงกัน **แก้ฝั่งใดฝั่งหนึ่งอย่างเดียวไม่ได้**
โค้ด GAS ไม่ได้อยู่ใน repo เดียวกับหน้าเว็บ ถ้าไม่มีเอกสารนี้ คนที่มารับช่วงต่อจะเห็นแค่ครึ่งเดียวของระบบ

ทุกคำขอเป็น `POST` พร้อม `Content-Type: text/plain;charset=utf-8`
(ต้องเป็น text/plain เพื่อเลี่ยง CORS preflight ที่ GAS ไม่รองรับ)

---

## กฎที่ใช้กับทุก action

**ทุก payload ต้องมี `client_id`** — UUID ที่หน้าเว็บสร้างตอนสร้างรายการ และ**ต้องไม่เปลี่ยนเมื่อส่งซ้ำ**

ฝั่ง GAS ต้อง upsert ตามคีย์นี้เสมอ ห้าม insert อย่างเดียว
เพราะเมื่อบันทึกสำเร็จแล้วแต่คำตอบกลับไปไม่ถึงหน้าเว็บ (เน็ตหลุดตอนขากลับ) หน้าเว็บจะส่งซ้ำ
ถ้า GAS insert ทุกครั้งจะได้แถวซ้ำใน Sheet โดยไม่มีใครรู้ตัวจนถึงตอนสรุปรอบ

**ตอบกลับต้องเป็นรายรายการเสมอ** ห้ามสรุปรวมว่าสำเร็จทั้งหมด
เพราะหน้าเว็บอาจทำงาน offline มาก่อน แล้วเอกสารบางใบถูกคนอื่นรับไปแล้ว

รูปแบบคำตอบเมื่อผิดพลาดทั้งคำขอ:
```json
{ "status": "error", "message": "ข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้" }
```

---

## `updateItems` — บันทึกข้อมูลที่กรอก

**ส่งไป**
```json
{
  "action": "updateItems",
  "client_id": "<uuid ของคำขอ>",
  "items": [
    {
      "client_id": "<uuid ของรายการนี้>",
      "barcode": "T9648559",
      "ref_no": "260104581",
      "item_name": "พาเลทไม้ LOSCAM",
      "transfer_from": "RDC-ลำพูน",
      "origin_acc": "705750",
      "transfer_to": "CP Axtra (Lotus's) LPRDC 981",
      "dest_acc": "705692",
      "despatch_date": "2026-04-25",
      "received_date": "2026-04-25",
      "sent_qty": "24",
      "received_qty": "24",
      "not_found": false,
      "site": "...", "emp_id": "...", "emp_name": "...", "emp_email": "...",
      "photo_url": "https://drive.google.com/...",

      "read_source": "ocr",
      "system_flag": true,
      "human_edited": true,
      "sampled": false,
      "app_version": "1.1.0"
    }
  ]
}
```

**ตอบกลับ**
```json
{
  "status": "ok",
  "results": [
    { "client_id": "...", "status": "created" },
    { "client_id": "...", "status": "updated" },
    { "client_id": "...", "status": "error", "message": "เอกสารนี้ถูกรับไปแล้ว" }
  ]
}
```

`status` รายรายการ: `created` · `updated` · `already_received` · `not_found` · `error`

### สี่ฟิลด์สำหรับวัดความแม่นของระบบอ่านอัตโนมัติ

| ฟิลด์ | ความหมาย |
|---|---|
| `read_source` | ค่านี้มาจากไหน — `barcode` / `ocr` / `manual` |
| `system_flag` | ระบบเตือนว่าไม่มั่นใจหรือไม่ |
| `human_edited` | คนแก้ค่าที่ระบบอ่านได้หรือไม่ |
| `sampled` | ถูกสุ่มมาตรวจหรือไม่ |

สี่ฟิลด์นี้คำนวณเมทริกซ์ความแม่นย้อนหลังได้ทั้งหมด
ช่องที่สำคัญที่สุดคือ `system_flag=false` แต่ `human_edited=true` — คือของผิดที่ระบบปล่อยผ่าน
ซึ่งวัดได้ก็ต่อเมื่อเปิดการสุ่มตรวจไว้เท่านั้น ถ้าปิดสุ่ม ตัวเลขนี้จะเป็น 0 เสมอโดยไม่ได้แปลว่าระบบดี

---

## `uploadPhotos` — อัปโหลดไฟล์เป็นชุด

แทน `uploadPhoto` เดิมที่ส่งทีละไฟล์ (50 หน้า = 50 คำขอ)
ชุดละไม่เกิน 5 ไฟล์ เพราะ GAS มีเพดานเวลารันต่อครั้ง ยัดมากเกินไปจะ timeout ทั้งก้อน

**ส่งไป**
```json
{
  "action": "uploadPhotos",
  "files": [
    { "client_id": "...", "barcode": "T9648559", "ref_no": "260104581",
      "image": "data:application/pdf;base64,JVBERi0..." }
  ]
}
```

**ตอบกลับ**
```json
{ "status": "ok",
  "results": [ { "client_id": "...", "url": "https://drive.google.com/...", "status": "created" } ] }
```

`status`: `created` · `exists` (เคยอัปแล้ว ไม่สร้างซ้ำ)

ชื่อไฟล์ใน Drive คือ `{ref_no}__{client_id}.pdf` — ส่วน `client_id` คือสิ่งที่ทำให้ retry ไม่สร้างไฟล์ซ้ำ

---

## `getCSVVersion` — เช็คว่าข้อมูลอ้างอิงเปลี่ยนไหม

```json
{ "action": "getCSVVersion" }
→ { "status": "ok", "version": "a3f...", "count": 1284, "updated_at": "2026-08-13T02:10:00Z" }
```

หน้าเว็บเก็บ `version` ไว้กับข้อมูลใน IndexedDB ถ้าตรงกันก็ไม่ต้องโหลดใหม่
ฝั่ง GAS ต้องเรียก `bumpCSVVersion()` ทุกครั้งที่ข้อมูลอ้างอิงเปลี่ยน

---

## `getCSV` — ดึงข้อมูลอ้างอิงทั้งชุด

ของเดิม ไม่เปลี่ยน เรียกเฉพาะเมื่อ `version` ไม่ตรงเท่านั้น

**สำคัญ:** ต้อง escape ฟิลด์ที่มี comma ด้วยเครื่องหมายคำพูดตามมาตรฐาน CSV
ชื่อลูกค้าอย่าง `CP Axtra Co., Ltd. (Lotus's)` มีอยู่จริงในข้อมูล
ตัวอ่านฝั่งหน้าเว็บรองรับแล้ว แต่ฝั่งเขียนต้องส่งมาถูกต้องด้วย

---

## `logError` — บันทึกข้อผิดพลาดจากหน้าเว็บ

```json
{ "action": "logError", "page": "batch.html", "version": "1.1.0",
  "emp_id": "...", "message": "...", "detail": "..." }
```

ไม่ต้องรอคำตอบ และห้ามให้การบันทึก log ทำให้ระบบหลักล้ม

---

## เวลาจะแก้อะไร

| แก้อะไร | ต้องแก้ที่ไหนบ้าง |
|---|---|
| เพิ่มฟิลด์ใน `items` | `API.md` → หัวคอลัมน์ในชีต → `submitBatch()` |
| เพิ่ม action ใหม่ | `API.md` → `doPost` ใน `Code.gs` → `/js/api.js` |
| เปลี่ยนขนาดชุดอัปโหลด | `DEFAULTS.uploadChunk` ใน `/js/api.js` เท่านั้น |

หัวคอลัมน์ในชีต `Items` ต้องตรงกับชื่อฟิลด์ใน `items` เป๊ะ ๆ เพราะ `rowFromItem_()` จับคู่ตามชื่อหัวคอลัมน์
