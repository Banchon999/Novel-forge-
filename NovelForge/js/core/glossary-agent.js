/* ═══════════════════════════════════════════════════════
   glossary-agent.js — Autonomous Glossary QA Agent
   ───────────────────────────────────────────────────────
   Purpose:
     When translating 100+ chapters overnight, we CANNOT
     stop to let the user review every new term the
     extractor finds. We need an AI that decides:
       - accept: add new term
       - reject: too generic / bad extraction / duplicate in spirit
       - merge:  variant of existing term (e.g. "李明" vs "Li Ming")
       - update: existing entry has wrong Thai, fix it

   The agent runs in two phases:
     Phase A — Filter proposed new terms against the rules.
               Output: accepted, rejected (with reasons).
     Phase B — Post-translation QA. Scan recent translated
               chapters for glossary drift (same name → 2
               different Thai translations). Force
               consolidation to the "canonical" Thai.

   All decisions are logged. Nothing blocks the pipeline.

   The agent is given AUTHORITY to modify glossary directly.
   ═══════════════════════════════════════════════════════ */

NF.glossaryAgent = (function() {

  // ═══════════════════════════════════════════════════════
  // PHASE A — Filter & triage new proposed terms
  // ═══════════════════════════════════════════════════════
  //
  // Given proposed new terms + existing glossary, the agent returns:
  //   {
  //     accept:  [ { source, thai, type, gender, note, confidence } ],
  //     reject:  [ { source, thai, reason } ],
  //     merge:   [ { source, thai, mergeWith, reason } ],
  //     update:  [ { source, oldThai, newThai, reason } ],
  //   }

  async function triage({ ws, proposed, signal, onLog }) {
    if (!proposed?.length) return { accept: [], reject: [], merge: [], update: [] };

    const model = ws?.settings?.glossaryModel || ws?.settings?.translateModel;
    const existing = ws?.glossary || [];

    // Chunk proposed into batches of ~30 so the prompt doesn't explode
    const BATCH = 30;
    const batches = [];
    for (let i = 0; i < proposed.length; i += BATCH) batches.push(proposed.slice(i, i + BATCH));

    const out = { accept: [], reject: [], merge: [], update: [] };
    let bi = 0;
    for (const batch of batches) {
      bi++;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onLog?.(`🤖 Agent triage batch ${bi}/${batches.length} (${batch.length} คำ)`);

      const prompt = buildTriagePrompt(existing, batch, ws);
      try {
        const res = await NF.api.call({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 3000,
          signal,
        });
        const content = res.choices?.[0]?.message?.content || '';
        const parsed = NF.glossary.parseJsonObject(content);
        if (!parsed) {
          onLog?.(`  ⚠ agent returned unparseable — defaulting to accept-all for batch`);
          out.accept.push(...batch.map(t => ({ ...t, confidence: 'low', _agentDefault: true })));
          continue;
        }
        for (const k of ['accept', 'reject', 'merge', 'update']) {
          if (Array.isArray(parsed[k])) out[k].push(...parsed[k]);
        }
        onLog?.(`  → accept ${(parsed.accept||[]).length} · reject ${(parsed.reject||[]).length} · merge ${(parsed.merge||[]).length} · update ${(parsed.update||[]).length}`);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        NF.log?.warn('glossary-agent', `triage batch ${bi} failed`, err);
        onLog?.(`  ✗ batch ${bi} failed: ${err.message} — accepting as-is`);
        out.accept.push(...batch.map(t => ({ ...t, confidence: 'low', _agentFallback: true })));
      }
    }
    return out;
  }

  function buildTriagePrompt(existing, proposed, ws) {
    const existingList = existing.length
      ? existing.slice(0, 300).map(g => `• ${g.source} → ${g.thai} (${g.type}${g.gender ? '/' + g.gender : ''})`).join('\n')
      : '(empty)';
    const proposedJson = JSON.stringify(proposed, null, 1);
    const tags = ws?.tags || '';
    const instruction = ws?.instruction || '';

    return `You are a glossary gatekeeper for a Thai webnovel translation project${tags ? ` (genre: ${tags})` : ''}.
Your job: decide which PROPOSED new terms should be added, rejected, merged, or used to update existing ones.
You act autonomously — no human will review your decisions, so be conservative but decisive.

${instruction ? `NOVEL-SPECIFIC INSTRUCTIONS:\n${instruction}\n` : ''}
EXISTING GLOSSARY (do not propose adding these again):
${existingList}

PROPOSED NEW TERMS (from extraction):
${proposedJson}

DECISION RULES — ACCEPT only if ALL are true:
  1. The term is a proper noun, unique technique/skill name, unique item, named location, or genre-specific term.
  2. It is NOT a common dictionary word or grammatical particle.
  3. It is NOT already covered by an existing entry (semantically the same).
  4. The Thai translation is reasonable — if it's clearly machine-transliterated garbage, REJECT.
  5. "type" is correct: character (named person), place, skill, term, title (rank/nobility), rank (cultivation stage), honorific, other.

REJECT if:
  - Too generic ("sword", "day", "eye") — ordinary words that don't need fixed translation.
  - Common greetings, curses, or stock phrases.
  - Single pronouns ("I", "he", "you") unless truly unusual usage.
  - The Thai looks like a literal word-for-word gloss that adds no value.
  - It appears to be a typo or OCR artifact.

MERGE if:
  - The source is a VARIANT (romanization, abbreviation, nickname) of an existing entry.
    Example: proposed "Li Ming" when existing has "李明" → merge.

UPDATE if:
  - The proposed Thai is CLEARLY better than an existing Thai for the same source.
    Be strict — only flag if the existing translation is wrong or awkward.

For characters: if you can infer gender from context in "note", fill it in.

OUTPUT — pure JSON, no markdown fences, no commentary:
{
  "accept": [ { "source": "...", "thai": "...", "type": "...", "gender": "", "note": "...", "confidence": "high|medium|low" } ],
  "reject": [ { "source": "...", "thai": "...", "reason": "..." } ],
  "merge":  [ { "source": "...", "thai": "...", "mergeWith": "<existing source>", "reason": "..." } ],
  "update": [ { "source": "<existing source>", "oldThai": "...", "newThai": "...", "reason": "..." } ]
}

Be conservative: when in doubt about a generic word, REJECT. When in doubt about a proper noun, ACCEPT.`;
  }

  // ═══════════════════════════════════════════════════════
  // PHASE A — Apply agent decisions to workspace
  // ═══════════════════════════════════════════════════════
  async function applyDecisions(ws, decisions, { onLog } = {}) {
    ws.glossary = ws.glossary || [];
    const stats = { added: 0, updated: 0, merged: 0, rejected: 0 };

    // normalize source key for dedup
    const keyOf = (s) => String(s || '').toLowerCase().trim();
    const byKey = new Map(ws.glossary.map(g => [keyOf(g.source), g]));

    // accept
    for (const t of (decisions.accept || [])) {
      if (!t.source || !t.thai) continue;
      const k = keyOf(t.source);
      if (byKey.has(k)) continue; // duplicate
      const entry = {
        id: NF.genId(),
        source: t.source,
        thai: t.thai,
        type: t.type || 'term',
        gender: t.gender || '',
        note: [t.note, t.confidence ? `[conf:${t.confidence}]` : ''].filter(Boolean).join(' '),
        createdAt: Date.now(),
      };
      ws.glossary.push(entry);
      byKey.set(k, entry);
      stats.added++;
    }

    // update
    for (const u of (decisions.update || [])) {
      if (!u.source || !u.newThai) continue;
      const entry = byKey.get(keyOf(u.source));
      if (!entry) continue;
      if (entry.thai !== u.newThai) {
        entry.thai = u.newThai;
        entry.note = ((entry.note || '') + ` [updated: ${u.reason || 'agent'}]`).trim();
        stats.updated++;
      }
    }

    // merge — add alias as new entry pointing to existing Thai
    // (cheap approach: store as a new entry with the mergeWith's thai)
    for (const m of (decisions.merge || [])) {
      if (!m.source || !m.mergeWith) continue;
      const target = byKey.get(keyOf(m.mergeWith));
      if (!target) continue;
      const k = keyOf(m.source);
      if (byKey.has(k)) continue;
      const entry = {
        id: NF.genId(),
        source: m.source,
        thai: target.thai,
        type: target.type,
        gender: target.gender,
        note: `[alias of ${m.mergeWith}]`,
        createdAt: Date.now(),
      };
      ws.glossary.push(entry);
      byKey.set(k, entry);
      stats.merged++;
    }

    stats.rejected = (decisions.reject || []).length;

    const hz = NF.glossary?.harmonizeOneToOne?.(ws.glossary || []);
    if (hz?.fixedEntries) {
      onLog?.(`✓ auto glossary harmonize: แก้ ${hz.fixedEntries} รายการ (strict ${hz.strictGroups} · loose ${hz.looseGroups})`);
    }

    await NF.store.saveWorkspace(ws);
    onLog?.(`✓ agent applied: +${stats.added} ใหม่ · ${stats.updated} อัพเดต · ${stats.merged} alias · ${stats.rejected} ปฏิเสธ`);
    NF.log?.info('glossary-agent', 'applied decisions', stats);
    return stats;
  }

  // ═══════════════════════════════════════════════════════
  // PHASE B — Post-translation drift detection
  // ═══════════════════════════════════════════════════════
  //
  // Scan recently translated chapters. If a source term has
  // an entry "X → ก" in glossary but chapter N used "ข"
  // instead, that's drift. Agent decides canonical form and
  // can auto-rewrite chapters to match.

  async function detectDrift({ ws, chapterIds, signal, onLog, autoFix = true }) {
    const glossary = ws.glossary || [];
    if (!glossary.length) { onLog?.('(ไม่มี glossary — ข้าม drift detection)'); return { drifts: [], fixed: 0 }; }

    const chapters = chapterIds
      .map(id => ws.chapters.find(c => c.id === id))
      .filter(c => c && c.translated);

    if (!chapters.length) { onLog?.('(ไม่มี chapter ที่แปลแล้ว)'); return { drifts: [], fixed: 0 }; }

    onLog?.(`🔍 สแกน drift ใน ${chapters.length} ตอน · ${glossary.length} คำศัพท์`);

    // Build a quick map: which source terms appear in source text of these chapters?
    const drifts = [];

    // For each character/named term, check: does the translated text contain
    // its canonical Thai? If the SOURCE contains the term N times but the
    // TRANSLATION contains the canonical Thai zero times, likely drift.
    for (const g of glossary) {
      if (!g.source || !g.thai) continue;
      if (g.type !== 'character' && g.type !== 'place' && g.type !== 'skill' && g.type !== 'title') continue;
      for (const ch of chapters) {
        const src = ch.sourceText || '';
        if (!src.includes(g.source)) continue;
        let tr = ch.translated || '';
        if (NF.credit?.has?.(tr)) tr = NF.credit.stripExisting(tr);
        if (tr.includes(g.thai)) continue; // good — canonical found
        drifts.push({
          chapter: ch,
          source: g.source,
          canonical: g.thai,
          type: g.type,
        });
      }
    }

    if (!drifts.length) {
      onLog?.('✓ ไม่พบ drift');
      return { drifts: [], fixed: 0 };
    }

    onLog?.(`⚠ พบ drift ${drifts.length} จุด`);
    NF.log?.info('glossary-agent', 'drift detected', { count: drifts.length });

    if (!autoFix) return { drifts, fixed: 0 };

    // Auto-fix: ask agent to find the ACTUAL thai used and replace it.
    // Group drifts by chapter to batch rewrites per chapter.
    const byChapter = new Map();
    for (const d of drifts) {
      if (!byChapter.has(d.chapter.id)) byChapter.set(d.chapter.id, { chapter: d.chapter, items: [] });
      byChapter.get(d.chapter.id).items.push(d);
    }

    let fixed = 0;
    for (const { chapter, items } of byChapter.values()) {
      if (signal?.aborted) break;
      onLog?.(`  · ตอน "${chapter.title}": ${items.length} จุดที่ต้องแก้`);
      try {
        const result = await fixDriftInChapter({ ws, chapter, items, signal });
        if (result?.changed > 0) {
          chapter.translated = result.newText;
          chapter.updatedAt = Date.now();
          chapter.status = chapter.status === 'translated' ? 'edited' : chapter.status;
          fixed += result.changed;
          onLog?.(`    ✓ แก้ไขได้ ${result.changed} จุด`);
        } else {
          onLog?.(`    ∅ ไม่สามารถแก้ไขอัตโนมัติได้`);
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        NF.log?.warn('glossary-agent', 'drift fix failed', err);
        onLog?.(`    ✗ ${err.message}`);
      }
    }

    await NF.store.saveWorkspace(ws);
    NF.log?.info('glossary-agent', 'drift fix done', { total: drifts.length, fixed });
    return { drifts, fixed };
  }

  // Ask agent to find what thai word replaced glossary's canonical in a
  // specific chapter, then generate a find/replace instruction.
  async function fixDriftInChapter({ ws, chapter, items, signal }) {
    const model = ws?.settings?.glossaryModel || ws?.settings?.translateModel;
    const itemsJson = JSON.stringify(items.map(i => ({
      source: i.source, canonical: i.canonical, type: i.type,
    })), null, 1);

    // Use only first 8000 chars of translation for context window safety
    // strip credit ก่อน — กัน AI propose แทนที่ของ credit
    let workingText = chapter.translated || '';
    let creditTail = '';
    let creditHead = '';
    if (NF.credit?.has?.(workingText)) {
      // เก็บ credit ไว้ reattach หลัง replace
      const stripped = NF.credit.stripExisting(workingText);
      // หา head + tail
      const startIdx = workingText.indexOf(stripped);
      if (startIdx > 0) creditHead = workingText.slice(0, startIdx);
      if (startIdx + stripped.length < workingText.length) {
        creditTail = workingText.slice(startIdx + stripped.length);
      }
      workingText = stripped;
    }

    const excerpt = workingText.length > 8000
      ? workingText.slice(0, 6000) + '\n...\n' + workingText.slice(-2000)
      : workingText;

    const prompt = `You are a glossary consistency enforcer for a Thai novel translation.

CANONICAL GLOSSARY ENTRIES (source → canonical Thai):
${itemsJson}

The translation below may use INCORRECT variants instead of the canonical Thai.
For each entry, scan the translation and find the actual Thai word/phrase used
for that source term, so we can do a find/replace to enforce consistency.

If you cannot find an exact variant, set "variant" to null and we'll skip it.

TRANSLATION TEXT:
${excerpt}

OUTPUT — pure JSON, no commentary:
{ "replacements": [
  { "source": "...", "variant": "...", "canonical": "...", "confidence": "high|medium|low" },
  ...
] }

Rules:
- Only include entries where you are confident the variant is the WRONG translation of that source.
- Do NOT include entries where the canonical already appears.
- Multi-word variants OK.
- If unsure, omit. Low-confidence items will be skipped.`;

    const res = await NF.api.call({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1500,
      signal,
    });
    const content = res.choices?.[0]?.message?.content || '';
    const parsed = NF.glossary.parseJsonObject(content);
    if (!parsed?.replacements?.length) return { changed: 0, newText: chapter.translated };

    let text = workingText;
    let changed = 0;
    for (const r of parsed.replacements) {
      if (!r.variant || !r.canonical) continue;
      if (r.confidence === 'low') continue;
      if (r.variant === r.canonical) continue;
      // escape for regex
      const esc = r.variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc, 'g');
      const before = text;
      text = text.replace(re, r.canonical);
      if (text !== before) changed++;
    }
    // reattach credit blocks
    const finalText = creditHead + text + creditTail;
    return { changed, newText: finalText };
  }

  // ═══════════════════════════════════════════════════════
  // One-call wrapper for the auto pipeline
  // ═══════════════════════════════════════════════════════
  // Runs: extract → agent triage → apply → (optional) drift detection
  async function runAutonomous({ ws, chaptersForExtract, chaptersForDrift, signal, onLog, skipDrift = false }) {
    onLog?.(`🚀 Glossary Agent (autonomous mode) starting`);

    // Phase 0: extract
    onLog?.(`\n─── Phase 1: Extract ───`);
    const proposed = await NF.glossary.extractFromChapters({
      ws, chapters: chaptersForExtract, signal, onLog,
    });
    onLog?.(`พบคำที่ extractor เสนอ: ${proposed.length} คำ`);

    if (!proposed.length && !chaptersForDrift?.length) {
      return { stats: null, drifts: [] };
    }

    // Phase A: triage
    let stats = null;
    if (proposed.length) {
      onLog?.(`\n─── Phase 2: Agent Triage ───`);
      const decisions = await triage({ ws, proposed, signal, onLog });
      stats = await applyDecisions(ws, decisions, { onLog });
    }

    // Phase B: drift
    let driftResult = { drifts: [], fixed: 0 };
    if (!skipDrift && chaptersForDrift?.length) {
      onLog?.(`\n─── Phase 3: Drift Detection ───`);
      driftResult = await detectDrift({
        ws, chapterIds: chaptersForDrift, signal, onLog, autoFix: true,
      });
    }

    onLog?.(`\n✓ Agent done`);
    return { stats, drifts: driftResult.drifts, fixed: driftResult.fixed };
  }

  return {
    triage,
    applyDecisions,
    detectDrift,
    runAutonomous,
  };
})();
