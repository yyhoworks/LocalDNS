/* Shared static fonts and browser previews. Based on clone-fan/LocalDNS PR #1. */
(() => {
  'use strict';
  const typography = window.LocalDNSTypography;
  const input = document.querySelector('#input-font-upload');
  const button = document.querySelector('#btn-font-upload');
  const list = document.querySelector('#font-upload-list');
  const hint = document.querySelector('#val-font-upload');
  if (!typography || !input || !button || !list || !hint) return;
  let records=[],faces=new Map(),pending=new Map(),ready=false,busy=false;
  const message = text => { hint.textContent = text; };
  function storage(mode, value) {
    return new Promise((resolve, reject) => {
      let db, transaction, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); db?.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => { try { transaction?.abort(); } catch {} finish(new Error('浏览器存储响应超时')); }, 8000);
      let request;
      try { request = indexedDB.open('localdns-appearance', 1); }
      catch (error) { finish(error); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
      };
      request.onerror = () => finish(request.error);
      request.onblocked = () => finish(new Error('请关闭其他 LocalDNS 标签页后重试'));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        let result;
        try {
          transaction = db.transaction('settings', mode);
          const store = transaction.objectStore('settings');
          const operation = mode === 'readonly' ? store.get('fonts') : store.put(value, 'fonts');
          operation.onsuccess = () => { result = operation.result; };
          transaction.oncomplete = () => finish(null, result);
          transaction.onabort = () => finish(transaction.error || new Error('字体保存已中止'));
          transaction.onerror = () => {};
        } catch (error) { finish(error); }
      };
    });
  }
  function setBusy(value) {
    busy = value; button.disabled = value; input.disabled = value;
    list.querySelectorAll('button').forEach(item => { item.disabled = value; });
  }
  function render() {
    typography.registerFonts(records.filter(record=>record.shared||faces.has(record.id)));
    list.replaceChildren(); list.hidden = !records.length;
    for (const record of records) {
      const row = document.createElement('div'); row.className = 'bcp-font-item';
      const name = document.createElement('span'); name.className = 'bcp-font-name';
      name.textContent = record.name; name.title = record.name;
      const size = document.createElement('span'); size.className = 'bcp-font-size';
      size.textContent=record.shared?`服务器 · ${(record.size/1048576).toFixed(1)} MB`:faces.has(record.id)?`${(record.size/1048576).toFixed(1)} MB`:'无法加载';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'bcp-font-del';
      remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${record.name}`);
      remove.disabled = busy; remove.addEventListener('click', () => removeFont(record.id));
      if(record.shared){row.append(name,size);}else row.append(name,size,remove);list.append(row);
    }
    message(records.length ? `${records.length} 个字体` : '未上传');
  }
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      await typography.sharedReady;
      const shared=window.LocalDNSShared.config.fonts;
      let saved;try{saved=await storage('readonly');}catch(error){if(!shared.length)throw error;message('本机字体暂时无法读取，服务器字体仍可使用。');}
      records = Array.isArray(saved) ? saved.filter(record => record && /^up[a-z0-9_-]+$/i.test(record.id) && record.data instanceof ArrayBuffer) : [];
      let failed = 0;
      for (const record of records) {
        record.name = String(record.name || '自定义字体'); record.size = record.data.byteLength;
        try {
          const face = new FontFace(`LocalDNSUploaded_${record.id}`, record.data);
          await face.load(); document.fonts.add(face); faces.set(record.id, face);
        } catch { failed++; }
      }
      records=[...shared,...records.filter(record=>!shared.some(font=>font.id===record.id))];
      ready=true;button.textContent='选择本机字体…';render();loadSelected();
      if (failed) message(`${failed} 个字体无法加载，暂用默认字体；可移除后重新上传。`);
    } catch { message('字体读取失败，请点击重新读取；原有设置未更改。'); button.textContent = '重新读取字体'; }
    finally { setBusy(false); }
  }
  async function upload(files) {
    if (!ready || busy) return;
    setBusy(true); message('正在检查并保存字体…');
    const additions = [], loaded = new Map(), failures = [];
    try {
      for (const file of files) {
        try {
          if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('仅支持 ttf、otf、woff、woff2');
          if (!file.size || file.size > 64 * 1048576) throw new Error('单个文件需大于 0 且不超过 64 MB');
          if (records.concat(additions).reduce((sum, record) => sum + record.size, 0) + file.size > 128 * 1048576) throw new Error('字体总量不能超过 128 MB');
          const id='up'+(crypto.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2)),data=await file.arrayBuffer();
          const face = new FontFace(`LocalDNSUploaded_${id}`, data); await face.load();
          additions.push({ id, name: file.name, size: file.size, data }); loaded.set(id, face);
        } catch (error) { failures.push(`${file.name}：${error.message}`); }
      }
      if (additions.length) {
        await storage('readwrite',records.filter(record=>!record.shared).concat(additions));
        for (const [id, face] of loaded) { document.fonts.add(face); faces.set(id, face); }
        records.push(...additions); render();
      }
      message(failures.length ? failures.join('；') : '字体已保存到当前浏览器；选择用途后可导出共享配置。');
    } catch { message('字体未能保存，请检查浏览器存储空间或权限后重试。原有字体保持不变。'); }
    finally { setBusy(false); }
  }
  async function removeFont(id) {
    if (busy) return;
    setBusy(true);
    try {
      const next = records.filter(record => record.id !== id);
      await storage('readwrite',next.filter(record=>!record.shared));
      typography.forgetFont(id);
      if (faces.has(id)) document.fonts.delete(faces.get(id));
      faces.delete(id); records = next; render(); message('字体已移除；受影响的字体选项已恢复默认。');
    } catch { message('移除失败，字体仍保留。请检查浏览器存储空间或权限后重试。'); }
    finally { setBusy(false); }
  }
  async function loadSelected(){
    const selected=new Set(Object.values(typography.getSelection()));
    for(const record of records.filter(record=>record.shared&&selected.has(record.id))){
      if(faces.has(record.id)||pending.has(record.id))continue;
      const task=(async()=>{
        try{const face=new FontFace(`LocalDNSUploaded_${record.id}`,`url(${JSON.stringify(window.LocalDNSShared.asset(record.path))})`);await face.load();document.fonts.add(face);faces.set(record.id,face);}
        catch{message(`服务器字体“${record.name}”无法加载，暂用默认字体；刷新可重试。`);}
        finally{pending.delete(record.id);}
      })();pending.set(record.id,task);await task;
    }
  }
  async function exportRecords(){
    if(!ready)throw new Error('字体尚未读取完成，请稍后重试');
    return Promise.all(records.map(async record=>{
      if(!record.shared)return {...record};
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
      try{const response=await fetch(window.LocalDNSShared.asset(record.path),{signal:controller.signal});if(!response.ok)throw new Error('无法读取共享字体：'+record.name);const data=await response.arrayBuffer();if(data.byteLength!==record.size)throw new Error('共享字体文件与清单大小不一致');return {...record,data};}finally{clearTimeout(timer);}
    }));
  }
  window.LocalDNSFonts={exportRecords};
  window.addEventListener('localdns-font-selection',()=>loadSelected());
  button.addEventListener('click', () => { if (ready) input.click(); else load(); });
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) upload(files); });
  load();
})();
