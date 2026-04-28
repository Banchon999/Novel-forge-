/* ═══════════════════════════════════════════════════════
   workspace.js — workspace lifecycle
   ═══════════════════════════════════════════════════════ */

NF.workspace = (function() {

  const $ = NF.$;

  function init() {
    $('#btnNwsNew').onclick = promptCreate;
    $('#btnNwsImport').onclick = async () => {
      const f = await NF.pickFile('.json,.zip');
      if (f) await importFromFile(f);
    };
  }

  async function promptCreate() {
    const body = NF.el('div', {});
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'ชื่อเรื่อง' }),
      NF.el('input', { id: 'newWsTitle', class: 'input', placeholder: 'เช่น: โลกของนักเวทย์ชั้นสูง' }),
    ));
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'ผู้แต่ง (ไม่บังคับ)' }),
      NF.el('input', { id: 'newWsAuthor', class: 'input', placeholder: '' }),
    ));
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'แนว (Tag)' }),
      NF.el('input', { id: 'newWsTags', class: 'input', placeholder: 'แฟนตาซี, กำลังภายใน, ฯลฯ' }),
    ));
    body.appendChild(NF.el('div', { class: 'field' },
      NF.el('span', { text: 'Register เริ่มต้น' }),
      (() => {
        const sel = NF.el('select', { id: 'newWsRegister', class: 'select' });
        [
          ['neutral',  'กลาง (ฉัน/เขา/เธอ)'],
          ['modern',   'สมัยใหม่ (ผม/ฉัน + ครับ/ค่ะ)'],
          ['archaic',  'โบราณ/กำลังภายใน (ข้า/เจ้า)'],
          ['rough',    'หยาบ (กู/มึง)'],
          ['none',     'ไร้หางเสียง (ละสรรพนาม)'],
          ['literal',  'ตรงตัว (Literal)'],
          ['auto',     'Auto (ตามโทน)'],
        ].forEach(([v, l]) => sel.appendChild(NF.el('option', { value: v }, l)));
        return sel;
      })(),
    ));

    const ok = NF.el('button', { class: 'btn btn-primary', text: 'สร้าง' });
    const cancel = NF.el('button', { class: 'btn btn-ghost', text: 'ยกเลิก' });
    const foot = NF.el('div', {}, cancel, ok);

    const inst = NF.modal.open({ title: 'สร้าง Workspace ใหม่', body, footer: foot });
    cancel.onclick = () => inst.close();
    ok.onclick = async () => {
      try {
        const title = $('#newWsTitle').value.trim() || 'Untitled';
        NF.log.info('workspace', 'creating new', { title });
        const ws = await NF.store.createWorkspace({
          title,
          author: $('#newWsAuthor').value.trim(),
          tags: $('#newWsTags').value.trim(),
        });
        ws.settings.registerDefault = $('#newWsRegister').value;
        await NF.store.saveWorkspace(ws);
        NF.log.info('workspace', 'created', { id: ws.id });
        inst.close();
        await select(ws.id);
        NF.toast.success('สร้าง Workspace สำเร็จ');
      } catch (err) {
        NF.log.error('workspace', 'create failed', err);
        NF.toast.error('สร้างไม่สำเร็จ: ' + err.message);
      }
    };
    setTimeout(() => $('#newWsTitle').focus(), 100);
  }

  async function select(id) {
    NF.log.info('workspace', 'select()', { id });
    try {
      const ws = await NF.store.getWorkspace(id);
      if (!ws) {
        NF.log.warn('workspace', 'select: ws not found', { id });
        return;
      }
      NF.state.currentWs = ws;
      await NF.store.setLastWs(id);
      NF.emit('ws:selected', { ws });
      NF.emit('ws:listChanged');
      updateUIForWs();
    } catch (err) {
      NF.log.error('workspace', 'select failed', err);
      NF.toast.error('เลือก workspace ไม่สำเร็จ: ' + err.message);
    }
  }

  function updateUIForWs() {
    const ws = NF.state.currentWs;
    NF.log.dbg('workspace', 'updateUIForWs', { hasWs: !!ws, wsId: ws?.id });

    if (!ws) {
      $('#wsTitle').textContent = '— ไม่มี Workspace —';
      $('#wsTitle').classList.remove('active');
      $('#noWsState').hidden = false;
      return;
    }

    // Critical: hide empty state + show title FIRST, before any render that
    // could throw. That way even if a tab breaks, user still sees the shell.
    $('#noWsState').hidden = true;
    $('#wsTitle').textContent = ws.title || 'Untitled';
    $('#wsTitle').classList.add('active');

    // Each render is isolated — a bug in one tab must not blank out the whole
    // app. Errors are logged + toasted but execution continues.
    const steps = [
      ['chapters.render',           () => NF.chapters?.render()],
      ['glossaryTab.render',        () => NF.glossaryTab?.render()],
      ['translateTab.refreshList',  () => NF.translateTab?.refreshChapterList()],
      ['readTab.refreshList',       () => NF.readTab?.refreshChapterList()],
      ['settingsTab.load',          () => NF.settingsTab?.load()],
      ['autoTab.refreshList',       () => NF.autoTab?.refreshChapterList?.()],
      ['workspace.updateCounts',    () => updateCounts()],
    ];
    for (const [name, fn] of steps) {
      try { fn(); }
      catch (err) {
        NF.log.error('workspace', `updateUIForWs: ${name} threw`, err);
      }
    }
  }

  function updateCounts() {
    const ws = NF.state.currentWs;
    if (!ws) return;
    $('#tabCountChapters').textContent = (ws.chapters || []).length;
    $('#tabCountGlossary').textContent = (ws.glossary || []).length;
  }

  async function deleteCurrent() {
    const ws = NF.state.currentWs;
    if (!ws) return;
    const ok = await NF.modal.confirm({
      title: 'ลบ Workspace นี้?',
      message: `จะลบ "${ws.title}" พร้อมทุกตอนและ glossary อย่างถาวร การกระทำนี้ย้อนกลับไม่ได้`,
      danger: true,
      confirmLabel: 'ลบถาวร',
    });
    if (!ok) return;
    await NF.store.deleteWorkspace(ws.id);
    NF.state.currentWs = null;
    await NF.store.clearLastWs();
    NF.emit('ws:listChanged');
    updateUIForWs();
    NF.toast.success('ลบ Workspace แล้ว');
  }

  async function exportJSON() {
    const ws = NF.state.currentWs;
    if (!ws) return;
    const name = NF.slug(ws.title || 'workspace') + '-' + new Date().toISOString().slice(0,10) + '.json';
    NF.download(JSON.stringify(ws, null, 2), name, 'application/json');
    NF.toast.success('Export JSON แล้ว');
  }

  async function importFromFile(file) {
    try {
      if (/\.json$/i.test(file.name)) {
        const txt = await NF.readText(file);
        const data = JSON.parse(txt);
        if (data._novelforge_backup && Array.isArray(data.workspaces)) {
          let n = 0;
          for (const ws of data.workspaces) {
            // new id to avoid conflict
            const copy = { ...ws, id: NF.genId(), updatedAt: Date.now() };
            await NF.store.saveWorkspace(copy);
            n++;
          }
          NF.emit('ws:listChanged');
          NF.toast.success(`นำเข้า ${n} workspace แล้ว`);
        } else if (data.id && Array.isArray(data.chapters)) {
          const ws = { ...data, id: NF.genId(), updatedAt: Date.now() };
          await NF.store.saveWorkspace(ws);
          NF.emit('ws:listChanged');
          await select(ws.id);
          NF.toast.success(`นำเข้า "${ws.title}" แล้ว`);
        } else {
          NF.toast.error('รูปแบบไฟล์ไม่ถูกต้อง');
        }
      } else {
        NF.toast.error('รองรับเฉพาะไฟล์ .json');
      }
    } catch (err) {
      NF.toast.error('Import ผิดพลาด: ' + err.message);
    }
  }

  return { init, promptCreate, select, updateUIForWs, updateCounts, deleteCurrent, exportJSON, importFromFile };
})();
