/* ═══════════════════════════════════════════════════════
   glossary-tab.js — Glossary management
   ═══════════════════════════════════════════════════════ */

NF.glossaryTab = (function() {

  const $ = NF.$;

  function init() {
    $('#btnAddGlossary').onclick = () => openEditor();
    $('#btnGlossarySelect').onclick = toggleBulk;
    $('#btnGlBulkExit').onclick = exitBulk;
    $('#btnGlBulkDelete').onclick = bulkDelete;
    $('#glBulkSelectAll').onchange = bulkSelectAll;

    $('#glossarySearch').oninput = NF.debounce(() => {
      NF.state.glossaryFilter.q = $('#glossarySearch').value;
      render();
    }, 150);
    $('#glossaryTypeFilter').onchange = () => {
      NF.state.glossaryFilter.type = $('#glossaryTypeFilter').value;
      render();
    };
    $('#glossarySort').onchange = () => {
      NF.state.glossaryFilter.sort = $('#glossarySort').value;
      render();
    };

    $('#btnGlossaryCSVExport').onclick = exportCSV;
    $('#btnGlossaryCSVImport').onclick = importCSV;

    const menuBtn = $('#btnGlMore');
    const menu = $('#menuGlMore');
    menuBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== menuBtn) menu.hidden = true;
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      menu.hidden = true;
      handleMenuAction(b.dataset.act);
    });
  }

  function render() {
    const ws = NF.state.currentWs;
    const box = $('#glossaryList');
    box.innerHTML = '';
    if (!ws) { $('#glossaryEmpty').hidden = false; return; }

    let list = [...(ws.glossary || [])];
    if (!list.length) {
      $('#glossaryEmpty').hidden = false;
      $('#glossaryStats').textContent = '0 คำ';
      return;
    }
    $('#glossaryEmpty').hidden = true;

    const { q, type, sort } = NF.state.glossaryFilter;
    if (type) list = list.filter(g => g.type === type);
    if (q) {
      const ql = q.toLowerCase();
      list = list.filter(g =>
        (g.source || '').toLowerCase().includes(ql)
        || (g.thai || '').toLowerCase().includes(ql)
        || (g.note || '').toLowerCase().includes(ql)
      );
    }
    if (sort === 'az') list.sort((a, b) => (a.source||'').localeCompare(b.source||''));
    else if (sort === 'type') list.sort((a, b) => (a.type||'').localeCompare(b.type||''));
    else list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    $('#glossaryStats').textContent = `${list.length} / ${(ws.glossary || []).length} คำ`;

    const bulk = NF.state.glBulkMode;
    box.parentElement.classList.toggle('bulk-mode', bulk);
    $('#glBulkBar').hidden = !bulk;

    const frag = document.createDocumentFragment();
    for (const g of list) {
      const row = NF.el('div', {
        class: 'gl-row' + (g._selected ? ' selected' : ''),
        dataset: { id: g.id || '' },
        onclick: (e) => {
          if (e.target.closest('button')) return;
          if (bulk) {
            g._selected = !g._selected;
            render();
          } else {
            openEditor(g.id);
          }
        },
      },
        NF.el('div', { class: 'chk' }, NF.el('input', { type: 'checkbox', checked: !!g._selected, onclick: (e) => e.stopPropagation() })),
        NF.el('div', { class: 'gl-source', text: g.source || '—' }),
        NF.el('div', { class: 'gl-thai', text: g.thai || '—' }),
        NF.el('div', {},
          NF.el('span', { class: 'gl-tag ' + (g.type || 'other'), text: g.type || 'other' }),
        ),
        NF.el('div', { class: 'gl-actions' },
          NF.el('button', { title: 'แก้ไข', onclick: (e) => { e.stopPropagation(); openEditor(g.id); } }, '✎'),
          NF.el('button', { class: 'danger', title: 'ลบ', onclick: (e) => { e.stopPropagation(); deleteOne(g.id); } }, '🗑'),
        ),
      );
      // optional gender marker in a visually subtle way
      if (g.gender === 'male') row.querySelector('.gl-source').prepend(document.createTextNode('♂ '));
      else if (g.gender === 'female') row.querySelector('.gl-source').prepend(document.createTextNode('♀ '));
      frag.appendChild(row);
    }
    box.appendChild(frag);
    NF.workspace.updateCounts();
  }

  function toggleBulk() {
    NF.state.glBulkMode = !NF.state.glBulkMode;
    if (!NF.state.glBulkMode) (NF.state.currentWs?.glossary || []).forEach(g => g._selected = false);
    render();
  }
  function exitBulk() {
    NF.state.glBulkMode = false;
    (NF.state.currentWs?.glossary || []).forEach(g => g._selected = false);
    render();
  }
  function bulkSelectAll() {
    const v = $('#glBulkSelectAll').checked;
    (NF.state.currentWs?.glossary || []).forEach(g => g._selected = v);
    render();
  }
  async function bulkDelete() {
    const ws = NF.state.currentWs;
    if (!ws) return;
    const selected = (ws.glossary || []).filter(g => g._selected);
    if (!selected.length) { NF.toast.warn('ยังไม่ได้เลือก'); return; }
    const ok = await NF.modal.confirm({
      title: 'ลบคำที่เลือก?',
      message: `จะลบ ${selected.length} คำถาวร`,
      danger: true,
    });
    if (!ok) return;
    ws.glossary = ws.glossary.filter(g => !g._selected);
    await NF.store.saveWorkspace(ws);
    exitBulk();
    NF.toast.success(`ลบ ${selected.length} คำ`);
  }

  async function deleteOne(id) {
    const ws = NF.state.currentWs;
    if (!ws) return;
    ws.glossary = ws.glossary.filter(g => g.id !== id);
    await NF.store.saveWorkspace(ws);
    render();
    NF.toast.info('ลบแล้ว');
  }

  function openEditor(id) {
    const ws = NF.state.currentWs;
    if (!ws) return;
    let g = id ? ws.glossary.find(x => x.id === id) : null;
    const isNew = !g;
    if (isNew) g = { id: NF.genId(), source: '', thai: '', type: 'character', gender: '', note: '', createdAt: Date.now() };

    const body = NF.el('div', {});
    body.appendChild(NF.el('div', { class: 'form-grid-2' },
      NF.el('div', { class: 'field' },
        NF.el('span', { text: 'คำต้นฉบับ' }),
        NF.el('input', { id: 'glSrc', class: 'input', value: g.source || '' }),
      ),
      NF.el('div', { class: 'field' },
        NF.el('span', { text: 'คำแปลไทย' }),
        NF.el('input', { id: 'glThai', class: 'input', value: g.thai || '' }),
      ),
      NF.el('div', { class: 'field' },
        NF.el('span', { text: 'ประเภท' }),
        (() => {
          const s = NF.el('select', { id: 'glType', class: 'select' });
          ['character','place','term','skill','title','rank','honorific','other'].forEach(v => {
            const o = NF.el('option', { value: v }, v);
            if (g.type === v) o.selected = true;
            s.appendChild(o);
          });
          return s;
        })(),
      ),
      NF.el('div', { class: 'field' },
        NF.el('span', { text: 'เพศ (สำหรับตัวละคร)' }),
        (() => {
          const s = NF.el('select', { id: 'glGen', class: 'select' });
          [['','—'],['male','ชาย (male)'],['female','หญิง (female)'],['neutral','neutral']].forEach(([v,l]) => {
            const o = NF.el('option', { value: v }, l);
            if (g.gender === v) o.selected = true;
            s.appendChild(o);
          });
          return s;
        })(),
      ),
    ));
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'Note (สำหรับ prompt)' }),
      NF.el('textarea', { id: 'glNote', class: 'input textarea', rows: 3, text: g.note || '' }),
    ));

    const ok = NF.el('button', { class: 'btn btn-primary', text: 'บันทึก' });
    const del = NF.el('button', { class: 'btn btn-danger', text: '🗑 ลบ', style: isNew ? { display: 'none' } : {} });
    const cancel = NF.el('button', { class: 'btn btn-ghost', text: 'ยกเลิก' });
    const foot = NF.el('div', {}, del, NF.el('span', { class: 'spacer' }), cancel, ok);
    const inst = NF.modal.open({ title: isNew ? 'เพิ่มคำใหม่' : 'แก้ไขคำ', body, footer: foot });
    cancel.onclick = () => inst.close();
    ok.onclick = async () => {
      g.source = $('#glSrc').value.trim();
      g.thai = $('#glThai').value.trim();
      g.type = $('#glType').value;
      g.gender = $('#glGen').value;
      g.note = $('#glNote').value.trim();
      if (!g.source || !g.thai) { NF.toast.warn('กรอกคำและคำแปลให้ครบ'); return; }
      ws.glossary = ws.glossary || [];
      if (isNew) ws.glossary.push(g);
      await NF.store.saveWorkspace(ws);
      inst.close();
      render();
      NF.toast.success(isNew ? 'เพิ่มแล้ว' : 'บันทึกแล้ว');
    };
    del.onclick = () => deleteOne(g.id).then(() => inst.close());
  }

  async function handleMenuAction(act) {
    const ws = NF.state.currentWs;
    if (!ws) return;
    if (act === 'dedupe2') {
      await runTwoStageDedupe(ws);
      return;
    }
    if (act === 'autogloss') {
      const stats = NF.glossary.harmonizeOneToOne(ws.glossary || []);
      await NF.store.saveWorkspace(ws);
      render();
      if (stats.fixedEntries > 0) {
        NF.toast.success(`Auto Glossary: แก้ ${stats.fixedEntries} รายการ (strict ${stats.strictGroups} · loose ${stats.looseGroups})`);
      } else {
        NF.toast.success('Auto Glossary: ไม่พบคำที่ต้องแก้');
      }
      return;
    }
    if (act === 'dedupe') {
      const conflicts = NF.glossary.findSubstringConflicts(ws.glossary);
      if (!conflicts.length) { NF.toast.success('ไม่พบการซ้ำ'); return; }
      const body = NF.el('div', {});
      body.appendChild(NF.el('p', { class: 'modal-help', text: `พบ ${conflicts.length} คู่ที่คำซ้อนกัน ให้ตรวจเองและแก้ไข` }));
      for (const c of conflicts.slice(0, 50)) {
        body.appendChild(NF.el('div', { class: 'gl-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '8px' } },
          NF.el('div', {}, NF.el('strong', { class: 'mono', text: c.a.source }), ' → ', c.a.thai),
          NF.el('div', {}, NF.el('strong', { class: 'mono', text: c.b.source }), ' → ', c.b.thai),
        ));
      }
      NF.modal.open({ title: 'คำที่ซ้อนกัน', body, size: 'lg' });
    }
    else if (act === 'autoqa') {
      NF.modal.alert({ title: 'AI QA', message: 'กำลัง QA... ดูผลที่ log' });
      const body = NF.el('div', {});
      const log = NF.el('div', { class: 'auto-log', style: { maxHeight: '320px' } });
      body.appendChild(log);
      const inst = NF.modal.open({ title: 'AI QA Glossary', body });
      try {
        const { issues } = await NF.glossary.qaGlossary({
          ws,
          onLog: (m) => log.appendChild(NF.el('div', { class: 'log-row' }, NF.el('span', { text: m }))),
        });
        log.appendChild(NF.el('div', { class: 'log-row success' }, NF.el('span', { text: `= พบ ${issues.length} ปัญหา =` })));
        for (const iss of issues) {
          log.appendChild(NF.el('div', { class: 'log-row warn' }, NF.el('span', { text: `${iss.source}: ${iss.problem} → ${iss.suggestion || '-'}` })));
        }
      } catch (e) {
        log.appendChild(NF.el('div', { class: 'log-row error' }, NF.el('span', { text: e.message })));
      }
    }
    else if (act === 'inherit') {
      // copy from other workspace
      const list = await NF.store.listWorkspaces();
      const others = list.filter(w => w.id !== ws.id);
      if (!others.length) { NF.toast.warn('ไม่มี workspace อื่น'); return; }
      const body = NF.el('div', {});
      body.appendChild(NF.el('p', { class: 'modal-help', text: 'เลือก workspace ที่ต้องการคัดลอก glossary มา (merge)' }));
      const sel = NF.el('select', { class: 'select' });
      others.forEach(o => sel.appendChild(NF.el('option', { value: o.id }, `${o.title} (${o.glossary?.length || 0} คำ)`)));
      body.appendChild(sel);
      const ok = NF.el('button', { class: 'btn btn-primary', text: 'Merge' });
      const cancel = NF.el('button', { class: 'btn btn-ghost', text: 'ยกเลิก' });
      const foot = NF.el('div', {}, cancel, ok);
      const inst = NF.modal.open({ title: 'รับ Glossary จาก Workspace อื่น', body, footer: foot });
      cancel.onclick = () => inst.close();
      ok.onclick = async () => {
        const srcWs = others.find(w => w.id === sel.value);
        if (!srcWs?.glossary?.length) { inst.close(); return; }
        const res = await NF.glossary.addToWorkspace(ws, srcWs.glossary);
        inst.close();
        render();
        NF.toast.success(`เพิ่มใหม่ ${res.added} · อัพเดต ${res.updated}`);
      };
    }
  }

  async function exportCSV() {
    const ws = NF.state.currentWs;
    if (!ws?.glossary?.length) { NF.toast.warn('ไม่มี glossary'); return; }
    const csv = NF.glossary.toCSV(ws.glossary);
    NF.download('\ufeff' + csv, NF.slug(ws.title) + '-glossary.csv', 'text/csv;charset=utf-8');
    NF.toast.success('Export CSV แล้ว');
  }

  async function importCSV() {
    const f = await NF.pickFile('.csv');
    if (!f) return;
    try {
      let text = await NF.readText(f);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const terms = NF.glossary.fromCSV(text);
      if (!terms.length) { NF.toast.warn('CSV ว่าง'); return; }

      // preview modal
      const body = NF.el('div', {});
      body.appendChild(NF.el('p', { class: 'modal-help', text: `พบ ${terms.length} คำใน CSV — ตรวจก่อนนำเข้า` }));
      const table = NF.el('table', { class: 'csv-table' });
      table.innerHTML = `<thead><tr><th>source</th><th>thai</th><th>type</th><th>gender</th></tr></thead>`;
      const tb = NF.el('tbody');
      for (const t of terms.slice(0, 50)) {
        const r = NF.el('tr');
        r.innerHTML = `<td>${esc(t.source)}</td><td>${esc(t.thai)}</td><td>${esc(t.type)}</td><td>${esc(t.gender)}</td>`;
        tb.appendChild(r);
      }
      if (terms.length > 50) {
        const r = NF.el('tr');
        r.innerHTML = `<td colspan="4" style="text-align:center;color:var(--ink-dim)">... อีก ${terms.length - 50} แถว</td>`;
        tb.appendChild(r);
      }
      table.appendChild(tb);
      body.appendChild(table);

      const ok = NF.el('button', { class: 'btn btn-primary', text: `นำเข้า ${terms.length} คำ` });
      const cancel = NF.el('button', { class: 'btn btn-ghost', text: 'ยกเลิก' });
      const foot = NF.el('div', {}, cancel, ok);
      const inst = NF.modal.open({ title: 'ตัวอย่าง CSV', body, footer: foot, size: 'lg' });
      cancel.onclick = () => inst.close();
      ok.onclick = async () => {
        const ws = NF.state.currentWs;
        const res = await NF.glossary.addToWorkspace(ws, terms);
        inst.close();
        render();
        NF.toast.success(`เพิ่มใหม่ ${res.added} · อัพเดต ${res.updated}`);
      };
    } catch (err) {
      NF.toast.error('Import CSV ผิดพลาด: ' + err.message);
    }
  }

  function esc(s) {
    return String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  }

  // ═══════════════════════════════════════════
  // 2-Stage Dedupe Workflow
  // Stage 1: auto exact dedupe (instant)
  // Stage 2: AI fuzzy verification (similar pairs)
  // ═══════════════════════════════════════════
  async function runTwoStageDedupe(ws) {
    if (!ws.glossary?.length) { NF.toast.warn('ไม่มี glossary'); return; }

    // ─── Stage 1: instant auto dedupe ───
    const stage1 = NF.glossary.dedupeStrict(ws.glossary);
    const removedExact = stage1.removed;
    const conflicts = stage1.conflicts;

    // ─── Stage 2: หา similar pairs ───
    const similarPairs = NF.glossary.findSimilarPairs(stage1.kept);

    // รวม conflicts จาก stage 1 (source ตรงเป๊ะ Thai ต่าง) เป็น "force-AI" pairs
    const allPairsForAI = [
      ...conflicts.map(c => ({
        a: c.canonical,
        b: c.variant,
        reason: 'same-source-different-thai',
        score: 1.0,
      })),
      ...similarPairs,
    ];

    // ─── แสดง modal สรุป + ให้ตัดสินใจรัน AI ───
    showDedupeReportModal({
      ws,
      original: ws.glossary.length,
      stage1Removed: removedExact,
      conflicts,
      similarPairs,
      allPairsForAI,
    });
  }

  function showDedupeReportModal({ ws, original, stage1Removed, conflicts, similarPairs, allPairsForAI }) {
    const body = NF.el('div', {});
    body.appendChild(NF.el('p', { class: 'modal-help',
      text: `ตรวจคำซ้ำใน Glossary จำนวน ${original} คำ — Stage 1 ทำงานอัตโนมัติเสร็จแล้ว, Stage 2 ต้องใช้ AI` }));

    // Stage 1 summary
    body.appendChild(NF.el('h4', { text: 'Stage 1 — Auto Exact Match',
      style: { marginTop: '8px', color: 'var(--ok)' } }));

    if (!stage1Removed.length && !conflicts.length) {
      body.appendChild(NF.el('p', { class: 'dim', style: { fontSize: '13px', margin: '6px 0' },
        text: '∅ ไม่พบคำซ้ำเป๊ะ' }));
    } else {
      body.appendChild(NF.el('p', { style: { fontSize: '13px', margin: '6px 0' } },
        NF.el('span', { text: `พร้อมลบทันที: ` }),
        NF.el('strong', { style: { color: 'var(--err)' }, text: `${stage1Removed.length} คำซ้ำเป๊ะ` }),
        conflicts.length ? NF.el('span', { text: ` · ${conflicts.length} คู่ที่ source ตรงแต่ Thai ต่าง (จะส่ง AI ตรวจ)` }) : null,
      ));

      if (stage1Removed.length) {
        const ul = NF.el('ul', { style: { fontSize: '12px', maxHeight: '120px', overflow: 'auto', paddingLeft: '20px', color: 'var(--ink-mute)', fontFamily: 'var(--ff-mono)' } });
        for (const r of stage1Removed.slice(0, 30)) {
          ul.appendChild(NF.el('li', { text: `${r.source} → ${r.thai}` }));
        }
        if (stage1Removed.length > 30) {
          ul.appendChild(NF.el('li', { style: { color: 'var(--ink-dim)' }, text: `... อีก ${stage1Removed.length - 30}` }));
        }
        body.appendChild(ul);
      }
    }

    // Stage 2 summary
    body.appendChild(NF.el('h4', { text: 'Stage 2 — AI Fuzzy Match',
      style: { marginTop: '14px', color: 'var(--accent)' } }));

    if (!allPairsForAI.length) {
      body.appendChild(NF.el('p', { class: 'dim', style: { fontSize: '13px', margin: '6px 0' },
        text: '∅ ไม่พบคู่ที่คล้องจองกัน — ไม่ต้องใช้ AI' }));
    } else {
      body.appendChild(NF.el('p', { style: { fontSize: '13px', margin: '6px 0' } },
        NF.el('span', { text: `พบ ` }),
        NF.el('strong', { style: { color: 'var(--accent)' }, text: `${allPairsForAI.length} คู่ที่ต้องตรวจ` }),
        NF.el('span', { text: ` (ต้องใช้ AI ตัดสินว่าเป็นคำเดียวกันหรือคนละคำ)` }),
      ));

      // preview top pairs
      const ul = NF.el('ul', { style: { fontSize: '12px', maxHeight: '180px', overflow: 'auto', paddingLeft: '20px', color: 'var(--ink-mute)' } });
      for (const p of allPairsForAI.slice(0, 20)) {
        ul.appendChild(NF.el('li', {},
          NF.el('span', { class: 'mono', text: p.a.source }),
          NF.el('span', { text: ` (${p.a.thai}) ↔ ` }),
          NF.el('span', { class: 'mono', text: p.b.source }),
          NF.el('span', { text: ` (${p.b.thai})` }),
          NF.el('span', { class: 'pill', style: { marginLeft: '6px', fontSize: '10px' }, text: p.reason }),
        ));
      }
      if (allPairsForAI.length > 20) {
        ul.appendChild(NF.el('li', { style: { color: 'var(--ink-dim)' }, text: `... อีก ${allPairsForAI.length - 20} คู่` }));
      }
      body.appendChild(ul);
    }

    // ─── footer buttons ───
    const cancel = NF.el('button', { class: 'btn btn-ghost', text: 'ยกเลิก' });
    const stage1OnlyBtn = NF.el('button', { class: 'btn btn-ghost', text: 'ลบ Stage 1 อย่างเดียว' });
    const fullBtn = NF.el('button', { class: 'btn btn-primary', text: 'ลบ Stage 1 + ส่ง AI ตรวจ Stage 2 ▶' });

    if (!stage1Removed.length) stage1OnlyBtn.disabled = true;
    if (!allPairsForAI.length) fullBtn.disabled = true;

    const foot = NF.el('div', {}, cancel, stage1OnlyBtn, fullBtn);
    const inst = NF.modal.open({ title: '🔍 เช็คคำซ้ำ — สรุปผล', body, footer: foot, size: 'lg' });

    cancel.onclick = () => inst.close();

    stage1OnlyBtn.onclick = async () => {
      // ลบ stage 1 only — ใช้ list ที่ stage 1 คืนมา (ws.glossary หลัง filter)
      // แต่ต้อง re-run เพราะ ws.glossary อาจถูก mutate
      const fresh = NF.glossary.dedupeStrict(ws.glossary);
      ws.glossary = fresh.kept;
      await NF.store.saveWorkspace(ws);
      inst.close();
      NF.toast.success(`ลบคำซ้ำเป๊ะ ${fresh.removed.length} คำ`);
      render();
    };

    fullBtn.onclick = async () => {
      inst.close();
      // เริ่ม Stage 2 modal — log realtime
      runStage2WithProgress({ ws, allPairsForAI, stage1Removed: stage1Removed.length });
    };
  }

  function runStage2WithProgress({ ws, allPairsForAI, stage1Removed }) {
    const body = NF.el('div', {});
    body.appendChild(NF.el('p', { class: 'modal-help',
      text: `Stage 1: ลบ ${stage1Removed} คำซ้ำเป๊ะ — Stage 2: ส่ง ${allPairsForAI.length} คู่ให้ AI ตัดสิน` }));
    const log = NF.el('div', { class: 'auto-log', style: { maxHeight: '320px', minHeight: '200px' } });
    body.appendChild(log);

    const stopBtn = NF.el('button', { class: 'btn btn-danger', text: '■ หยุด' });
    const closeBtn = NF.el('button', { class: 'btn btn-ghost', text: 'ปิด', style: { display: 'none' } });
    const foot = NF.el('div', {}, stopBtn, closeBtn);
    const inst = NF.modal.open({ title: '🤖 Stage 2 — AI กำลังตรวจ', body, footer: foot, size: 'lg', dismissOnBackdrop: false });

    const abort = new AbortController();
    stopBtn.onclick = () => abort.abort();

    const addLog = (msg, cls = '') => {
      log.appendChild(NF.el('div', { class: 'log-row' + (cls ? ' ' + cls : '') },
        NF.el('span', { class: 'ts', text: new Date().toTimeString().slice(0, 8) }),
        NF.el('span', { text: msg }),
      ));
      log.scrollTop = log.scrollHeight;
    };

    (async () => {
      try {
        // ─── Stage 1 first ───
        const fresh = NF.glossary.dedupeStrict(ws.glossary);
        ws.glossary = fresh.kept;
        addLog(`✓ Stage 1: ลบคำซ้ำเป๊ะ ${fresh.removed.length} คำ`, 'success');

        // ─── Stage 2 ───
        addLog(`เริ่มส่ง AI ตรวจ ${allPairsForAI.length} คู่...`);
        const decisions = await NF.glossary.aiVerifyPairs({
          ws, pairs: allPairsForAI, signal: abort.signal,
          onLog: (m) => addLog(m),
        });

        addLog(`AI คืนผล ${decisions.length} คู่`, 'success');

        // นับ verdict
        const counts = { merge: 0, separate: 0, 'fix-thai': 0 };
        decisions.forEach(d => { if (counts[d.verdict] !== undefined) counts[d.verdict]++; });
        addLog(`merge: ${counts.merge} · separate: ${counts.separate} · fix-thai: ${counts['fix-thai']}`);

        // ─── Apply ───
        const stats = await NF.glossary.applyDedupeDecisions(ws, decisions);
        addLog(`✓ ใช้: merge ${stats.merged} · fix-thai ${stats.fixed} · separate ${stats.separated}`, 'success');

        await NF.store.saveWorkspace(ws);
        addLog(`= เสร็จสิ้น — เหลือ ${ws.glossary.length} คำ =`, 'success');

        render();
        NF.toast.success(`Dedupe เสร็จ — เหลือ ${ws.glossary.length} คำ`);
      } catch (err) {
        if (err.name === 'AbortError') {
          addLog('หยุดโดยผู้ใช้', 'warn');
        } else {
          addLog('ผิดพลาด: ' + err.message, 'error');
          NF.log?.error('glossary-tab', 'dedupe2 failed', err);
        }
      } finally {
        stopBtn.style.display = 'none';
        closeBtn.style.display = '';
      }
    })();

    closeBtn.onclick = () => inst.close();
  }

  return { init, render };
})();
