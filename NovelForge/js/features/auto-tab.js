/* ═══════════════════════════════════════════════════════
   auto-tab.js — 5-step auto translation pipeline
   Select → Glossary → QA → Translate → Done
   ═══════════════════════════════════════════════════════ */

NF.autoTab = (function() {

  const $ = NF.$;

  let _step = 'select';
  let _selectedIds = new Set();
  let _abort = null;

  function init() {
    $('#autoSelAll').onclick    = () => { setAll(true); };
    $('#autoSelNone').onclick   = () => { setAll(false); };
    $('#autoSelPending').onclick = selectPending;
    $('#btnAutoStart').onclick = startPipeline;
    $('#btnMarathonConfig').onclick = openMarathonConfig;
    $('#btnMarathonPause').onclick = () => NF.marathon?.pause();
    $('#btnMarathonStop').onclick  = () => _abort?.abort();
    $('#btnDoneBack').onclick = () => {
      setStep('select');
      NF.tabs.activate('chapters');
    };
    $('#btnDoneExport').onclick = () => NF.importExport.openExportModal([..._selectedIds]);

    NF.on('tab:changed', (e) => {
      if (e.detail.name === 'auto') refreshChapterList();
    });
    NF.on('ws:selected', refreshChapterList);
  }

  function refreshChapterList() {
    const ws = NF.state.currentWs;
    const box = $('#autoChapterList');
    box.innerHTML = '';
    if (!ws) return;
    const list = ws.chapters || [];
    for (const ch of list) {
      const row = NF.el('div', { class: 'auto-ch-item' + (_selectedIds.has(ch.id) ? ' selected' : '') },
        NF.el('input', { type: 'checkbox', checked: _selectedIds.has(ch.id), onchange: (e) => {
          if (e.target.checked) _selectedIds.add(ch.id);
          else _selectedIds.delete(ch.id);
          row.classList.toggle('selected', e.target.checked);
          updateCount();
        }}),
        NF.el('span', { class: 'num', text: '#' + (ch.num || '?') }),
        NF.el('span', { class: 'title', text: ch.title || '(ไม่มีชื่อ)' }),
        NF.el('span', { class: 'ch-status ' + (ch.status || 'pending'), text: statusLabel(ch.status) }),
      );
      row.onclick = (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = row.querySelector('input');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      };
      box.appendChild(row);
    }
    updateCount();
  }

  function statusLabel(s) {
    switch (s) {
      case 'translated': return '✓';
      case 'edited':     return '✎';
      case 'translating':return '…';
      default:           return '○';
    }
  }

  function setAll(v) {
    const ws = NF.state.currentWs;
    if (!ws) return;
    (ws.chapters || []).forEach(c => v ? _selectedIds.add(c.id) : _selectedIds.delete(c.id));
    refreshChapterList();
  }
  function selectPending() {
    const ws = NF.state.currentWs;
    if (!ws) return;
    _selectedIds.clear();
    (ws.chapters || []).forEach(c => {
      if (c.status !== 'translated' && c.status !== 'edited') _selectedIds.add(c.id);
    });
    refreshChapterList();
  }
  function updateCount() {
    $('#autoSelCount').textContent = `${_selectedIds.size} ตอน`;
  }

  function startWithSelection(ids) {
    _selectedIds = new Set(ids);
    NF.tabs.activate('auto');
    refreshChapterList();
    setTimeout(startPipeline, 100);
  }

  function setStep(name) {
    _step = name;
    NF.$$('.step').forEach(s => {
      s.classList.remove('active', 'done');
      const idx = ['select','glossary','qa','translate','done'].indexOf(s.dataset.step);
      const curIdx = ['select','glossary','qa','translate','done'].indexOf(name);
      if (idx < curIdx) s.classList.add('done');
      else if (idx === curIdx) s.classList.add('active');
    });
    NF.$$('.step-body').forEach(b => b.hidden = b.dataset.body !== name);
  }

  async function startPipeline() {
    const ws = NF.state.currentWs;
    if (!ws) { NF.toast.warn('กรุณาเลือก Workspace'); return; }
    if (!NF.store.getApiKey()) {
      NF.toast.error('ยังไม่ได้ตั้ง API Key');
      NF.tabs.activate('settings');
      return;
    }
    const ids = [..._selectedIds];
    if (!ids.length) { NF.toast.warn('ยังไม่ได้เลือกตอน'); return; }

    _abort = new AbortController();
    const skipGlossary = $('#autoSkipGlossary')?.checked === true;
    const agentMode    = $('#autoAgentMode')?.checked !== false;
    const driftFix     = $('#autoDriftFix')?.checked !== false;

    NF.log.info('auto', 'pipeline starting', {
      chapters: ids.length, skipGlossary, agentMode, driftFix,
    });

    // ─── Step 2: Glossary extraction (+ Agent triage if enabled) ───
    if (!skipGlossary) {
      setStep('glossary');
      const logBox = $('#glossaryLog');
      logBox.innerHTML = '';
      try {
        const chapters = ids.map(id => ws.chapters.find(c => c.id === id)).filter(Boolean);

        if (agentMode) {
          // AUTONOMOUS — no modals, agent decides
          logToBox(logBox, '🤖 Agent Mode: ทำงานอัตโนมัติ ไม่ต้องยืนยัน', 'success');
          const proposed = await NF.glossary.extractFromChapters({
            ws, chapters, signal: _abort.signal,
            onLog: (msg) => logToBox(logBox, msg),
          });
          if (proposed.length) {
            const decisions = await NF.glossaryAgent.triage({
              ws, proposed, signal: _abort.signal,
              onLog: (msg) => logToBox(logBox, msg),
            });
            const stats = await NF.glossaryAgent.applyDecisions(ws, decisions, {
              onLog: (msg) => logToBox(logBox, msg, 'success'),
            });
            logToBox(logBox,
              `\n✓ Agent triage เสร็จสิ้น: +${stats.added} ใหม่ · ${stats.updated} อัพเดต · ${stats.merged} alias · ${stats.rejected} ปฏิเสธ`,
              'success');
            NF.glossaryTab?.render();
          } else {
            logToBox(logBox, '\n(ไม่พบคำใหม่)', 'warn');
          }
        } else {
          // LEGACY — show human-review modal
          const newTerms = await NF.glossary.extractFromChapters({
            ws, chapters, signal: _abort.signal,
            onLog: (msg) => logToBox(logBox, msg),
          });
          if (newTerms.length) {
            const res = await NF.glossary.addToWorkspace(ws, newTerms);
            logToBox(logBox, `\n✓ เพิ่มใหม่ ${res.added} · อัพเดต ${res.updated}`, 'success');
            if (res.harmonized?.fixedEntries) {
              logToBox(logBox, `✓ Auto Glossary harmonize: แก้ ${res.harmonized.fixedEntries} รายการ`, 'success');
            }
            await showNewTermsPreview(newTerms);
          } else {
            logToBox(logBox, '\n(ไม่พบคำใหม่)', 'warn');
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') { NF.toast.warn('หยุดแล้ว'); setStep('select'); return; }
        NF.log.error('auto', 'glossary phase failed', err);
        logToBox(logBox, 'ผิดพลาด: ' + err.message, 'error');
      }
    }

    // ─── Step 3 REMOVED in Agent Mode ───
    // The Agent already did triage. Skip the separate QA step entirely.
    // (For legacy non-agent mode, QA was always hand-reviewed — also skip
    // in marathon use case. Users who want it can run it manually from
    // Glossary tab.)

    // ─── Step 4: Marathon translate ───
    setStep('translate');
    let marathonStats = null;
    try {
      await NF.marathon.run({
        ws,
        chapterIds: ids,
        signal: _abort.signal,
        onStart: () => {},
        onProgress: (info) => updateMarathonUI(info),
        onDone: (stats) => {
          marathonStats = stats;
          NF.chapters.render();
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        NF.toast.warn('หยุดแล้ว');
        setStep('select');
        return;
      }
      NF.log.error('auto', 'marathon failed', err);
      NF.toast.error('ผิดพลาด: ' + err.message);
      setStep('select');
      return;
    }

    // ─── Step 5: Post-translation drift detection (Agent Mode) ───
    let driftResult = null;
    if (driftFix && agentMode) {
      const logBox = $('#marathonLog');
      const doneChapters = ids.filter(id => {
        const ch = ws.chapters.find(c => c.id === id);
        return ch && (ch.status === 'translated' || ch.status === 'edited');
      });
      if (doneChapters.length) {
        logToBox(logBox, `\n🔍 ตรวจ Glossary Drift ใน ${doneChapters.length} ตอน...`, 'success');
        try {
          driftResult = await NF.glossaryAgent.detectDrift({
            ws,
            chapterIds: doneChapters,
            signal: _abort.signal,
            autoFix: true,
            onLog: (msg) => logToBox(logBox, msg),
          });
          if (driftResult.fixed > 0) {
            logToBox(logBox, `✓ แก้ไข drift อัตโนมัติ ${driftResult.fixed} จุด`, 'success');
            NF.chapters.render();
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            NF.log.error('auto', 'drift detection failed', err);
            logToBox(logBox, 'drift detection error: ' + err.message, 'error');
          }
        }
      }
    }

    // Done screen
    setStep('done');
    const s = marathonStats || { done: 0, fail: 0, elapsedSec: 0 };
    $('#doneTitle').textContent = `แปลเสร็จสิ้น ${s.done} ตอน`;
    const extras = [];
    extras.push(`เสร็จ ${s.done}`);
    if (s.fail) extras.push(`ล้มเหลว ${s.fail}`);
    extras.push(`ใช้เวลา ${NF.fmt.num(s.elapsedSec)} วินาที`);
    if (driftResult && driftResult.drifts.length) {
      extras.push(`drift ${driftResult.drifts.length} จุด (แก้ ${driftResult.fixed})`);
    }
    $('#doneSummary').textContent = extras.join(' · ');
  }

  function logToBox(box, msg, cls = '') {
    const ts = new Date().toTimeString().slice(0, 8);
    const row = NF.el('div', { class: 'log-row' + (cls ? ' ' + cls : '') },
      NF.el('span', { class: 'ts', text: ts }),
      NF.el('span', { text: msg }),
    );
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  async function showNewTermsPreview(terms) {
    return new Promise((resolve) => {
      const body = NF.el('div', {});
      body.appendChild(NF.el('p', { class: 'modal-help', text: `พบคำใหม่ ${terms.length} คำ — แก้ไข/untick คำที่ไม่ต้องการเก็บ` }));
      const rows = [];
      const list = NF.el('div', { class: 'ag-list' });
      for (const t of terms) {
        const row = NF.el('div', { class: 'ag-item' });
        const chk = NF.el('input', { type: 'checkbox', checked: true });
        const src = NF.el('input', { type: 'text', value: t.source });
        const thai = NF.el('input', { type: 'text', value: t.thai });
        const type = NF.el('select', {});
        ['character','place','term','skill','title','rank','honorific','other'].forEach(v => {
          const o = NF.el('option', { value: v }, v);
          if (t.type === v) o.selected = true;
          type.appendChild(o);
        });
        const gen = NF.el('select', {});
        ['','male','female','neutral'].forEach(v => {
          const o = NF.el('option', { value: v }, v || '—');
          if (t.gender === v) o.selected = true;
          gen.appendChild(o);
        });
        row.appendChild(chk);
        row.appendChild(src);
        row.appendChild(thai);
        row.appendChild(type);
        row.appendChild(gen);
        rows.push({ t, chk, src, thai, type, gen });
        list.appendChild(row);
      }
      body.appendChild(list);
      const ok = NF.el('button', { class: 'btn btn-primary', text: 'ยืนยัน' });
      const skip = NF.el('button', { class: 'btn btn-ghost', text: 'ข้าม' });
      const foot = NF.el('div', {}, skip, ok);
      const inst = NF.modal.open({ title: 'ตรวจ Glossary ที่ AI สกัดมา', body, footer: foot, size: 'lg', dismissOnBackdrop: false });
      skip.onclick = () => { inst.close(); resolve(); };
      ok.onclick = async () => {
        // rebuild glossary in ws — replace previously-added terms with the finalized versions
        const ws = NF.state.currentWs;
        // clean up last-added (matching source keys from this batch)
        const sourceKeys = new Set(terms.map(t => t.source.toLowerCase()));
        ws.glossary = (ws.glossary || []).filter(g => !sourceKeys.has((g.source || '').toLowerCase()));
        // re-add with user edits
        const finalTerms = rows.filter(r => r.chk.checked && r.src.value.trim() && r.thai.value.trim())
          .map(r => ({
            source: r.src.value.trim(),
            thai: r.thai.value.trim(),
            type: r.type.value,
            gender: r.gen.value,
            note: r.t.note || '',
          }));
        const res = await NF.glossary.addToWorkspace(ws, finalTerms);
        NF.toast.success(`เพิ่ม ${res.added} คำ`);
        inst.close();
        resolve();
      };
    });
  }

  async function showQAResults(issues) {
    return new Promise((resolve) => {
      const body = NF.el('div', {});
      body.appendChild(NF.el('p', { class: 'modal-help', text: 'AI พบปัญหาต่อไปนี้ ตรวจสอบและแก้ด้วยตัวเองที่แท็บ Glossary ถ้าต้องการ' }));
      for (const iss of issues) {
        const sev = iss.severity === 'high' ? 'danger' : iss.severity === 'medium' ? 'warn' : '';
        body.appendChild(NF.el('div', { class: 'gl-row', style: { display: 'block' } },
          NF.el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' } },
            NF.el('strong', { class: 'mono', text: iss.source || '—' }),
            NF.el('span', { class: 'pill ' + sev, text: iss.severity || '—' }),
          ),
          NF.el('div', { style: { fontSize: '13px' }, text: iss.problem || '' }),
          iss.suggestion ? NF.el('div', { style: { fontSize: '12px', color: 'var(--ok)' }, text: '→ ' + iss.suggestion }) : null,
        ));
      }
      const ok = NF.el('button', { class: 'btn btn-primary', text: 'รับทราบ ไปต่อ' });
      const foot = NF.el('div', {}, ok);
      const inst = NF.modal.open({ title: 'ผลการ QA', body, footer: foot, size: 'lg' });
      ok.onclick = () => { inst.close(); resolve(); };
    });
  }

  function updateMarathonUI(info) {
    if (info.stats) {
      $('#mQueueCount').textContent = info.stats.queue ?? 0;
      $('#mDoneCount').textContent = info.stats.done ?? 0;
      $('#mFailCount').textContent = info.stats.fail ?? 0;
      $('#mWorkerCount').textContent = info.stats.workers ?? 0;
      const pct = info.stats.total
        ? Math.floor((info.stats.done + info.stats.fail) / info.stats.total * 100)
        : 0;
      $('#mProgressFill').style.width = pct + '%';
      $('#mProgressLabel').textContent = `${info.stats.done + info.stats.fail} / ${info.stats.total} (${pct}%)`;
    }
    if (info.workers) {
      const box = $('#workerSlots');
      box.innerHTML = '';
      for (const w of info.workers) {
        const slot = NF.el('div', { class: 'worker-slot' + (w.idle ? ' idle' : '') },
          NF.el('span', { class: 'wid', text: `W${w.id}` }),
          w.idle ? NF.el('span', { text: 'idle' }) : NF.el('span', { text: w.chapterTitle || '—' }),
          w.startTs ? NF.el('span', { class: 'elapsed', text: ' (' + Math.floor((Date.now() - w.startTs)/1000) + 's)' }) : null,
        );
        box.appendChild(slot);
      }
    }
    if (info.log) {
      const box = $('#marathonLog');
      const row = NF.el('div', { class: 'log-row' + (info.log.cls ? ' ' + info.log.cls : '') },
        NF.el('span', { class: 'ts', text: new Date().toTimeString().slice(0, 8) }),
        NF.el('span', { text: info.log.msg }),
      );
      box.appendChild(row);
      // cap log lines
      while (box.children.length > 500) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }
  }

  function openMarathonConfig() {
    const ws = NF.state.currentWs;
    if (!ws) return;
    const m = ws.marathon || {};
    const body = NF.el('div', {});
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'Concurrency' }),
      NF.el('input', { id: 'mcConc', type: 'number', class: 'input', value: m.concurrency || 3, min: 1, max: 10 }),
    ));
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'Daily limit (0 = unlimited)' }),
      NF.el('input', { id: 'mcLimit', type: 'number', class: 'input', value: m.dailyLimit || 0, min: 0 }),
    ));
    body.appendChild(NF.el('label', { class: 'chk-wrap' },
      NF.el('input', { id: 'mcRetry', type: 'checkbox', checked: m.retry !== false }),
      NF.el('span', { text: 'Retry on error' }),
    ));
    body.appendChild(NF.el('label', { class: 'chk-wrap' },
      NF.el('input', { id: 'mcSum', type: 'checkbox', checked: m.autoSummary !== false }),
      NF.el('span', { text: 'Auto summarize for context memory' }),
    ));
    const ok = NF.el('button', { class: 'btn btn-primary', text: 'บันทึก' });
    const cancel = NF.el('button', { class: 'btn btn-ghost', text: 'ยกเลิก' });
    const foot = NF.el('div', {}, cancel, ok);
    const inst = NF.modal.open({ title: 'ตั้งค่า Marathon', body, footer: foot });
    cancel.onclick = () => inst.close();
    ok.onclick = async () => {
      ws.marathon = ws.marathon || {};
      ws.marathon.concurrency = Math.max(1, parseInt($('#mcConc').value, 10) || 3);
      ws.marathon.dailyLimit = Math.max(0, parseInt($('#mcLimit').value, 10) || 0);
      ws.marathon.retry = $('#mcRetry').checked;
      ws.marathon.autoSummary = $('#mcSum').checked;
      await NF.store.saveWorkspace(ws);
      inst.close();
      NF.toast.success('บันทึกแล้ว');
    };
  }

  return { init, refreshChapterList, startWithSelection, setStep, updateMarathonUI };
})();
