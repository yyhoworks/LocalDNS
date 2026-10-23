/* Direct local configuration editing. Configuration contents are never persisted in browser storage. */
import { setHTML } from '../../core/security/safe-dom.ts';
import { preferences } from '../../core/persistence/preferences.ts';
import { request } from './api';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    back:'<path d="m14 6-6 6 6 6M8 12h12"/>', folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', expand:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>', diff:'<path d="M8 4H4v16h4M16 4h4v16h-4M9 8h6M12 5v6M9 16h6"/>',
    check:'<path d="m5 12 4 4L19 6"/>', refresh:'<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/>', save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>', lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
  const brands = {mihomo:{name:'Mihomo',format:'YAML',logo:'assets/img/proxy-panel.svg'},'sing-box':{name:'sing-box',format:'JSON',logo:'assets/img/proxy-panel.svg'}};
  // 配置服务可能上报本地未知的核心 id：查表判空并回退通用品牌，避免整页渲染崩溃。
  const brandOf = id => brands[id] || {name:String(id || '未知核心'),format:'',logo:'assets/img/proxy-panel.svg'};
  let active = null;
  // 无 route scope 时无人接管 dispose：暂存于此，下一次 mount 前先执行，
  // 避免 window 监听、AbortController 与编辑器实例泄漏（见 mount 末尾）。
  let fallbackDispose = null;
  const vendor = () => import('./editor.js');
  function dialog(title, content, actions='', wide=false) {
    const origin = document.activeElement;
    const element = document.createElement('dialog'); element.className = 'pc-dialog' + (wide ? ' pc-wide' : '');
    setHTML(element, `<div class="pc-dialog-heading"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-pc-close aria-label="关闭">${icon('close')}</button></div><div class="pc-dialog-body">${content}</div>${actions ? `<div class="pc-dialog-actions">${actions}</div>` : ''}`);
    document.body.append(element);
    const close = () => element.close();
    element.querySelectorAll('[data-pc-close]').forEach(button => button.addEventListener('click',close));
    element.addEventListener('close', () => { element.remove(); if(origin?.isConnected)origin.focus({preventScroll:true}); }, {once:true});
    element.showModal(); return element;
  }
  function confirmDiscard(action) {
    if (!active?.dirty()) { action(); return; }
    const element = dialog('放弃尚未保存的修改？','<p>继续操作会关闭当前修改，设备上的配置保持原样。</p>', '<button class="button" data-pc-close>继续编辑</button><button class="button primary" id="pc-discard">放弃修改并继续</button>');
    element.querySelector('#pc-discard').onclick = () => { element.close();action(); };
  }

  /** @param {HTMLElement} parent @param {import('../../core/router/route-context').RouteContext} context */
  export async function mount(parent, context) {
    const {notify,navigate,scope}=context;
    if(fallbackDispose){const run=fallbackDispose;fallbackDispose=null;run();}
    const abort = new AbortController();
    let editor, tools, cores=[], core='mihomo', path='', revision='', base='', newline='\n', busy=false, programmatic=false, serviceReady=false, activeFile=false, groupRevision='', fragmentMode=false, groupCount=0, alive=true, mode='file', directory='', directoryCore='mihomo', directoryFiles=[], browseSequence=0, browsing=false;
    let workspace={};try{workspace=JSON.parse(preferences.getItem('localdns-proxy-config-workspace-v1')||'{}')||{};}catch{}
    if(workspace.mode==='directory')mode='directory';
    setHTML(parent, `<section class="pc-root" aria-label="代理配置编辑器">
      <div class="pc-heading"><div><button type="button" class="pc-back" id="pc-back">${icon('back')}系统管理</button><h1>代理配置</h1><p class="gc-sub">读取服务器文件或 HTTP 配置，校验后保存并应用。</p></div></div>
      <div class="pc-sourcebar"><label for="pc-core-select">配置核心</label><select id="pc-core-select"><option value="mihomo">Mihomo · YAML</option><option value="sing-box">sing-box · JSON</option></select><div class="pc-source-modes" role="group" aria-label="文件浏览方式"><button type="button" data-pc-mode="file" aria-pressed="true">单文件</button><button type="button" data-pc-mode="directory" aria-pressed="false">目录</button></div><button type="button" class="button small" id="pc-http-toggle" aria-expanded="false" aria-controls="pc-http-form">HTTP 获取</button></div>
      <form class="pc-http-form" id="pc-http-form" hidden><label for="pc-http-url">HTTP(S) 配置链接</label><div class="pc-http-fields"><input id="pc-http-url" type="url" placeholder="https://example.com/config.yaml" autocomplete="off" spellcheck="false" required aria-describedby="pc-http-note pc-http-error"/><button type="submit" class="button" id="pc-http-read">读取到编辑器</button></div><label class="pc-keep-controller"><input type="checkbox" id="pc-keep-controller" checked/>保留目标核心的控制地址和密钥</label><p id="pc-http-note">先选择目标配置文件。读取成功后进入草稿，保存时写入该文件。</p><p id="pc-http-error" class="pc-form-error" role="alert" hidden></p></form>
      <details class="pc-setup" id="pc-setup" hidden><summary>恢复配置服务</summary><p>在核心所在服务器安装配套配置服务，然后重新读取。默认端口为 9098；自定义地址可在 ui/config.js 设置 proxyConfigBase。</p><code>sh install-proxy-config.sh http://服务器IP:9099</code><a href="help/proxy-config.txt" target="_blank" rel="noopener noreferrer">查看安装说明</a></details>
      <button type="button" class="pc-mobile-files" id="pc-toggle-files" aria-expanded="false" aria-controls="pc-directory-panel" hidden><span>切换配置文件</span><span>展开列表</span></button>
      <div class="pc-workspace" data-mode="file"><aside class="pc-directory-panel" id="pc-directory-panel" aria-label="目录配置文件" hidden><form id="pc-directory-form"><label for="pc-directory-input">配置目录</label><div><input id="pc-directory-input" type="text" placeholder="/etc/mihomo" autocomplete="off" spellcheck="false" required/><button type="submit" class="button small">读取</button></div></form><div class="pc-directory-heading"><span id="pc-file-count" role="status">尚未读取目录</span><button type="button" class="button small" id="pc-directory-parent">上一级</button></div><input id="pc-file-filter" type="search" placeholder="筛选配置文件" aria-label="筛选配置文件"/><div id="pc-directory-list" class="pc-directory-list" aria-live="polite"></div><p class="pc-directory-note">备用配置仅保存文件；启动配置保存后自动应用。</p></aside>
      <section class="pc-card" id="pc-card"><div class="pc-filebar"><img id="pc-logo" src="assets/img/proxy-panel.svg" alt="" width="34" height="34"/><div class="pc-filename"><div><strong id="pc-name">选择配置文件</strong><span class="pc-format" id="pc-format">YAML</span></div><button type="button" class="pc-path" id="pc-choose"><span id="pc-path">读取服务器配置…</span>${icon('folder')}</button></div><div class="pc-editor-tools"><button type="button" class="icon-button" id="pc-search" aria-label="查找配置">${icon('search')}</button><button type="button" class="icon-button" id="pc-focus" aria-label="专注编辑" aria-pressed="false">${icon('expand')}</button><button type="button" class="button small" id="pc-diff">${icon('diff')}<span>查看改动</span></button></div></div>
      <div class="pc-actionbar"><span id="pc-document-state" role="status">尚未读取文件</span><div><button type="button" class="button small" id="pc-reread">重新读取</button><button type="button" class="button small" id="pc-check">${icon('check')}检查配置</button><button type="button" class="button primary small" id="pc-save">${icon('save')}保存并应用</button></div></div>
      <div id="pc-editor" class="pc-editor"><div class="pc-empty">${icon('folder')}<strong>正在读取服务器配置</strong><p>正在连接配置服务并读取目标文件。</p><button type="button" class="button" id="pc-retry" hidden>重新读取</button></div></div>
      <div class="pc-statusbar"><span id="pc-cursor">—</span><span id="pc-lines">—</span><span id="pc-encoding">UTF-8</span></div>
      <details class="pc-result" id="pc-result"><summary><span id="pc-result-title" role="status" aria-live="polite">正在读取服务器配置</span><span class="pc-result-hint">查看详情</span></summary><pre id="pc-result-detail"></pre></details></section></div>
      <div class="pc-footnote"><span>${icon('lock')}保存前自动备份，校验通过后应用。</span><span id="pc-active-note">保存启动配置后自动应用</span></div>
    </section>`);
    const root = parent.querySelector('.pc-root');
    const $ = selector => root.querySelector(selector);
    const dirty = () => !!editor && editor.text() !== base;
    const current = {dirty, isBusy:()=>busy, notify, confirmLeave:confirmDiscard}; active=current;
    const result = (state,title,detail='',open=false) => { if(!alive)return;$('#pc-result').dataset.state=state;$('#pc-result-title').textContent=title;$('#pc-result-detail').textContent=detail;$('#pc-result').open=open; };
    let lastSaveLabel='';
    const sync = () => {
      if(!alive)return;
      const loaded=!!revision;
      $('#pc-document-state').textContent=busy?'正在执行操作…':!loaded?'尚未读取文件':dirty()?'有未保存的修改':'已读取 · 尚未修改';
      $('#pc-document-state').dataset.dirty=String(dirty());
      for(const id of ['pc-choose','pc-check','pc-reread','pc-search','pc-focus'])$('#'+id).disabled=busy||!serviceReady||(id!=='pc-choose'&&!loaded);
      $('#pc-diff').disabled=busy||!dirty();$('#pc-save').disabled=busy||!loaded||!dirty();
      for(const id of ['pc-http-toggle','pc-http-read','pc-http-url','pc-keep-controller'])$('#'+id).disabled=busy||!serviceReady;
      // 保存按钮文案只随 activeFile 变化：文案未变时不要重建内容。
      // sync 会在每次按键后触发，无条件 setHTML 会逐字销毁重建按钮 DOM。
      const saveLabel=icon('save')+(activeFile?'保存并应用':'保存文件');
      if(saveLabel!==lastSaveLabel){lastSaveLabel=saveLabel;setHTML($('#pc-save'), saveLabel);}
      $('#pc-core-select').disabled=busy||!serviceReady;$('#pc-core-select').value=core;
      for(const button of root.querySelectorAll('[data-pc-mode],#pc-directory-form button,#pc-directory-parent'))button.disabled=busy||!serviceReady||browsing;
      $('#pc-directory-input').disabled=busy||browsing;
      for(const button of root.querySelectorAll('#pc-directory-list button'))button.disabled=busy;
      if(editor)editor.editable(!busy);
      root.setAttribute('aria-busy',String(busy));
    };
    const setBusy = value => {busy=value;sync();};
    const wireContent = () => newline === '\r\n' ? editor.text().replace(/\n/g,'\r\n') : editor.text();
    const cursor = () => {if(!editor||!alive)return;const selection=editor.view.state.selection.main,line=editor.view.state.doc.lineAt(selection.head);$('#pc-cursor').textContent=`行 ${line.number}，列 ${selection.head-line.from+1}`;$('#pc-lines').textContent=editor.view.state.doc.lines+' 行';};
    const report = error => {
      if(!alive)return;
      const detail=error.body||error;
      result('error',error.message,[detail.detail,detail.backup?'备份：'+detail.backup:''].filter(Boolean).join('\n'),true);
      if(!serviceReady)$('#pc-setup').hidden=false;
      if(!editor){const empty=$('.pc-empty');if(empty){empty.querySelector('strong').textContent='暂时无法读取配置';empty.querySelector('p').textContent=error.message;$('#pc-retry').hidden=false;}}
    };

    async function readFile(nextCore,nextPath) {
      setBusy(true);result('working','正在读取配置文件…');
      try {
        const loaded=await request('read',{method:'POST',body:{core:nextCore,path:nextPath},signal:abort.signal});
        if(!alive)return;
        core=nextCore;path=loaded.path;revision=loaded.revision;activeFile=loaded.active;groupRevision=loaded.groupRevision||'';fragmentMode=loaded.mode==='fragments';groupCount=loaded.groupCount||0;
        newline=loaded.content.includes('\r\n')?'\r\n':'\n';base=loaded.content.replace(/\r\n/g,'\n');
        if(!editor){$('#pc-editor').replaceChildren();editor=tools.makeEditor({parent:$('#pc-editor'),doc:base,type:core,onSave:()=>{if(!busy&&dirty())compare(true);},onUpdate:update=>{cursor();if(update.docChanged&&!programmatic)queueMicrotask(()=>{if(!alive)return;editor.diagnostics([]);sync();result('idle','内容已修改，等待检查','保存时会重新执行核心校验。');});}});}
        else{programmatic=true;editor.set(base,core);programmatic=false;}
        $('#pc-logo').src=brandOf(core).logo;$('#pc-logo').alt=brandOf(core).name;$('#pc-name').textContent=path.split('/').pop();$('#pc-path').textContent=path;$('#pc-path').title=path;$('#pc-format').textContent=brandOf(core).format;
        $('#pc-encoding').textContent='UTF-8 · '+(newline==='\r\n'?'CRLF':'LF');
        $('#pc-active-note').textContent=fragmentMode?`运行分片 · 与 ${groupCount} 份文件合并校验，保存后重载整套配置`:activeFile?'启动配置 · 保存后自动重载':'备用配置 · 保存后不切换当前运行配置';
        $('#pc-http-note').textContent=`保存目标：${path}${activeFile?' · 保存后应用到 '+brandOf(core).name:' · 备用文件，保存后不应用'}`;
        $('.pc-directory-note').textContent=cores.find(item=>item.id===core)?.mode==='fragments'?'运行分片会按完整集合合并校验，目录外备用文件单独保存。':'备用配置仅保存文件；启动配置保存后自动应用。';
        result('idle',fragmentMode?`已读取运行分片 · 共 ${groupCount} 份`:'已读取配置，尚未检查',activeFile?'修改后可检查配置、查看差异，再保存并应用。':'此文件独立校验并保存。当前启动配置：'+cores.find(item=>item.id===core)?.path);
        renderDirectoryFiles();
        if(matchMedia('(max-width:800px)').matches)toggleFiles(false);
        try{preferences.setItem('localdns-proxy-config-file-v1',JSON.stringify({core,path}));}catch{}
        cursor();return true;
      }catch(error){report(error);}finally{setBusy(false);}
    }
    async function check() {
      const diagnostics=fragmentMode?[]:tools.syntaxCheck(editor.text(),core);editor.diagnostics(diagnostics);
      if(diagnostics.length){result('error','语法检查未通过',diagnostics.map(item=>`第 ${item.line} 行：${item.message}`).join('\n'),true);return false;}
      const response=await request('check',{method:'POST',body:{core,path,content:wireContent(),revision,...(fragmentMode?{groupRevision}: {})},signal:abort.signal});
      result('success',fragmentMode?'整套分片合并与核心校验通过':'语法与核心校验通过',response.detail || '配置可以由当前核心加载。',true);return true;
    }
    async function importHTTP() {
      if(busy)return;
      const field=$('#pc-http-url'),error=$('#pc-http-error');
      error.hidden=true;field.removeAttribute('aria-invalid');
      if(!revision){error.textContent='请先选择并读取目标配置文件，再导入 HTTP 内容。';error.hidden=false;return;}
      let url;
      try{url=new URL(field.value.trim());if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error();}
      catch{error.textContent='请输入不含账号密码或片段的 HTTP(S) 配置链接。';error.hidden=false;field.setAttribute('aria-invalid','true');field.focus();return;}
      setBusy(true);result('working','正在获取 HTTP 配置…');
      try{
        const response=await request('fetch',{method:'POST',body:{url:url.href,core},signal:abort.signal});
        if(!alive)return;
        const draft=tools.prepareHTTPDraft(response.content,base,core,$('#pc-keep-controller').checked);
        programmatic=true;editor.set(draft.content.replace(/\r\n/g,'\n'),core);programmatic=false;
        editor.diagnostics([]);cursor();
        result('success',dirty()?'HTTP 配置已读入草稿，尚未保存':'HTTP 内容与当前文件一致',`来源：${response.sourceHost}\n保存目标：${path}\n${draft.preserved?'已保留目标核心的控制地址和密钥。\n':''}${activeFile?'保存并应用后，新连接使用新配置。':'这是备用配置，保存后不切换运行配置。'}`,true);
      }catch(failure){if(alive){error.textContent=failure.message;error.hidden=false;field.setAttribute('aria-invalid','true');report(failure);}}
      finally{programmatic=false;setBusy(false);}
    }
    async function compare(forSave=false) {
      if(busy||!dirty())return;
      if(forSave){setBusy(true);result('working','正在执行核心校验…');try{if(!await check())return;}catch(error){report(error);return;}finally{setBusy(false);}}
      const changes=tools.differences(base,editor.text());
      const element=dialog(forSave?(activeFile?'确认保存并应用':'确认保存备用配置'):'查看本次修改',`<div class="pc-compare-meta"><code>${esc(path)}</code><span>+${changes.added.length} / −${changes.removed.length} 行</span></div>${forSave&&activeFile&&core==='sing-box'?'<p class="pc-note">sing-box 将重建运行实例，现有连接可能断开。应用后新连接使用新规则。</p>':''}<div class="pc-diff-tabs" role="group" aria-label="对比版本"><button aria-pressed="true" data-pc-side="original">原配置</button><button aria-pressed="false" data-pc-side="modified">当前修改</button></div><div class="pc-diff-grid" data-side="original"><section><h3>原配置</h3><div id="pc-original"></div></section><section><h3>当前修改</h3><div id="pc-modified"></div></section></div>`, `<button class="button" data-pc-close>返回编辑</button>${forSave?`<button class="button primary" id="pc-confirm-save">${activeFile?'保存并应用':'保存文件'}</button>`:''}`,true);
      const views=[tools.makeEditor({parent:element.querySelector('#pc-original'),doc:base,type:core,readOnly:true,changedLines:changes.removed,side:'removed'}),tools.makeEditor({parent:element.querySelector('#pc-modified'),doc:editor.text(),type:core,readOnly:true,changedLines:changes.added,side:'added'})];
      element.addEventListener('close',()=>views.forEach(view=>view.destroy()),{once:true});
      element.querySelectorAll('[data-pc-side]').forEach(button=>button.onclick=()=>{element.querySelectorAll('[data-pc-side]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));element.querySelector('.pc-diff-grid').dataset.side=button.dataset.pcSide;views.forEach(view=>view.view.requestMeasure());});
      if(forSave)element.querySelector('#pc-confirm-save').onclick=async()=>{
        element.close();setBusy(true);result('working',activeFile?'正在校验、备份并重载配置…':'正在校验、备份并保存文件…','请等待结果，修改内容会保留在当前页面。',true);
        try{
          const response=await request('save',{method:'POST',body:{core,path,content:wireContent(),revision,...(fragmentMode?{groupRevision}: {})}});
          if(!alive)return;revision=response.revision;groupRevision=response.groupRevision||groupRevision;base=editor.text();
          result('success',response.unchanged?'配置未变化，无需重载':response.confirmation==='saved-only'?'备用配置已保存，当前运行配置未切换':response.confirmation==='signal-and-health'?'配置已保存，已发送重载且核心在线':'配置已保存，核心重载成功',response.backup?'原配置备份：'+response.backup:'',true);notify(response.reloaded?'配置已保存并应用':'配置文件已保存');
        }catch(error){report(error);}finally{setBusy(false);}
      };
    }
    function rememberWorkspace() {
      try{preferences.setItem('localdns-proxy-config-workspace-v1',JSON.stringify({mode,core:directoryCore,directory}));}catch{}
    }
    function renderDirectoryFiles() {
      if(!alive)return;
      const list=$('#pc-directory-list'),filter=$('#pc-file-filter').value.trim().toLowerCase();list.replaceChildren();
      const items=directoryFiles.filter(item=>item.name.toLowerCase().includes(filter));
      for(const item of items){
        const button=document.createElement('button');button.type='button';button.disabled=busy;button.className='pc-directory-item';
        setHTML(button, icon(item.directory?'folder':'file')+`<span>${esc(item.name)}</span>${item.active?`<small>${cores.find(item=>item.id===directoryCore)?.mode==='fragments'?'运行分片':'启动配置'}</small>`:''}`);
        if(!item.directory)button.setAttribute('aria-current',String(directoryCore===core&&item.path===path));
        button.title=item.path;button.onclick=()=>item.directory?browseDirectory(directoryCore,item.path):confirmDiscard(()=>readFile(directoryCore,item.path));list.append(button);
      }
      if(!items.length){const empty=document.createElement('p');empty.className='pc-directory-note';empty.textContent=filter?'没有匹配的配置文件。':'目录中没有此核心可读取的配置文件。';list.append(empty);}
    }
    async function browseDirectory(selected,nextDirectory) {
      const sequence=++browseSequence;browsing=true;sync();$('#pc-file-count').textContent='正在读取目录…';
      try {
        const response=await request('files?'+new URLSearchParams({core:selected,path:nextDirectory}),{signal:abort.signal});
        if(!alive||sequence!==browseSequence)return;
        directory=response.directory;directoryCore=selected;directoryFiles=response.files;$('#pc-directory-input').value=directory;
        const count=directoryFiles.filter(item=>!item.directory).length;
        $('#pc-file-count').textContent=`${count} 份配置`+(response.truncated?' · 仅显示前 200 项':'');
        $('#pc-directory-input').removeAttribute('aria-invalid');renderDirectoryFiles();rememberWorkspace();
      }catch(error){if(alive&&sequence===browseSequence){$('#pc-file-count').textContent='目录读取失败';$('#pc-directory-input').setAttribute('aria-invalid','true');result('error',error.message,'请检查目录地址或在选择配置文件中查看允许的目录。',true);}}
      finally{if(sequence===browseSequence){browsing=false;sync();}}
    }
    function toggleFiles(expanded) {
      root.classList.toggle('pc-files-expanded',expanded);$('#pc-toggle-files').setAttribute('aria-expanded',String(expanded));
      $('#pc-toggle-files').lastElementChild.textContent=expanded?'收起列表':'展开列表';requestAnimationFrame(()=>editor?.view.requestMeasure());
    }
    function setMode(next) {
      mode=next;$('#pc-toggle-files').hidden=mode!=='directory';$('.pc-workspace').dataset.mode=mode;$('.pc-directory-panel').hidden=mode!=='directory';
      for(const button of root.querySelectorAll('[data-pc-mode]'))button.setAttribute('aria-pressed',String(button.dataset.pcMode===mode));
      if(mode==='directory'&&serviceReady)browseDirectory(core,directory&&directoryCore===core?directory:path.slice(0,path.lastIndexOf('/'))||cores.find(item=>item.id===core)?.directory||'');
      else rememberWorkspace();
      requestAnimationFrame(()=>editor?.view.requestMeasure());
    }
    async function chooseFile() {
      if(busy)return;
      let selected=core, directory='';
      const element=dialog('选择配置文件',`<div class="pc-core-options">${cores.map(item=>`<label class="pc-core-option"><input type="radio" name="pc-core" value="${esc(item.id)}" ${item.id===core?'checked':''} ${item.available?'':'disabled'}/><img src="${brandOf(item.id).logo}" alt=""/><span>${brandOf(item.id).name}${item.available?'':' · 未安装'}</span></label>`).join('')}</div><div class="pc-directorybar"><code id="pc-directory"></code><button class="button small" type="button" id="pc-parent">上一级</button></div><div class="pc-files" id="pc-files" aria-live="polite"></div><form id="pc-file-form"><label class="field">配置文件绝对路径<input type="text" id="pc-picker-path" autocomplete="off" spellcheck="false" value="${esc(path)}" required/></label><p class="pc-note" id="pc-picker-roots"></p><p class="pc-form-error" id="pc-picker-error" role="alert" hidden></p></form>`, '<button class="button" data-pc-close>取消</button><button type="submit" form="pc-file-form" class="button primary">读取配置</button>');
      const field=element.querySelector('#pc-picker-path'),error=element.querySelector('#pc-picker-error');
      const showError=text=>{error.textContent=text;error.hidden=false;};
      async function browse(nextDirectory) {
        directory=nextDirectory;error.hidden=true;element.querySelector('#pc-directory').textContent=directory;
        element.querySelector('#pc-picker-roots').textContent='配置目录：'+cores.find(item=>item.id===selected).roots.join('、');
        const list=element.querySelector('#pc-files');list.textContent='正在读取目录…';
        try{const response=await request('files?'+new URLSearchParams({core:selected,path:directory}),{signal:abort.signal});if(!element.isConnected)return;directory=response.directory;element.querySelector('#pc-directory').textContent=directory;list.replaceChildren();
          for(const file of response.files){const button=document.createElement('button');button.type='button';setHTML(button, icon(file.directory?'folder':'file')+`<span>${esc(file.name)}</span><small>${file.directory?'目录':Math.max(1,Math.ceil(file.bytes/1024))+' KB'}</small>`);button.onclick=()=>{if(file.directory)browse(file.path);else{field.value=file.path;error.hidden=true;}};list.append(button);}
          if(!response.files.length)list.textContent='目录中没有可选的配置文件，也可以填写完整路径。';
        }catch(failure){list.textContent='目录暂时无法读取。';showError(failure.message);}
      }
      element.querySelectorAll('[name="pc-core"]').forEach(input=>input.onchange=()=>{selected=input.value;field.value=cores.find(item=>item.id===selected).path;browse(field.value.slice(0,field.value.lastIndexOf('/')));});
      element.querySelector('#pc-parent').onclick=()=>browse(directory.slice(0,directory.lastIndexOf('/'))||'/');
      element.querySelector('#pc-file-form').onsubmit=event=>{event.preventDefault();const value=field.value.trim();if(!value.startsWith('/')||value.endsWith('/')||value.split('/').includes('..')){showError('请填写配置文件的绝对路径。');return;}element.close();confirmDiscard(()=>readFile(selected,value));};
      browse((path||cores.find(item=>item.id===selected)?.path||'/etc/mihomo/config.yaml').slice(0,(path||cores.find(item=>item.id===selected)?.path||'/etc/mihomo/config.yaml').lastIndexOf('/')));
    }
    async function loadCores(loadDefault) {
      try{const response=await request('cores',{signal:abort.signal});if(!alive)return;if(!Array.isArray(response.cores))throw new Error('配置服务返回格式无效，请检查服务版本。');cores=response.cores;serviceReady=true;$('#pc-setup').hidden=true;
        setHTML($('#pc-core-select'), cores.map(item=>`<option value="${esc(item.id)}" ${item.available?'':'disabled'}>${brandOf(item.id).name} · ${brandOf(item.id).format}${item.mode==='fragments'?' 分片':''}${item.available?'':' · 未安装'}</option>`).join(''));
        if(loadDefault){let preferred;try{preferred=JSON.parse(preferences.getItem('localdns-proxy-config-file-v1')||'null');}catch{}
          const chosen=cores.find(item=>item.id===preferred?.core&&item.available&&item.exists)||cores.find(item=>item.available&&item.exists);
          if(chosen){await readFile(chosen.id,preferred?.core===chosen.id&&preferred?.path?preferred.path:chosen.path);if(workspace.core===chosen.id&&typeof workspace.directory==='string'){directory=workspace.directory;directoryCore=chosen.id;}setMode(chosen.mode==='fragments'?'directory':mode);}
          else{const empty=$('.pc-empty');if(empty){empty.querySelector('strong').textContent='未找到核心配置';empty.querySelector('p').textContent='请在配置服务中设置核心程序、启动文件和允许目录。';$('#pc-retry').hidden=false;}result('error','未找到可读取的核心配置','请安装对应核心，并在配置管理服务中设置核心程序、启动配置与配置目录。',true);}
        }
      }catch(error){report(error);}finally{sync();}
    }
    for(const button of root.querySelectorAll('[data-pc-mode]'))button.onclick=()=>setMode(button.dataset.pcMode);
    $('#pc-toggle-files').onclick=()=>toggleFiles(!root.classList.contains('pc-files-expanded'));
    $('#pc-file-filter').oninput=renderDirectoryFiles;
    $('#pc-directory-form').onsubmit=event=>{event.preventDefault();browseDirectory(core,$('#pc-directory-input').value.trim());};
    $('#pc-directory-parent').onclick=()=>browseDirectory(directoryCore,directory.slice(0,directory.lastIndexOf('/'))||'/');
    $('#pc-core-select').onchange=event=>{const selected=event.target.value;event.target.value=core;confirmDiscard(async()=>{const chosen=cores.find(item=>item.id===selected);if(!chosen)return;if(await readFile(selected,chosen.path)){directory='';setMode(chosen.mode==='fragments'?'directory':mode);}});};
    $('#pc-http-toggle').onclick=()=>{const form=$('#pc-http-form');form.hidden=!form.hidden;$('#pc-http-toggle').setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)$('#pc-http-url').focus();};
    $('#pc-http-form').onsubmit=event=>{event.preventDefault();confirmDiscard(importHTTP);};
    $('#pc-http-url').oninput=()=>{$('#pc-http-error').hidden=true;$('#pc-http-url').removeAttribute('aria-invalid');};
    root.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.classList.contains('pc-focused')&&!document.querySelector('.pc-dialog[open]')){event.preventDefault();$('#pc-focus').click();}});
    $('#pc-back').onclick=()=>navigate('management');
    $('#pc-retry').onclick=async()=>{try{tools=tools||await vendor();await loadCores(true);}catch(error){report(error);}};
    $('#pc-choose').onclick=chooseFile;
    $('#pc-reread').onclick=()=>confirmDiscard(()=>readFile(core,path));
    $('#pc-check').onclick=async()=>{setBusy(true);result('working','正在执行核心校验…');try{await check();}catch(error){report(error);}finally{setBusy(false);}};
    $('#pc-save').onclick=()=>compare(true);$('#pc-diff').onclick=()=>compare();$('#pc-search').onclick=()=>editor?.search();
    $('#pc-focus').onclick=()=>{const focus=!root.classList.contains('pc-focused');root.classList.toggle('pc-focused',focus);$('#pc-focus').setAttribute('aria-pressed',String(focus));$('#pc-focus').setAttribute('aria-label',focus?'退出专注编辑':'专注编辑');editor?.view.requestMeasure();};
    const beforeUnload=event=>{if(dirty()||busy){event.preventDefault();event.returnValue='';}};
    const resize=()=>editor?.view.requestMeasure();
    window.addEventListener('beforeunload',beforeUnload);window.addEventListener('localdns:layoutchange',resize);window.addEventListener('resize',resize);
    const dispose=()=>{alive=false;abort.abort();editor?.destroy();root.classList.remove('pc-focused');window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('localdns:layoutchange',resize);window.removeEventListener('resize',resize);document.querySelectorAll('.pc-dialog').forEach(element=>element.close());if(active===current)active=null;if(fallbackDispose===dispose)fallbackDispose=null;};
    scope?.add(dispose);
    sync();
    try{tools=await vendor();if(alive)await loadCores(true);}
    catch(error){if(alive)report(error);}
    // 无 scope 时把 dispose 暂存模块级：下一次 mount 会先执行它完成清理，
    // 而不是像原先那样把 dispose 返回给不消费它的调用方后直接泄漏。
    if(!scope){fallbackDispose=dispose;return dispose;}
  }
export function requestLeave() {
  if(active?.isBusy()){active.notify('配置操作尚未完成，请等待结果。','info');return false;}
  if(!active?.dirty())return true;
  return new Promise(resolve=>{
    let discarded=false;
    const element=dialog('放弃尚未保存的修改？','<p>离开后，当前未保存的修改将丢失。</p>','<button class="button" data-pc-close>继续编辑</button><button class="button danger" id="pc-discard">放弃修改并离开</button>');
    element.querySelector('#pc-discard').onclick=()=>{discarded=true;element.close();};
    element.addEventListener('close',()=>resolve(discarded),{once:true});
  });
}
