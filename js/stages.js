/**
 * ============================================================
 *  ขั้นตอนของเอกสาร และเหตุผลที่ค้าง
 * ============================================================
 *  หลักการ: ความรับผิดชอบตามขั้นตอนที่ค้างอยู่
 *
 *  ถ้าเอกสารค้างที่ "ยังไม่สแกน" คนจัดส่งเป็นคนต้องตอบ
 *  เพราะการสแกนเป็นหน้าที่ของเขา
 *  ถ้าค้างที่ "ส่งแล้วแต่ยังไม่รับ" คลังเป็นคนต้องตอบ
 *
 *  แต่ละคนจึงเห็นเฉพาะงานของตัวเอง ไม่ใช่รายการรวมที่ไม่รู้ว่าใครต้องทำ
 * ============================================================
 */

/** ขั้นตอนที่เอกสารค้างได้ เรียงตามลำดับการทำงานจริง */
export const STAGES = [
  {
    key: 'not_scanned',
    label: 'ยังไม่สแกนเข้าระบบ',
    owner: 'delivery',
    ownerLabel: 'จัดส่ง',
    // เริ่มนับจากวันที่บนเอกสาร เพราะยังไม่มีเหตุการณ์อื่นให้ยึด
    from: 'doc_date',
    dueKey: 'SLA_PDF_DAYS',
    reasonGroups: ['incomplete', 'not_returned', 'lost', 'no_action'],
    test: d => !d.pdf_scanned_at
  },
  {
    key: 'not_shipped',
    label: 'สแกนแล้ว ยังไม่ส่งกระดาษ',
    owner: 'delivery',
    ownerLabel: 'จัดส่ง',
    from: 'pdf_scanned_at',
    dueKey: 'SLA_SHIP_DAYS',
    reasonGroups: ['waiting_batch', 'lost', 'no_action'],
    test: d => !!d.pdf_scanned_at && !d.paper_shipped_at
  },
  {
    key: 'not_received',
    label: 'ส่งแล้ว คลังยังไม่รับ',
    owner: 'warehouse',
    ownerLabel: 'คลังพาเลท',
    from: 'paper_shipped_at',
    dueKey: 'SLA_RECEIVE_DAYS',
    reasonGroups: ['in_transit', 'lost', 'data_mismatch'],
    test: d => !!d.paper_shipped_at && !d.paper_received_at
  },
  {
    key: 'not_boxed',
    label: 'รับแล้ว ยังไม่เข้ากล่อง',
    owner: 'warehouse',
    ownerLabel: 'คลังพาเลท',
    from: 'paper_received_at',
    dueKey: null,          // ไม่มีกำหนด เป็นข้อมูลเสริม
    optional: true,        // ไม่นับว่าค้าง
    reasonGroups: [],
    test: d => !!d.paper_received_at && !d.paper_boxed_at
  }
];

/**
 * กลุ่มเหตุผล
 * action บอกว่าเลือกแล้วระบบควรทำอะไรต่อ ไม่ใช่แค่บันทึกข้อความ
 *
 *   snooze  = เลื่อนกำหนดออกไป ยังไม่ปิด
 *   close   = ปิดเคส ไม่นับใน SLA อีก
 *   fix     = ต้องมีคนไปแก้ข้อมูลย้อนหลัง
 *   reissue = ต้องขอเอกสารใหม่
 */
export const REASON_GROUPS = {
  incomplete: {
    label: 'เอกสารไม่สมบูรณ์',
    color: 'warn',
    reasons: [
      { key: 'no_signature', label: 'ไม่มีลายเซ็นผู้รับ', action: 'reissue' },
      { key: 'no_stamp',     label: 'ไม่มีตราประทับ',    action: 'reissue' },
      { key: 'unreadable',   label: 'เลขอ่านไม่ออก',     action: 'fix' },
      { key: 'damaged',      label: 'เอกสารเสียหาย',     action: 'reissue' }
    ]
  },
  not_returned: {
    label: 'ยังไม่ได้คืนจากปลายทาง',
    color: 'warn',
    reasons: [
      { key: 'customer_hold', label: 'ลูกค้ายังไม่เซ็นคืน',  action: 'snooze' },
      { key: 'carrier_hold',  label: 'ขนส่งยังไม่นำกลับ',   action: 'snooze' }
    ]
  },
  in_transit: {
    label: 'ยังอยู่ระหว่างทาง',
    color: 'ok',
    reasons: [
      { key: 'on_the_way',  label: 'ส่งแล้ว กำลังเดินทาง', action: 'snooze' }
    ]
  },
  waiting_batch: {
    label: 'รอรวมรอบส่ง',
    color: 'ok',
    reasons: [
      { key: 'batching', label: 'รอครบรอบแล้วส่งพร้อมกัน', action: 'snooze' }
    ]
  },
  lost: {
    label: 'สูญหาย',
    color: 'bad',
    reasons: [
      { key: 'lost_carrier',   label: 'ขนส่งทำหาย',      action: 'close' },
      { key: 'lost_warehouse', label: 'หาไม่เจอที่คลัง',  action: 'close' }
    ]
  },
  data_mismatch: {
    label: 'ข้อมูลไม่ตรง',
    color: 'warn',
    reasons: [
      { key: 'received_unlogged', label: 'รับแล้วแต่ลืมบันทึก', action: 'fix' },
      { key: 'duplicate_ref',     label: 'เลขซ้ำกับใบอื่น',    action: 'fix' }
    ]
  },
  no_action: {
    label: 'ไม่ต้องดำเนินการ',
    color: 'muted',
    reasons: [
      { key: 'no_return_needed', label: 'ตกลงว่าไม่ต้องส่งคืน', action: 'close' },
      { key: 'cancelled',        label: 'ยกเลิกรายการ',        action: 'close' }
    ]
  }
};

/** หาว่าเอกสารใบนี้ค้างที่ขั้นไหน */
export function stageOf(doc) {
  for (const s of STAGES) {
    if (s.test(doc)) return s;
  }
  return null;   // จบแล้ว
}

/** เหตุผลทั้งหมดที่เลือกได้ในขั้นนั้น */
export function reasonsFor(stageKey) {
  const s = STAGES.filter(x => x.key === stageKey)[0];
  if (!s) return [];
  return s.reasonGroups.map(g => ({
    key: g,
    label: REASON_GROUPS[g].label,
    color: REASON_GROUPS[g].color,
    reasons: REASON_GROUPS[g].reasons
  }));
}

/** หา action ของเหตุผลที่เลือก */
export function actionOf(reasonKey) {
  for (const g of Object.keys(REASON_GROUPS)) {
    const r = REASON_GROUPS[g].reasons.filter(x => x.key === reasonKey)[0];
    if (r) return { group: g, ...r };
  }
  return null;
}

/**
 * เห็นได้ไหม — ตามบทบาทและไซต์
 *
 * จัดส่งและคลังเห็นเฉพาะไซต์ตัวเอง ส่วนกลางเห็นทุกไซต์
 * ถ้าไม่แยก คนจะเห็นงานที่ตัวเองทำอะไรไม่ได้ แล้วเลิกสนใจทั้งหน้า
 */
export function canSee(user, doc, stage) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'central') return true;

  const sameSite = String(doc.site || '') === String(user.site || '') ||
                   String(doc.dest_warehouse || '') === String(user.site || '');
  if (!sameSite) return false;

  // เห็นเฉพาะขั้นที่ตัวเองรับผิดชอบ
  if (!stage) return true;
  if (stage.owner === 'delivery')  return role === 'delivery' || role === 'staff';
  if (stage.owner === 'warehouse') return role === 'warehouse' || role === 'staff';
  return true;
}
