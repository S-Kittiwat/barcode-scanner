/**
 * ============================================================
 *  สร้างรูปแบบเลขเอกสารจากตัวอย่างจริง
 * ============================================================
 *  ทำไมไม่ให้กรอกรูปแบบตรง ๆ
 *
 *  รูปแบบที่ผิดจะปฏิเสธทุกใบเงียบ ๆ โดยไม่มีอะไรบอกสาเหตุ
 *  เคยเจอมาแล้วกับเลขชุด 8 หลักที่รูปแบบเดิมรับแค่ 7 หลัก
 *  ใช้เวลาหลายรอบกว่าจะรู้ว่าติดตรงนั้น
 *
 *  ให้พิมพ์เลขจริงแทน แล้วให้ระบบหาสิ่งที่เหมือนกันเอง
 *  คนไม่ต้องเข้าใจรูปแบบ แค่เห็นว่ามันจับเลขที่ต้องการได้จริง
 * ============================================================
 */

/** ตัวอักษรที่ OCR มักอ่านสับสนกัน ใส่เผื่อไว้ในรูปแบบ */
const CONFUSABLE = {
  T: 'T7Il|]',
  I: 'Il1|',
  O: 'O0',
  S: 'S5',
  B: 'B8',
  Z: 'Z2'
};

/**
 * แยกเลขเป็นส่วนนำหน้า (ตัวอักษร) กับส่วนตัวเลข
 * T10075206 -> { prefix:'T', digits:'10075206' }
 */
export function splitSample(v) {
  const s = String(v || '').trim().toUpperCase();
  const m = s.match(/^([A-Z]*)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], digits: m[2] };
}

/**
 * ดูตัวอย่างแล้วสรุปว่าเลขชุดนี้หน้าตาอย่างไร
 * คืนสิ่งที่คนอ่านเข้าใจได้ ไม่ใช่ regex
 */
export function describeSamples(samples) {
  const parts = (samples || [])
    .map(splitSample)
    .filter(Boolean);

  if (!parts.length) {
    return { ok: false, message: 'ยังไม่มีตัวอย่างที่ใช้ได้ — ต้องเป็นตัวอักษรตามด้วยตัวเลข' };
  }

  const prefixes = [...new Set(parts.map(p => p.prefix))];
  const lengths = [...new Set(parts.map(p => p.digits.length))].sort((a, b) => a - b);

  // หลักแรกเหมือนกันหมดไหม แยกตามความยาว
  const firstByLen = {};
  parts.forEach(p => {
    const L = p.digits.length;
    (firstByLen[L] = firstByLen[L] || new Set()).add(p.digits[0]);
  });

  return {
    ok: true,
    prefixes,
    minLen: lengths[0],
    maxLen: lengths[lengths.length - 1],
    lengths,
    firstByLen,
    samples: parts
  };
}

/** อธิบายเป็นภาษาคน */
export function explain(desc) {
  if (!desc || !desc.ok) return desc ? desc.message : '';
  const pfx = desc.prefixes.filter(Boolean);
  const head = pfx.length
    ? 'ขึ้นต้นด้วย ' + pfx.join(' หรือ ') + ' '
    : 'เป็นตัวเลขล้วน ';
  const len = desc.minLen === desc.maxLen
    ? 'ตามด้วยตัวเลข ' + desc.minLen + ' หลัก'
    : 'ตามด้วยตัวเลข ' + desc.minLen + ' ถึง ' + desc.maxLen + ' หลัก';
  return head + len;
}

/**
 * สร้างรูปแบบจากสิ่งที่สรุปได้
 *
 * จับให้กว้างพอที่จะรับเลขที่ OCR อ่านเพี้ยนเล็กน้อย
 * แล้วให้ตัวตรวจสอบเป็นคนคัดออกทีหลัง
 * เพราะจับแคบตั้งแต่แรกจะทิ้งค่าที่กู้คืนได้
 */
export function buildPattern(desc) {
  if (!desc || !desc.ok) return null;

  const pfx = desc.prefixes.filter(Boolean);
  let head = '';
  if (pfx.length) {
    // รวมตัวที่ OCR อ่านสับสนกับตัวนำหน้าเข้าไปด้วย
    const chars = new Set();
    pfx.forEach(p => {
      const c = p[0];
      (CONFUSABLE[c] || c).split('').forEach(x => chars.add(x));
    });
    head = '[' + [...chars].join('').replace(/[\]\\^-]/g, '\\$&') + ']?\\s?';
  }

  const lo = desc.minLen, hi = desc.maxLen;
  const body = lo === hi ? '\\d{' + lo + '}' : '\\d{' + lo + ',' + hi + '}';

  return '(?:^|\\D)' + head + '(' + body + ')(?!\\d)';
}

/**
 * สร้างตัวตรวจสอบ — เข้มกว่ารูปแบบ ใช้คัดค่าที่ไม่ถูกต้องออก
 * ยึดหลักแรกของแต่ละความยาวถ้าตัวอย่างตรงกันหมด
 */
export function buildValidator(desc) {
  if (!desc || !desc.ok) return null;

  const pfx = desc.prefixes.filter(Boolean);
  const head = pfx.length ? '(?:' + pfx.join('|') + ')' : '';

  const alts = desc.lengths.map(L => {
    const firsts = [...(desc.firstByLen[L] || [])];
    // หลักแรกตรงกันหมดในตัวอย่าง = ใช้เป็นเงื่อนไขได้
    return firsts.length === 1
      ? firsts[0] + '\\d{' + (L - 1) + '}'
      : '\\d{' + L + '}';
  });

  return '^' + head + '(?:' + alts.join('|') + ')$';
}

/** แม่แบบสำหรับประกอบค่าที่จับได้กลับเป็นเลขเต็ม */
export function buildTemplate(desc) {
  if (!desc || !desc.ok) return '$1';
  const pfx = desc.prefixes.filter(Boolean);
  return pfx.length ? pfx[0] + '$1' : '$1';
}

/**
 * แก้เลขที่ OCR อ่านเพี้ยน โดยอาศัยโครงสร้างที่รู้จากตัวอย่าง
 *
 * ลำดับที่ถูกคือ จับกว้าง แก้ แล้วค่อยตรวจ
 * ถ้าตรวจก่อนแก้ ค่าที่กู้คืนได้จะถูกทิ้งไปตั้งแต่ต้น
 * ซึ่งเป็นความผิดพลาดที่เคยทำให้ OCR อ่านได้แค่ 40%
 *
 * ตัวอย่างจริงบอกว่าเลขความยาวนี้ขึ้นต้นด้วยอะไร
 * ถ้า OCR ให้หลักแรกมาผิด แต่หลักที่เหลือตรง ก็แก้กลับได้
 */
export function fixByStructure(desc, digits) {
  if (!desc || !desc.ok || !digits) return digits;
  const d = String(digits);

  // ความยาวตรงกับที่รู้จัก และหลักนำหน้าคงที่ในตัวอย่าง
  const known = {};
  desc.samples.forEach(p => {
    const L = p.digits.length;
    (known[L] = known[L] || new Set()).add(p.digits.slice(0, 2));
  });

  for (const L of Object.keys(known)) {
    const heads = [...known[L]];
    if (heads.length !== 1) continue;
    const head = heads[0];

    // ยาวเท่ากัน หลักที่สองตรง แต่หลักแรกผิด
    if (d.length === +L && d[1] === head[1] && d[0] !== head[0]) {
      return head[0] + d.slice(1);
    }
    // สั้นไปหนึ่งหลัก และเริ่มด้วยหลักที่สองของชุดนำ = หลักแรกหายไป
    if (d.length === +L - 1 && d[0] === head[1]) {
      return head[0] + d;
    }
  }
  return d;
}

/**
 * ทดสอบรูปแบบกับข้อความ
 * คืนผลที่คนดูแล้วรู้ทันทีว่าใช้ได้ไหม
 */
export function testPattern(pattern, validator, template, text, desc) {
  let re, va;
  try { re = new RegExp(pattern); } catch (e) { return { ok: false, error: 'รูปแบบไม่ถูกต้อง' }; }
  try { va = validator ? new RegExp(validator) : null; }
  catch (e) { return { ok: false, error: 'ตัวตรวจสอบไม่ถูกต้อง' }; }

  const m = String(text || '').match(re);
  if (!m) return { ok: false, value: '', reason: 'ไม่ตรงรูปแบบ' };

  // แก้ก่อนตรวจเสมอ ไม่ใช่ตรวจก่อนแก้
  const raw = m[1] || '';
  const fixed = desc ? fixByStructure(desc, raw) : raw;
  const value = String(template || '$1').replace(/\$(\d)/g, (_, d) =>
    (+d === 1 ? fixed : (m[+d] || '')));

  if (va && !va.test(value)) {
    return { ok: false, value, reason: 'จับได้ ' + value + ' แต่ไม่ผ่านการตรวจสอบ' };
  }
  return { ok: true, value, fixed: fixed !== raw };
}

/** ค่าที่ไม่ควรถูกจับ ใช้เตือนเมื่อรูปแบบกว้างเกินไป */
export const COMMON_TRAPS = [
  { v: '4009121114', why: 'เลข DO' },
  { v: '15082026',   why: 'วันที่ในฟอร์ม' },
  { v: '20260825',   why: 'วันที่แบบปีขึ้นก่อน' },
  { v: '260196319',  why: 'เลขลูกค้า' },
  { v: '705750',     why: 'เลขที่บัญชี' },
  { v: '70-5339',    why: 'ทะเบียนรถ' },
  { v: '2026',       why: 'ปี' }
];

/**
 * ตรวจว่ารูปแบบไปจับเลขอื่นในฟอร์มด้วยไหม
 *
 * นี่คือส่วนที่สำคัญที่สุดของการให้คนตั้งรูปแบบเอง
 * รูปแบบที่กว้างเกินไปจะจับวันที่หรือเลข DO มาตั้งชื่อไฟล์
 * แล้วไม่มีใครรู้จนกว่าจะหาไฟล์ไม่เจอในอีกหลายเดือน
 */
export function checkTraps(pattern, validator, template, desc) {
  const hits = [];
  COMMON_TRAPS.forEach(t => {
    const r = testPattern(pattern, validator, template, t.v, desc);
    if (r.ok) hits.push({ value: t.v, why: t.why, got: r.value });
  });
  return hits;
}

/**
 * เสนอวิธีทำให้รูปแบบแคบลง เมื่อพบว่าไปจับเลขอื่น
 * คืนตัวตรวจสอบที่เข้มขึ้นโดยยึดหลักนำหน้าจากตัวอย่างจริง
 */
export function tightenValidator(desc) {
  if (!desc || !desc.ok) return null;

  const pfx = desc.prefixes.filter(Boolean);
  const head = pfx.length ? '(?:' + pfx.join('|') + ')' : '';

  /* ใช้สองหลักแรกแทนหลักเดียว ถ้าตัวอย่างตรงกันหมด
     เลขเอกสารมักมีชุดนำที่คงที่ ส่วนวันที่ไม่มี */
  const alts = desc.lengths.map(L => {
    const two = new Set();
    desc.samples.filter(p => p.digits.length === L)
      .forEach(p => two.add(p.digits.slice(0, 2)));
    if (two.size === 1) {
      return [...two][0] + '\\d{' + (L - 2) + '}';
    }
    const one = new Set();
    desc.samples.filter(p => p.digits.length === L)
      .forEach(p => one.add(p.digits[0]));
    return one.size === 1
      ? [...one][0] + '\\d{' + (L - 1) + '}'
      : '\\d{' + L + '}';
  });

  return '^' + head + '(?:' + alts.join('|') + ')$';
}


/**
 * สรุปชุดนำหน้าของแต่ละความยาว ใช้แก้เลขที่อ่านหลักแรกผิด
 * เก็บเฉพาะที่ตัวอย่างตรงกันหมด เพราะถ้าไม่ตรงก็เดาไม่ได้
 */
export function buildHeads(desc) {
  if (!desc || !desc.ok) return null;
  const heads = {};
  const byLen = {};
  desc.samples.forEach(p => {
    const L = p.digits.length;
    (byLen[L] = byLen[L] || new Set()).add(p.digits.slice(0, 2));
  });
  Object.keys(byLen).forEach(L => {
    const v = [...byLen[L]];
    if (v.length === 1) heads[L] = v[0];
  });
  return Object.keys(heads).length ? heads : null;
}


/* ============================================================
   เรียนโครงสร้างจากสิ่งที่ระบบอ่านได้เอง
   ============================================================
   ใช้เมื่อคนไม่ได้ตั้งรูปแบบไว้

   หลักการ: เอกสารชุดเดียวกันมีเลขหน้าตาเหมือนกัน
   ถ้าอ่าน 40 ใบแล้ว 30 ใบขึ้นต้นด้วย "10" อีก 10 ใบขึ้นต้นด้วย 2 หรือ 4
   แปลว่า 10 ใบนั้น OCR อ่านหลักแรกผิด ไม่ใช่ว่าเป็นเลขคนละชุด

   วัดกับเอกสารจริง 20 หน้า: จาก 2/20 เป็น 18/20
   โดยที่คนไม่ต้องตั้งค่าอะไรเลย
   ============================================================ */

/** นับว่าอะไรพบบ่อยที่สุด */
function topOf(counts) {
  let best = null, n = -1;
  Object.keys(counts).forEach(k => { if (counts[k] > n) { n = counts[k]; best = k; } });
  return best;
}

/**
 * ดูเลขดิบทั้งชุดแล้วสรุปว่าเลขชนิดนี้หน้าตาอย่างไร
 * rawValues คือค่าที่ OCR อ่านได้ก่อนแก้ อาจมีตัวที่ผิดปนอยู่
 */
export function learnFromReadings(rawValues) {
  const parts = (rawValues || []).map(splitSample).filter(Boolean);
  if (parts.length < 3) return null;      // น้อยเกินกว่าจะสรุปได้

  const lenCount = {}, preCount = {};
  parts.forEach(p => {
    lenCount[p.digits.length] = (lenCount[p.digits.length] || 0) + 1;
    preCount[p.prefix] = (preCount[p.prefix] || 0) + 1;
  });

  const mainLen = +topOf(lenCount);
  const prefix = topOf(preCount) || '';

  // สองหลักแรกของเลขที่ยาวเท่ากับความยาวหลัก
  const headCount = {};
  parts.filter(p => p.digits.length === mainLen)
       .forEach(p => {
         const h = p.digits.slice(0, 2);
         headCount[h] = (headCount[h] || 0) + 1;
       });

  const head = topOf(headCount);
  if (!head) return null;

  /* ต้องมีเสียงข้างมากชัดเจนถึงจะเชื่อ
     ถ้าครึ่งต่อครึ่ง แปลว่าอาจเป็นเลขคนละชุดจริง ไม่ใช่อ่านผิด */
  const total = Object.keys(headCount).reduce((n, k) => n + headCount[k], 0);
  if (headCount[head] / total < 0.5) return null;

  const heads = {};
  heads[mainLen] = head;

  return {
    prefix, mainLen, head, heads,
    confidence: headCount[head] / total,
    samples: parts.length
  };
}

/** แก้เลขให้ตรงกับโครงสร้างที่เรียนได้ */
export function applyLearned(learned, value) {
  if (!learned || !value) return value;
  const p = splitSample(value);
  if (!p) return value;

  let d = p.digits;
  const L = learned.mainLen, head = learned.head;

  // ยาวเท่ากัน หลักที่สองตรง แต่หลักแรกผิด
  if (d.length === L && d[1] === head[1] && d[0] !== head[0]) d = head[0] + d.slice(1);
  // สั้นไปหนึ่งหลัก และเริ่มด้วยหลักที่สองของชุดนำ = หลักแรกหายไป
  else if (d.length === L - 1 && d[0] === head[1]) d = head[0] + d;

  return (p.prefix || learned.prefix) + d;
}
