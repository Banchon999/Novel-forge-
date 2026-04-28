/* ═══════════════════════════════════════════════════════
   prompts.js — Prompt builders (generic multilingual → Thai)
   ───────────────────────────────────────────────────────
   The core philosophy: keep CONTINUITY of
     ① character names
     ② place names
     ③ powers / skills
     ④ pronouns / register (ผม/ฉัน/ข้า/กู depending on character)
   Source language is not forced — AI detects it.
   ═══════════════════════════════════════════════════════ */

NF.prompts = (function() {

  // ─── Registry for Thai pronouns per register profile ───
  const REGISTER_RULES = {
    neutral: `REGISTER PROFILE: NEUTRAL (default)
- Narrator 1st-person: ใช้ "ฉัน" (literary neutral). ห้ามใช้ "ผม" ในการบรรยาย
- Generic 3rd-person male: เขา / ของเขา
- Generic 3rd-person female: เธอ / นาง / ของเธอ
- Dialogue particles: ใช้เฉพาะเมื่อตัวละครต้องการโทนที่สุภาพเท่านั้น; ปกติไม่ต้องลงท้ายด้วย ครับ/ค่ะ
- เน้นภาษาไทยวรรณกรรมที่อ่านแล้วเป็นธรรมชาติ ไม่ต้องเลียนแบบไวยากรณ์ต้นฉบับ`,

    modern: `REGISTER PROFILE: MODERN CONTEMPORARY
- Male 1st-person dialogue: ผม
- Female 1st-person dialogue: ฉัน / ดิฉัน (ในสถานการณ์ที่ทางการ)
- ใช้ ครับ / ค่ะ / นะ / สิ ในบทสนทนาปกติได้
- 3rd-person: เขา (ชาย) / เธอ (หญิง)
- Narration 1st-person: ผม (ถ้า POV male) / ฉัน (ถ้า POV female)`,

    archaic: `REGISTER PROFILE: ARCHAIC / WUXIA / CHINESE-STYLE FANTASY
- 1st-person ทั้งในบทสนทนาและบรรยาย: ข้า (for main characters), ข้าพเจ้า (formal)
- 2nd-person: เจ้า / ท่าน (ตามฐานะ)
- 3rd-person: เขา / นาง / ของนาง / ของเขา
- ห้ามใช้ ครับ/ค่ะ/ผม/ฉัน ในบทสนทนาของตัวละคร (ยกเว้นล้อเลียน)
- ใช้ภาษาไทยสูงศักดิ์ มีกลิ่นอายกำลังภายใน เช่น "เจ้าตัวน้อย..." "สหายข้า..."`,

    rough: `REGISTER PROFILE: ROUGH / STREET / DELINQUENT
- 1st-person: กู (in-character) / ข้า (if fantasy)
- 2nd-person: มึง / เอ็ง
- 3rd-person: มัน (เกลียด/หมิ่น), ไอ้นั่น, ไอ้หมอนั่น
- ใช้ภาษาพูดหยาบแบบนักเลง/แก๊งค์ แต่ไม่ต้องหยาบคายทุกประโยค ใช้ตามสถานการณ์`,

    none: `REGISTER PROFILE: NO PARTICLE (neutral without pronouns)
- ในภาษาต้นฉบับที่ไม่ระบุเพศหรือสรรพนาม ให้ "ละไว้" (ไม่ต้องเติมครับ/ค่ะ/ผม/ฉัน)
- ใช้ประโยคที่ตัดสรรพนามออก เช่น "หันไป" แทน "เขาหันไป"
- ใช้ "ฉัน" เฉพาะตอนที่จำเป็นเพื่อชี้ชัดว่า POV แรกเท่านั้น
- ห้ามใส่ ครับ/ค่ะ/นะ/สิ ที่ท้ายประโยคโดยเด็ดขาด
- เน้นประโยคกระชับแบบภาษาไทยวรรณกรรมชั้นสูง`,

    literal: `REGISTER PROFILE: LITERAL / ตรงตัว
- เน้นแปลแบบตรงตัวให้ใกล้โครงสร้างต้นฉบับมากที่สุด โดยยังต้องอ่านเป็นภาษาไทยได้
- ห้ามตีความเกินต้นฉบับ ห้ามแต่งเติมอารมณ์หรือสำนวนใหม่
- คงรูปศัพท์เฉพาะจาก glossary แบบตรงตัวทุกครั้ง (one-to-one mapping)
- คงระดับภาษาให้เรียบตรง ไม่สละสลวยเกินจำเป็น`,

    auto: `REGISTER PROFILE: AUTO
- อ่านโทนของต้นฉบับ แล้วเลือก register ที่เหมาะสมที่สุด:
  * เรื่องแนวโบราณ/กำลังภายใน/แฟนตาซีตะวันออก → archaic (ข้า/เจ้า/ท่าน)
  * เรื่องแนวชีวิตประจำวัน/โรงเรียน/ออฟฟิศ → modern (ผม/ฉัน + ครับ/ค่ะ)
  * เรื่องแนวต่อสู้/นักเลง → rough ตามตัวละคร
  * เรื่องแนวแฟนตาซีตะวันตก → neutral (ฉัน/เขา/เธอ) เป็นหลัก
- คง register เดียวกันตลอดทั้งตอน อย่าสลับไปมา`,

    fluid: `REGISTER PROFILE: FLUID / EMOTION-FIRST (Modern Literary Style)
════════════════════════════════════════════════════════
CORE PHILOSOPHY: แปลด้วย "อารมณ์" ไม่ใช่ "ไวยากรณ์"
ไม่ต้องเดาเพศตัวละคร — ให้วิเคราะห์ความรู้สึกของประโยค
แล้วเลือกคำที่สื่ออารมณ์นั้นได้ตรงที่สุดแทน
════════════════════════════════════════════════════════

RULE 1 — EMOTIONAL PARTICLES (แทน ครับ/ค่ะ)
อ่าน vibe ของประโยค แล้วเลือกตามตาราง:

  ตอบรับ/รับทราบ       → อืม / อือ / อ้อ / อ๋อ
  สงสัย/ทวนคำ         → หือ? / หืม? / เอ๊ะ? / อ่ะนะ?
  ตกใจ/ประหลาดใจ      → โอ้! / เฮ้ย! / โห! / เอ๋! / อ้าว!
  เศร้า/เหนื่อยหน่าย   → เฮ้อ... / อือ... / ฮือ...
  อ่อนน้อม/ขอร้อง      → นะ / งั้นนะ / ได้ไหม / ช่วยหน่อยนะ
  ยืนยัน/หนักแน่น      → เลย / แน่นอน / แน่ๆ / ชัวร์
  ปฏิเสธเบาๆ           → หรอก / ก็ไม่ / ไม่ใช่หรอก
  ลังเล/ไม่แน่ใจ        → ก็... / อ่า... / คือ... / งั้นเหรอ

  ✗ ห้ามใช้ ครับ/ค่ะ/คะ/นะครับ/นะคะ ในทุกกรณี ยกเว้นตัวละครที่ Glossary
    ระบุชัดว่า [polite] และตัวนั้นพูดในสถานการณ์ทางการเท่านั้น

RULE 2 — GHOST PRONOUNS (สรรพนามแบบละเอียดอ่อน)
ลำดับความสำคัญในการเลือกสรรพนาม 1st-person:

  ① Zero Pronoun (ดีที่สุด) — รีไรท์ประโยคให้ไม่มีสรรพนาม
     "ผมไปก่อนนะครับ" → "ขอตัวก่อนนะ"
     "ฉันไม่รู้ค่ะ" → "ไม่รู้เหมือนกัน" / "ยังงงอยู่เลย"

  ② "เรา" — ใช้เมื่อ zero pronoun ทำให้ประโยคไม่ชัดเจน
     เหมาะ: บทบรรยาย, บทพูดทั่วไป
     ไม่เหมาะ: ฉากอารมณ์เข้มข้น, บท romance (ฟังดูเย็นชา)

  ③ ชื่อตัวละคร — ใช้เมื่อตัวละครพูดถึงตัวเองด้วยชื่อ
     ดูที่ Glossary ว่าตัวละครนี้มีบุคลิกแบบนั้นไหม (เด็ก / persona พิเศษ)
     ✗ ห้ามใช้โดยพลการ เพราะภาษาไทยผู้ใหญ่ไม่พูดถึงตัวเองด้วยชื่อ

  ④ บทบาท/สถานะ — ใช้เมื่อบริบทเป็นทางการ/แฟนตาซี
     เด็ก/ผู้น้อย: "ทางนี้" / "คนนี้"
     แฟนตาซี: "ข้า" / "ผู้นี้"
     ทางการ: "ฝ่ายเรา" / "ข้าพเจ้า" (ไร้เพศ)

RULE 3 — 3rd PERSON PRONOUNS
  ใช้ "เขา/เธอ" เฉพาะเมื่อ Glossary ระบุเพศชัดเจน
  กรณีเพศไม่ชัด:
    - ตัดสรรพนามทิ้ง แล้วใช้ชื่อตัวละครแทน
    - หรือใช้ "คนนั้น" / "บุคคลนั้น" / "ร่างนั้น" ตามบริบท

RULE 4 — PRESERVE EMOTIONAL RHYTHM
  ฉาก tension สูง → ประโยคสั้น ตัดคำฟุ่มเฟือย
  ฉาก introspective → ประโยคยาว ไหลลื่น มีลมหายใจ
  บทสนทนาเร็ว → ละ filler words ออก เน้นแก่น
  บทสนทนาอ่อนโยน → ใช้ "นะ" / "นะ" / "ด้วย" เพิ่ม warmth`,
  };

  // ─── NARRATOR pronoun rule ───
  const NARRATOR_RULES = {
    auto:  `- Narrator pronoun: เลือกตาม register profile ข้างต้น`,
    chan:  `- Narrator 1st-person MUST use: ฉัน (ห้ามใช้ ผม/ข้า)`,
    kha:   `- Narrator 1st-person MUST use: ข้า (ห้ามใช้ ฉัน/ผม)`,
    phom:  `- Narrator 1st-person MUST use: ผม (โหมด male contemporary POV)`,
    nu:    `- Narrator 1st-person MUST use: หนู (โหมด female young POV)`,
    ku:    `- Narrator 1st-person MUST use: กู (rough/delinquent POV)`,
    ra:    `- Narrator 1st-person MUST use: เรา หรือ Zero Pronoun (ละสรรพนาม) — ห้ามใช้ ผม/ฉัน/หนู/กู/ข้า ในการบรรยาย`,
  };

  // Thai word integrity — prevent mental find-and-replace
  const THAI_INTEGRITY = `THAI WORD INTEGRITY (CRITICAL):
- ห้ามทำ mental find-and-replace บนคำไทย
- "ข้า" ในฐานะสรรพนาม ≠ พยางค์ "ข้า" ที่อยู่ใน เข้า / ข้าง / ตรงกันข้าม / ข้าว
- "เจ้า" ในฐานะสรรพนาม ≠ เจ้าของ / เจ้าหน้าที่ / เจ้านาย (ที่เป็นคำนาม)
- "คุณ" ในฐานะสรรพนาม ≠ คุณสมบัติ / คุณภาพ / คุณประโยชน์
- แปลตามความหมายของวลี ไม่ใช่ตามพยางค์ที่ตรงกัน`;

  // ─── Main translate prompt ───
  // Generic: source language is detected by AI
  // Target is Thai
  function buildTranslate({ sourceText, glossaryStr, contextStr, ws, chapterTitle = '', hasImages = false }) {
    const settings = ws?.settings || {};
    const registerKey = settings.registerDefault || 'neutral';
    const narratorKey = settings.narratorPronoun || 'auto';
    const registerRule = REGISTER_RULES[registerKey] || REGISTER_RULES.neutral;
    const narratorRule = NARRATOR_RULES[narratorKey] || NARRATOR_RULES.auto;
    const isFluid = registerKey === 'fluid';

    const voiceLock = buildCharacterVoiceLock(ws?.glossary || [], { isFluid });
    const novelInstruction = ws?.instruction || '';
    const tags = ws?.tags || '';

    return `You are a professional literary translator who translates ${tags ? `(${tags}) ` : ''}webnovels into Thai.

TRANSLATION PHILOSOPHY:
- Translate by MEANING, not by word-for-word.
- Produce natural Thai that reads like original Thai fiction — not a translation.
- Preserve the author's tone, rhythm, and emotion.
- Keep paragraph structure and scene breaks intact.
- Do NOT add content or omit content. Keep fidelity to the source.
- Detect the source language automatically; treat it generically.

${registerRule}

NARRATOR POV:
${narratorRule}
- Keep POV and register STABLE across the entire chapter. Do not drift.

${voiceLock}

${THAI_INTEGRITY}

${hasImages ? `⚠️ IMAGE PLACEHOLDER — CRITICAL RULE (FAILURE LOSES READER'S ART):

The source text contains tokens in this EXACT format:
    ⟨IMG·001⟩
    ⟨IMG·002⟩
    ⟨IMG·003⟩

These are NOT typos. They are NOT formatting errors. They are NOT [IMG:] placeholders that
need "fixing". They are REPLACEMENT TOKENS for real image URLs that were extracted before
sending to you. Your job is to copy them to the output EXACTLY, byte-for-byte, including:
  - The specific unicode brackets ⟨ ⟩ (U+27E8, U+27E9)
  - The middle-dot · (U+00B7) between IMG and the number
  - The 3-digit zero-padded number (001, not 1)

DO NOT:
  ✗ translate IMG to ภาพ or รูป
  ✗ change brackets to [] or <> or ()
  ✗ replace · with : or . or -
  ✗ remove leading zeros (001 → 1)
  ✗ remove the token entirely because "it looks weird"
  ✗ replace with [IMG:001] or [IMG: 001] (these are WRONG)
  ✗ add any URL — the token IS the URL, do not invent one

DO:
  ✓ Keep ⟨IMG·001⟩ exactly as written
  ✓ Place it in the same paragraph position as the source
  ✓ Surround it with blank lines if the source does

If you are unsure: just copy the token character-by-character without modification.
` : ''}
NATURAL THAI FLOW:
- หลีกเลี่ยงโครงสร้างประโยคที่ตรงตามต้นฉบับเกินไป ให้ปรับเป็นประโยคไทย
- ฉากบู๊: ประโยคสั้น กระชับ มีพลัง
- ฉากอารมณ์: ประโยคยาว ไหลลื่น
${isFluid
  ? `- บทสนทนา: ใช้ Emotional Particles ตาม RULE 1 ของ Fluid profile ด้านบน — ห้ามใช้ ครับ/ค่ะ`
  : `- บทสนทนา: ใช้ particles (ครับ/ค่ะ/นะ/สิ) เท่าที่บุคลิกตัวละครต้องการเท่านั้น`
}

${novelInstruction ? `NOVEL-SPECIFIC INSTRUCTIONS:
${novelInstruction}
` : ''}
GLOSSARY (MUST FOLLOW EXACTLY — do not invent new translations):
${glossaryStr || '(ไม่มี)'}

GLOSSARY CONSISTENCY LOCK (CRITICAL):
- Same source term must map to ONE Thai form across the whole chapter.
- If source token is the same but has trailing punctuation/suffix (e.g. ", . ! ? 's"), keep the same Thai core form.
- Never alternate transliteration for the same source (e.g. form A in one line, form B in another).

${contextStr ? `CONTEXT FROM PREVIOUS CHAPTERS / PARTS:
${contextStr}
` : ''}
${chapterTitle ? `CHAPTER TITLE: ${chapterTitle}\n` : ''}
─── SOURCE TEXT TO TRANSLATE ───
${sourceText}
─── END SOURCE ───

Output ONLY the Thai translation — no preface, no notes, no explanations.`;
  }

  // ─── Character Voice Lock — per-character pronoun rules ───
  // opts.isFluid: ถ้า true → ข้าม gender-based pronoun lock ที่เข้มงวด
  //               เพราะ fluid mode ใช้ emotion-based particles แทน
  //               แต่ยังคง "name anchor" ไว้เพื่อให้ AI รู้จักตัวละคร
  function buildCharacterVoiceLock(glossary = [], opts = {}) {
    const chars = glossary.filter(g => g?.type === 'character' && g?.thai).slice(0, 80);
    if (!chars.length) return '';

    const { isFluid = false } = opts;

    const lines = chars.map(g => {
      const reg = detectVoiceRegister(g.note);
      const src = g.source || g.korean || '';
      const gender = (g.gender || '').toLowerCase();

      // ── Fluid mode: ไม่บังคับ gender pronoun ─────────────────────────
      // แค่บอก AI ว่า "ตัวละครนี้คือใคร" เพื่อให้ใช้ชื่อแทนสรรพนามได้
      // ยกเว้นตัวที่ note ระบุ polite ชัดเจน → อนุญาต ครับ/ค่ะ ในบริบทนั้น
      if (isFluid) {
        const isPolite = reg === 'polite';
        const genderHint = gender === 'male' ? 'ชาย' : gender === 'female' ? 'หญิง' : 'ไม่ระบุเพศ';
        const particleNote = isPolite
          ? `อนุญาตใช้ ครับ/ค่ะ ได้ในบริบทสุภาพ/ทางการ`
          : `ห้ามใช้ ครับ/ค่ะ — ใช้ Emotional Particles แทน`;
        return `- ${src} (${g.thai}) [${genderHint}]: ${particleNote}`;
      }

      // ── Standard mode: gender-based pronoun lock ──────────────────────
      if (gender === 'male') {
        if (reg === 'rough') return `- ${src} (${g.thai}) [MALE|rough]: 3rd=เขา · 1st=กู/ข้า · ไม่ใช้ ครับ`;
        if (reg === 'polite') return `- ${src} (${g.thai}) [MALE|polite]: 3rd=เขา · 1st=ผม · ใช้ ครับ/นะครับ`;
        return `- ${src} (${g.thai}) [MALE]: 3rd=เขา/ของเขา · 1st=ผม (contemporary) หรือ ข้า (archaic) · ห้ามใช้ เธอ/นาง/ค่ะ`;
      }
      if (gender === 'female') {
        if (reg === 'rough') return `- ${src} (${g.thai}) [FEMALE|rough]: 3rd=เธอ/นาง · 1st=ข้า/ฉัน · ไม่ใช้ ค่ะ`;
        if (reg === 'polite') return `- ${src} (${g.thai}) [FEMALE|polite]: 3rd=เธอ/นาง · 1st=ฉัน/ดิฉัน · ใช้ ค่ะ/คะ`;
        return `- ${src} (${g.thai}) [FEMALE]: 3rd=เธอ/นาง/ของเธอ · 1st=ฉัน · ห้ามใช้ เขา-as-male/ผม/กู`;
      }
      return `- ${src} (${g.thai}) [gender ไม่ชัดเจน]: ให้อนุมานจาก context; ถ้ายังไม่แน่ใจให้ใช้ เขา/ฉัน (neutral)`;
    });

    if (isFluid) {
      return `CHARACTER ROSTER (รู้จักตัวละครเหล่านี้ — ใช้ชื่อไทยตามนี้เสมอ):
${lines.join('\n')}

FLUID MODE — PRONOUN GUIDANCE:
- ใช้ชื่อตัวละครแทนสรรพนามได้เมื่อ context ชัดเจน
- กรณีเพศชัดเจนจาก Glossary: ใช้ เขา/เธอ ได้ในประโยคบรรยาย
- กรณีเพศไม่ชัด: ใช้ชื่อ หรือ "คนนั้น/ร่างนั้น" ตามบริบท
- ห้ามเพิ่ม ครับ/ค่ะ ให้ตัวละครที่ไม่ได้ระบุว่า [polite]`;
    }

    return `CHARACTER VOICE LOCK (ใช้ตามนี้ตลอดทั้งตอนและทุก chunk):
${lines.join('\n')}

PRONOUN RULES (ENFORCE PER CHARACTER):
- อ่านต้นฉบับแต่ละบรรทัด: ใคร พูด / คิด / ทำ → ใช้สรรพนามตาม gender ใน glossary ข้างต้น
- ห้ามเปลี่ยน gender ของตัวละครระหว่าง chunk
- ห้ามใช้สรรพนามผิดเพศ เช่น "เธอ" กับตัวละครชาย`;
  }

  function detectVoiceRegister(note = '') {
    const s = String(note || '').toLowerCase();
    if (/หยาบ|นักเลง|ก้าวร้าว|rough|slang|street|ดิบ/.test(s)) return 'rough';
    if (/สุภาพ|ทางการ|polite|formal|ขุนนาง|ราชสำนัก/.test(s)) return 'polite';
    return 'neutral';
  }

  // ─── Glossary extraction prompt ───
  function buildGlossaryExtract({ sourceText, existingStr = '', thaiSnippet = '' }) {
    return `You are a strict glossary curator for Thai webnovel translation.
Your job: extract ONLY terms that MUST be locked to a fixed Thai translation.
Ask yourself before extracting any term:
  "If a translator doesn't have this term in a reference list,
   will they accidentally translate it differently next time?"
Only extract if the answer is YES.

════════════════════════════════════════════════════
EXTRACT — terms where consistency is critical:
  character   Named individuals with unique Thai transliterations
              (e.g. 김민준 → คิม มินจุน — spelling drifts without a lock)
  place       Named locations unique to this story's world
              (not "forest" or "mountain" — only named proper locations)
  skill       Named combat techniques / spells with a unique branded name
              (e.g. 천뢰검법 → กระบวนดาบสายฟ้าสวรรค์)
  title       Unique titles carrying rank/status specific to THIS story
              (only if it's a proper title for a named person/org, not generic "master")
  rank        Named cultivation tiers / power levels with fixed ordering
              (must be consistent to preserve power scaling)
  honorific   Address forms unique to this story's world/culture
  term        Unique world-building concepts with no standard Thai equivalent

DO NOT EXTRACT — AI handles these fine without a reference:
  ✗ magic, sword, attack, defend, heal, power, energy, technique (generic)
  ✗ palace, mountain, forest, village, clan, sect (generic nouns)
  ✗ powerful, ancient, dark, holy, forbidden (adjectives)
  ✗ master, lord, king, teacher, disciple (generic titles — unless a unique named title)
  ✗ Any term where every translator would write the same Thai word
  ✗ Emotions, actions, descriptions
  ✗ Anything already in EXISTING GLOSSARY

HARD CAP: Return AT MOST 15 terms.
If more candidates exist, keep only the most consistency-critical ones.
Priority order: character names > unique skill names > unique places > everything else.

EXISTING GLOSSARY (do NOT re-extract these):
${existingStr || '(empty)'}

SOURCE TEXT:
${sourceText}

${thaiSnippet ? `EXISTING THAI TRANSLATION (use only to infer character gender from pronouns):\n${thaiSnippet}\n` : ''}

Return ONLY a JSON array (no markdown, no preamble):
[{"source":"exact term from source","thai":"Thai translation","type":"character|place|skill|title|rank|honorific|term","gender":"male|female|neutral","note":"5-word English meaning"}]

- "source" = exact string as in source text
- "thai" = transliterate names; translate skill/place names meaningfully
- "gender" = REQUIRED for character; "neutral" only if genuinely ambiguous
- "note" = 5 words max
- If nothing qualifies, return []`;
  }

  // ─── Glossary QA prompt ───
  function buildGlossaryQA({ glossaryJson }) {
    return `You are a Thai webnovel glossary QA reviewer. Review this glossary for problems.

GLOSSARY JSON:
${glossaryJson}

CHECK FOR:
1. **Duplicates**: same source term listed multiple times with different Thai translations.
2. **Odd translations**: translations that are weird, off-tone, or inconsistent with the rest.
3. **Tone mismatch**: a term feels out of register (e.g., a fantasy skill translated too casually).
4. **Gender errors**: type=character with obviously wrong gender based on the "note" field.
5. **Type errors**: things miscategorized (e.g., a place listed as character).

Return ONLY JSON (no markdown):
{
  "issues": [
    { "source": "exact source term", "problem": "short description", "suggestion": "short fix suggestion", "severity": "high|medium|low" }
  ],
  "summary": "one-line overall assessment"
}

If no issues, return { "issues": [], "summary": "no issues found" }.`;
  }

  // ─── Chapter summary prompt (for Context Memory) ───
  function buildSummary({ translatedText, chapterNum, chapterTitle }) {
    return `You are a webnovel context summarizer. Summarize this Thai translation chapter in Thai for use as continuity context for the next chapter.

OUTPUT FORMAT — respond with EXACTLY this structure, no extra text:
ตัวละคร: [ชื่อตัวละครที่ปรากฏ + บทบาทสั้นๆ]
เหตุการณ์: [สิ่งที่เกิดขึ้น 2-3 ประโยค]
ค้างอยู่: [สิ่งที่ยังไม่ได้คลี่คลาย / ที่จะเกิดขึ้นต่อ]
โทน: [โทนและสำนวนที่ใช้ในตอนนี้]

CHAPTER ${chapterNum || '?'} — ${chapterTitle || 'Untitled'}:
${translatedText}`;
  }

  // ─── Single chapter title translate ───
  // แปลชื่อตอนเดียว โดยใช้ context: glossary + tag + previous titles
  // เพื่อให้ชื่อต่อเนื่องกัน ไม่เพี้ยน (แก้ปัญหา "ขี้นก vs นกขี้")
  function buildTitleTranslate({ sourceTitle, ws, glossaryList = [], previousTitles = [] }) {
    const tags = ws?.tags || '';
    const instruction = ws?.instruction || '';
    const registerKey = ws?.settings?.registerDefault || 'neutral';
    const glossaryStr = glossaryList.length
      ? glossaryList.map(g => `• ${g.source} → ${g.thai}${g.type ? ` (${g.type})` : ''}`).join('\n')
      : '(ไม่มี)';
    const prevStr = previousTitles.length
      ? previousTitles.map(t => `${t.num ? '#' + t.num + ' · ' : ''}${t.source || '—'} → ${t.thai || '—'}`).join('\n')
      : '(ตอนแรก — ไม่มี context)';

    return `You are a chapter-title translator for a Thai webnovel${tags ? ` (genre: ${tags})` : ''}.

YOUR TASK: Translate ONE chapter title from the source language into natural Thai.

CRITICAL RULES:
- Return ONLY the translated Thai title — NO explanation, NO quotes, NO JSON.
- Keep it concise — typically 8-40 Thai characters. No prefix like "ตอนที่ X:" unless source has it.
- Use EXACT Thai terms from the GLOSSARY below for any matching name/skill/place.
- Maintain CONSISTENCY with previous titles — same word in source MUST map to same Thai.
- Register: ${registerKey} (ปรับโทนคำแปลให้เข้ากับ register)
- If the source title is a cliffhanger/evocative phrase, keep the same feel in Thai.
- If the source title is in Thai already (no translation needed), return it as-is.

GLOSSARY (must follow exactly):
${glossaryStr}

PREVIOUS CHAPTER TITLES (for word/style consistency):
${prevStr}

${instruction ? `NOVEL-SPECIFIC CONTEXT:\n${instruction}\n\n` : ''}SOURCE TITLE:
${sourceTitle}

Translated Thai title:`;
  }

  // ─── Bulk rename (AI rename chapter titles in batch) ───
  // ใช้ตอนที่ user อยาก rename หลายตอนพร้อมกัน
  // Batch size เล็ก + glossary + previous titles เพื่อรักษา continuity
  function buildBulkRename({ chapters, ws, glossaryList = [], previousTitles = [] }) {
    const tags = ws?.tags || '';
    const instruction = ws?.instruction || '';
    const glossaryStr = glossaryList.length
      ? glossaryList.map(g => `• ${g.source} → ${g.thai}`).join('\n')
      : '(ไม่มี)';
    const prevStr = previousTitles.length
      ? previousTitles.map(t => `${t.num ? '#' + t.num + ' · ' : ''}${t.source || '—'} → ${t.thai || '—'}`).join('\n')
      : '(ไม่มี)';

    const input = chapters.map((c, i) => {
      const body = (c.sourceText || '').slice(0, 250).replace(/\n+/g, ' ').trim();
      return `[${i + 1}] SRC_TITLE: ${c.title || '(no title)'}\n    BODY_OPENING: ${body}...`;
    }).join('\n\n');

    return `You are a chapter-title translator for a Thai webnovel${tags ? ` (genre: ${tags})` : ''}.

YOUR TASK: Translate each chapter title below into Thai.

CRITICAL CONSISTENCY RULES:
- Same word/phrase in source MUST translate to same Thai across all chapters in this batch AND matching the PREVIOUS TITLES list below.
- Example of BAD drift: chapter 1 says "ขี้นก" and chapter 2 says "นกขี้" for the same source. That's WRONG — pick ONE mapping and stick to it.
- Use EXACT Thai terms from the GLOSSARY for any matching proper noun.
- Keep titles concise (under 40 Thai chars). No "ตอนที่ X:" prefix unless source has it.
- If source title is already Thai or meaningless to translate, keep as-is.

GLOSSARY:
${glossaryStr}

PREVIOUS TITLES (for continuity — match these word choices):
${prevStr}

${instruction ? `NOVEL-SPECIFIC CONTEXT:\n${instruction}\n\n` : ''}CHAPTERS TO TRANSLATE:
${input}

OUTPUT — pure JSON array, same order as input, no markdown, no commentary:
[{"index": 1, "newTitle": "..."}, {"index": 2, "newTitle": "..."}, ...]`;
  }

  return {
    buildTranslate,
    buildCharacterVoiceLock,
    buildGlossaryExtract,
    buildGlossaryQA,
    buildSummary,
    buildTitleTranslate,
    buildBulkRename,
    REGISTER_RULES,
    NARRATOR_RULES,
  };
})();
