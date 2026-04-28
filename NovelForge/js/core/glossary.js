/* ═══════════════════════════════════════════════════════
   glossary.js — Extract / QA / Dedupe
   ═══════════════════════════════════════════════════════ */

NF.glossary = (function() {

  // Extract new terms from chapter(s) using AI
  async function extractFromChapters({ ws, chapters, signal, onLog }) {
    const model = ws.settings?.glossaryModel || ws.settings?.translateModel;
    const existingStr = ws.glossary?.length
      ? ws.glossary.slice(0, 200).map(g => `• ${g.source} → ${g.thai}`).join('\n')
      : '(empty)';

    const results = [];
    let i = 0;
    for (const ch of chapters) {
      i++;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onLog && onLog(`[${i}/${chapters.length}] สกัดจาก "${ch.title || ch.num}"...`);
      const src = ch.sourceText || '';
      if (!src.trim()) { onLog && onLog(`  ⊘ ว่าง — ข้าม`); continue; }

      // cap text to stay under rate
      const capped = src.length > 12000 ? (src.slice(0, 6000) + '\n...\n' + src.slice(-4000)) : src;

      // strip credit จาก translated ก่อนใช้เป็น snippet
      let thaiSnip = '';
      if (ch.translated) {
        let t = ch.translated;
        if (NF.credit?.has?.(t)) t = NF.credit.stripExisting(t);
        thaiSnip = t.slice(0, 2000);
      }

      const prompt = NF.prompts.buildGlossaryExtract({
        sourceText: capped,
        existingStr,
        thaiSnippet: thaiSnip,
      });

      try {
        const res = await NF.api.call({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 3000,
          signal,
        });
        const content = res.choices?.[0]?.message?.content || '';
        const terms = parseJsonArray(content);
        // JS-side cap: ถึงแม้ AI ไม่ทำตาม hard cap ใน prompt ก็ยังถูก cap ที่นี่
        const capped = terms.slice(0, 15);
        if (capped.length) {
          const dropped = terms.length - capped.length;
          onLog && onLog(`  ✓ พบ ${capped.length} คำ${dropped > 0 ? ` (ตัดทิ้ง ${dropped} ที่เกิน cap)` : ''}`);
          results.push(...capped.map(t => ({ ...t, _fromChapter: ch.title || ch.num })));
        } else {
          onLog && onLog(`  ∅ ไม่พบคำใหม่`);
        }
      } catch (err) {
        onLog && onLog(`  ✗ ${err.message}`);
      }
    }

    // dedupe within results against existing glossary
    const dedup = dedupeNewTerms(results, ws.glossary || []);
    onLog && onLog(`\n= รวม ${dedup.length} คำใหม่หลัง dedupe =`);
    return dedup;
  }

  function parseJsonArray(text) {
    if (!text) return [];
    let t = text.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    // find first [ ... ]
    const m = t.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[0]);
      return Array.isArray(arr) ? arr.filter(x => x && x.source && x.thai) : [];
    } catch { return []; }
  }

  function parseJsonObject(text) {
    if (!text) return null;
    let t = text.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  // ─── Dedupe new terms vs existing ───
  // Stage A: exact key match vs existing + within-batch
  // Stage B: substring dedup within new batch (e.g. "김민준" vs "민준" — keep the longer one)
  function dedupeNewTerms(newTerms, existing) {
    const existKeys = new Set(existing.map(g => normKey(g.source)));
    const seen = new Set();
    const out = [];

    // Stage A: exact dedupe
    for (const t of newTerms) {
      const key = normKey(t.source);
      if (existKeys.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }

    // Stage B: remove terms that are substrings of a longer term in the same batch
    // เช่น "민준" จะถูกตัดถ้ามี "김민준" อยู่ด้วย (likely the same person)
    const final = [];
    for (let i = 0; i < out.length; i++) {
      const a = normKey(out[i].source);
      const absorbedByLonger = out.some((b, j) => {
        if (i === j) return false;
        const bk = normKey(b.source);
        return bk.includes(a) && bk.length > a.length && a.length >= 2;
      });
      if (!absorbedByLonger) final.push(out[i]);
    }

    return final;
  }

  function normKey(s) { return String(s || '').toLowerCase().trim(); }

  // ─── Add multiple to workspace (with duplicate merging) ───
  async function addToWorkspace(ws, terms) {
    ws.glossary = ws.glossary || [];
    const existKeys = new Map(ws.glossary.map(g => [normKey(g.source), g]));
    let added = 0, updated = 0;
    for (const t of terms) {
      const key = normKey(t.source);
      const entry = {
        id: NF.genId(),
        source: t.source,
        thai: t.thai,
        type: t.type || 'term',
        gender: t.gender || '',
        note: t.note || '',
        createdAt: Date.now(),
      };
      if (existKeys.has(key)) {
        // update Thai if different
        const ex = existKeys.get(key);
        if (ex.thai !== t.thai) ex.thai = t.thai;
        if (!ex.gender && t.gender) ex.gender = t.gender;
        if (!ex.note && t.note) ex.note = t.note;
        updated++;
      } else {
        ws.glossary.push(entry);
        existKeys.set(key, entry);
        added++;
      }
    }
    const harmonized = harmonizeOneToOne(ws.glossary);
    await NF.store.saveWorkspace(ws);
    return { added, updated, harmonized };
  }

  // Auto Glossary Harmonizer:
  // enforce one canonical Thai per source (strict + loose source variants).
  function harmonizeOneToOne(glossary = []) {
    const list = glossary || [];
    const byStrict = new Map();
    const byLoose = new Map();

    for (const g of list) {
      if (!g?.source || !g?.thai) continue;
      const strict = normSrc(g.source);
      const loose = normSrcLoose(g.source);
      if (!byStrict.has(strict)) byStrict.set(strict, []);
      byStrict.get(strict).push(g);
      if (loose && loose !== strict) {
        if (!byLoose.has(loose)) byLoose.set(loose, []);
        byLoose.get(loose).push(g);
      }
    }

    const stats = { strictGroups: 0, looseGroups: 0, fixedEntries: 0 };
    const apply = (groups, label) => {
      for (const [, group] of groups) {
        if (group.length < 2) continue;
        const thaiGroups = new Map();
        for (const g of group) {
          const tk = normThai(g.thai);
          if (!thaiGroups.has(tk)) thaiGroups.set(tk, []);
          thaiGroups.get(tk).push(g);
        }
        if (thaiGroups.size <= 1) continue;

        const ranked = [...thaiGroups.entries()].sort((a, b) => {
          if (b[1].length !== a[1].length) return b[1].length - a[1].length;
          const aOld = Math.min(...a[1].map(x => x.createdAt || Number.MAX_SAFE_INTEGER));
          const bOld = Math.min(...b[1].map(x => x.createdAt || Number.MAX_SAFE_INTEGER));
          return aOld - bOld;
        });
        const canonical = ranked[0][1][0].thai;
        let touched = false;
        for (const g of group) {
          if (normThai(g.thai) === normThai(canonical)) continue;
          g.thai = canonical;
          g.note = ((g.note || '') + ` [auto-harmonized:${label}]`).trim();
          stats.fixedEntries++;
          touched = true;
        }
        if (touched) {
          if (label === 'strict') stats.strictGroups++;
          else stats.looseGroups++;
        }
      }
    };

    apply(byStrict, 'strict');
    apply(byLoose, 'loose');
    return stats;
  }

  // ─── Find substring conflicts (a term that's a substring of another) ───
  function findSubstringConflicts(glossary) {
    const list = glossary || [];
    const conflicts = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!a.source || !b.source) continue;
        if (a.source === b.source) continue;
        if (a.source.includes(b.source) || b.source.includes(a.source)) {
          conflicts.push({ a, b });
        }
      }
    }
    return conflicts;
  }

  // ─── QA via AI ───
  async function qaGlossary({ ws, signal, onLog }) {
    const model = ws.settings?.glossaryModel || ws.settings?.translateModel;
    if (!ws.glossary?.length) return { issues: [], summary: 'no glossary' };

    const batches = chunkArr(ws.glossary, 80);
    const issues = [];
    let i = 0;
    for (const batch of batches) {
      i++;
      onLog && onLog(`QA batch ${i}/${batches.length} (${batch.length} คำ)`);
      const json = JSON.stringify(batch.map(g => ({
        source: g.source, thai: g.thai, type: g.type, gender: g.gender, note: g.note,
      })), null, 1);
      const prompt = NF.prompts.buildGlossaryQA({ glossaryJson: json });
      try {
        const res = await NF.api.call({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
          signal,
        });
        const content = res.choices?.[0]?.message?.content || '';
        const obj = parseJsonObject(content);
        if (obj?.issues) issues.push(...obj.issues);
      } catch (e) {
        onLog && onLog(`  ✗ ${e.message}`);
      }
    }
    return { issues, summary: `พบ ${issues.length} ปัญหา` };
  }

  function chunkArr(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  // ─── CSV import / export ───
  function toCSV(glossary) {
    const rows = [['source', 'thai', 'type', 'gender', 'note']];
    for (const g of glossary) {
      rows.push([g.source || '', g.thai || '', g.type || '', g.gender || '', g.note || '']);
    }
    return rows.map(r => r.map(csvEsc).join(',')).join('\n');
  }
  function csvEsc(s) {
    const v = String(s || '');
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  function fromCSV(text) {
    // parse RFC 4180
    const out = [];
    let row = [], field = '', inQ = false;
    const s = text.replace(/\r\n/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field || row.length) { row.push(field); out.push(row); }
    if (!out.length) return [];
    const header = out[0].map(h => h.trim().toLowerCase());
    const terms = [];
    for (let i = 1; i < out.length; i++) {
      const r = out[i];
      if (r.length < 2 || !r[0]?.trim()) continue;
      const rec = {};
      header.forEach((h, j) => { rec[h] = (r[j] || '').trim(); });
      if (!rec.source || !rec.thai) continue;
      terms.push({
        source: rec.source, thai: rec.thai,
        type: rec.type || 'term',
        gender: rec.gender || '',
        note: rec.note || '',
      });
    }
    return terms;
  }

  // ═══════════════════════════════════════════════════════
  // 2-Stage dedupe — Stage 1 (auto exact) + Stage 2 (AI fuzzy)
  // ───────────────────────────────────────────────────────
  // Stage 1: หาคำที่ source ตรงกันเป๊ะ (case-insensitive + trim)
  //   → ถ้า Thai เหมือนกัน → ลบที่ใหม่กว่า
  //   → ถ้า Thai ต่าง → keep ตัวเก่า, mark ตัวใหม่เป็น conflict
  // Stage 2: ส่งคู่ที่ source/Thai "คล้องจอง" (ทับศัพท์ต่าง,
  //   มี suffix/prefix, ต่างกันแค่วรรณยุกต์) ให้ AI ตรวจ
  // ═══════════════════════════════════════════════════════

  function normSrc(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, ' '); }
  function normThai(s) { return String(s || '').trim().replace(/\s+/g, ''); }
  function normSrcLoose(s) {
    return normSrc(s)
      .replace(/[.,;:!?'"“”‘’)\]\}]+$/g, '')
      .replace(/(?:'s|’s)$/g, '')
      .trim();
  }

  // ─── Stage 1: exact dedupe ───
  // returns { kept, removed, conflicts }
  //   kept: glossary list หลังลบตัวซ้ำ (mutate-able)
  //   removed: list ที่ถูกตัดออก (ซ้ำเป๊ะ Thai เดียวกัน)
  //   conflicts: คู่ที่ source ตรงกันแต่ Thai ไม่ตรง → ต้องให้ user/AI เลือก
  function dedupeStrict(glossary) {
    const list = [...(glossary || [])];
    const bySrc = new Map();   // normSrc -> [entry, ...]
    for (const g of list) {
      if (!g?.source) continue;
      const k = normSrc(g.source);
      if (!bySrc.has(k)) bySrc.set(k, []);
      bySrc.get(k).push(g);
    }

    const removed = [];
    const conflicts = [];
    const idsToRemove = new Set();

    for (const [, group] of bySrc) {
      if (group.length < 2) continue;
      // sort: เก่าก่อน (createdAt น้อย) → ถือว่าเป็น canonical
      group.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const canonical = group[0];
      const cThai = normThai(canonical.thai);

      for (let i = 1; i < group.length; i++) {
        const dup = group[i];
        if (normThai(dup.thai) === cThai) {
          // Thai เหมือน → ลบทิ้ง
          removed.push(dup);
          idsToRemove.add(dup.id);
        } else {
          // Thai ต่าง → conflict
          conflicts.push({ canonical, variant: dup });
          // ไม่ลบทันที — ให้ stage 2 หรือ user ตัดสิน
        }
      }
    }

    const kept = list.filter(g => !idsToRemove.has(g.id));
    return { kept, removed, conflicts };
  }

  // ─── Stage 2: หา similar pairs ที่ "คล้องจอง" ───
  // ส่งให้ AI ตัดสินว่าเป็นคำเดียวกัน/แยกคำ/ผิด
  // จับคู่ที่ source หรือ Thai มี similarity สูง (Levenshtein ratio ≥ 0.7)
  // หรือ source ตัว 1 เป็น substring ตัว 2
  function findSimilarPairs(glossary, opts = {}) {
    const list = (glossary || []).filter(g => g?.source && g?.thai);
    const minRatio = opts.minRatio ?? 0.72;
    const pairs = [];
    const seen = new Set();

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const aSrc = normSrc(a.source), bSrc = normSrc(b.source);
        const aThai = normThai(a.thai), bThai = normThai(b.thai);
        if (aSrc === bSrc) continue;   // เคสนี้ stage 1 จัดการแล้ว

        // เคสจับคู่:
        // 1. Source ใกล้กัน (ทับศัพท์ต่าง — Li Ming vs LiMing vs Li-Ming)
        // 2. Thai ใกล้กัน (เซียวเฉิน vs เซี่ยวเฉิน)
        // 3. ตัวนึงเป็น substring อีกตัว (Li Ming vs Li Ming Tian)
        let reason = '';
        let score = 0;

        if (aSrc.includes(bSrc) || bSrc.includes(aSrc)) {
          reason = 'substring';
          score = Math.min(aSrc.length, bSrc.length) / Math.max(aSrc.length, bSrc.length);
        } else {
          const r1 = simRatio(aSrc, bSrc);
          if (r1 >= minRatio) { reason = 'source-similar'; score = r1; }
        }

        // เช็ค Thai
        if (!reason) {
          if (aThai.includes(bThai) || bThai.includes(aThai)) {
            const ratio = Math.min(aThai.length, bThai.length) / Math.max(aThai.length, bThai.length);
            if (ratio >= 0.6) { reason = 'thai-substring'; score = ratio; }
          } else {
            const r2 = simRatio(aThai, bThai);
            if (r2 >= minRatio) { reason = 'thai-similar'; score = r2; }
          }
        }

        if (reason) {
          const key = [a.id, b.id].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push({ a, b, reason, score });
        }
      }
    }
    pairs.sort((x, y) => y.score - x.score);
    return pairs;
  }

  // Levenshtein-based similarity ratio (0..1)
  function simRatio(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    if (a === b) return 1;
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    return 1 - dist / maxLen;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const cur = dp[j];
        if (a[i - 1] === b[j - 1]) dp[j] = prev;
        else dp[j] = Math.min(prev, dp[j - 1], dp[j]) + 1;
        prev = cur;
      }
    }
    return dp[n];
  }

  // ─── Stage 2: AI verification of similar pairs ───
  // ส่ง pairs เป็น batch ให้ AI ตอบว่า {merge, separate, fix-thai}
  async function aiVerifyPairs({ ws, pairs, signal, onLog }) {
    if (!pairs?.length) return [];
    const model = ws.settings?.glossaryModel || ws.settings?.translateModel;
    const out = [];
    const BATCH = 15;

    for (let i = 0; i < pairs.length; i += BATCH) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const batch = pairs.slice(i, i + BATCH);
      onLog?.(`AI ตรวจ batch ${Math.floor(i/BATCH)+1}/${Math.ceil(pairs.length/BATCH)} (${batch.length} คู่)`);

      const items = batch.map((p, idx) => ({
        idx,
        a: { source: p.a.source, thai: p.a.thai, type: p.a.type, gender: p.a.gender || '' },
        b: { source: p.b.source, thai: p.b.thai, type: p.b.type, gender: p.b.gender || '' },
        reason: p.reason,
      }));

      const prompt = buildVerifyPrompt(items, ws);
      try {
        const res = await NF.api.call({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
          signal,
        });
        const content = res.choices?.[0]?.message?.content || '';
        const parsed = parseJsonObject(content);
        const decisions = parsed?.decisions || [];
        for (const d of decisions) {
          if (typeof d.idx !== 'number' || !batch[d.idx]) continue;
          out.push({
            ...batch[d.idx],
            verdict: d.verdict,            // 'merge' | 'separate' | 'fix-thai'
            keep: d.keep || null,          // 'a' | 'b'  (สำหรับ merge)
            newThai: d.newThai || null,    // (สำหรับ fix-thai)
            reasoning: d.reasoning || '',
          });
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        onLog?.(`  ✗ batch ผิดพลาด: ${err.message}`);
      }
    }
    return out;
  }

  function buildVerifyPrompt(items, ws) {
    const tags = ws?.tags || '';
    return `You are a glossary deduplication reviewer for a Thai webnovel${tags ? ` (genre: ${tags})` : ''}.
For each PAIR below, decide if A and B refer to the SAME entity (merge) or DIFFERENT entities (separate).
If both are the same entity but the Thai translation of one is wrong, propose the correct Thai (fix-thai).

PAIRS:
${JSON.stringify(items, null, 1)}

RULES:
- "merge"      → A and B are the same entity (e.g. romanization vs original "Li Ming" + "李明", or typo variants).
                 Choose which to KEEP based on which Thai is more accurate/canonical.
- "separate"   → A and B are different entities that just happen to look similar.
                 (e.g. "Li Ming" the character vs "Li Ming Sword" the skill)
- "fix-thai"   → They are clearly the same entity but BOTH Thai translations are suboptimal — propose better.

Return ONLY JSON, no commentary:
{
  "decisions": [
    { "idx": 0, "verdict": "merge|separate|fix-thai", "keep": "a|b", "newThai": "...", "reasoning": "..." },
    ...
  ]
}

Be conservative. When in doubt, "separate".`;
  }

  // ─── Apply AI dedup decisions ───
  // mutate ws.glossary in place
  async function applyDedupeDecisions(ws, decisions) {
    ws.glossary = ws.glossary || [];
    const stats = { merged: 0, separated: 0, fixed: 0 };
    const idsToRemove = new Set();

    for (const d of decisions) {
      if (d.verdict === 'merge') {
        const keepEntry = d.keep === 'b' ? d.b : d.a;
        const dropEntry = d.keep === 'b' ? d.a : d.b;
        if (!keepEntry || !dropEntry) continue;
        idsToRemove.add(dropEntry.id);
        stats.merged++;
      } else if (d.verdict === 'fix-thai') {
        const target = ws.glossary.find(g => g.id === d.a.id);
        if (target && d.newThai) {
          target.thai = d.newThai;
          target.note = ((target.note || '') + ` [ai-fix:${d.reasoning || 'better thai'}]`).trim();
          stats.fixed++;
        }
        // ลบตัว b (ถือว่าซ้ำ)
        idsToRemove.add(d.b.id);
      } else {
        stats.separated++;
        // ไม่ทำอะไร
      }
    }

    ws.glossary = ws.glossary.filter(g => !idsToRemove.has(g.id));
    if (idsToRemove.size > 0 || stats.fixed > 0) {
      await NF.store.saveWorkspace(ws);
    }
    return stats;
  }

  return {
    extractFromChapters,
    addToWorkspace,
    findSubstringConflicts,
    qaGlossary,
    toCSV, fromCSV,
    parseJsonArray, parseJsonObject,
    // 2-stage dedup
    dedupeStrict,
    findSimilarPairs,
    aiVerifyPairs,
    applyDedupeDecisions,
    harmonizeOneToOne,
    simRatio,
  };
})();
