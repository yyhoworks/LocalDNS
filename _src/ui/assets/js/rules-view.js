/* Adapted from clone-fan, PR #3 (6a759735). Shared by both LocalDNS skins. */
/* ===========================================================
   名单管理 · 列表视图增强（rules-view.js）
   前提：不改后端、不改原保存逻辑。原来的 <textarea id="rule-text">
   仍是唯一数据源，本文件只是它的可视化外壳：
     · 列表 = 解析文本行（domain:/full:/keyword:/regexp:，# 开头为停用）
     · 编辑/新增/删除/拖拽/搜索/批量 → 回写 textarea
     · 保存/下载仍走原按钮与接口
   未编辑过的行原样保留，保证「打开不改 = 一个字节都不动」。
   =========================================================== */
(function () {
  'use strict';
  var PREFIX = { domain: 'domain:', full: 'full:', keyword: 'keyword:', regexp: 'regexp:' };
  var NAME = { domain: '域名', full: '完整域名', keyword: '关键字', regexp: '正则', raw: '原文', comment: '注释' };
  var HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  var REGEX_CHAR_RE = /[\\^$[\](){}|?+]/;
  var PREFIX_RE = /^\s*(domain|full|keyword|regexp)\s*[:：]\s*/i;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var ICON = {
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 4h14v9l-4 4H5z"/><path d="M9 9h7M9 13h4"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    ungroup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M7 4v9h7M14 4v9H7M4 17h16M12 17v3"/></svg>',
    group: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 6h6M4 12h6M4 18h6M13 12h7"/><path d="M13 12V6h7"/></svg>',
    del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>'
  };

  var root = null, ta = null, saveBtn = null, rows = [], sel = [], q = '', view = 'list';
  var editing = null, isNew = false, dirty = false, seq = 0, armedEnter = false;
  var hist = [], histAt = -1, histLock = false, savedText = '';      /* 撤销/重做：保存每一步的原文 */
  var dragIds = [];                                                   /* 拖动中的行（标题=整组） */
  var sheetBaseline = '', sheetOff = false, pendingLeave = null, focusTimer = null, mainWasInert = false, ownsInert = false;
  var rawTags = {client_ip:true,direct_ip:true,rewrite:true};
  var rawMode = false;                                /* 原件行（例如 IP/网段）保存时不加类型前缀 */
  var sheetEl = null, scrimEl = null;                 /* 面板/遮罩只认自己建的那一份 */
  var sheetBack = null;                               /* 关闭面板后把焦点还给原来的地方 */
  var lastTrigger = null;                             /* 是谁把面板叫出来的（菜单项会先被藏起来） */
  var menuBtn = null, menuPop = null;                 /* 「+ 新增」下拉：面板重建时换引用 */
  var groupSelBase = '';                              /* 打开规则面板时它所在的分组（用来判断有没有改动） */
  var groupRole = 'title';                            /* 标题/说明/备注面板里选的角色 */
  var groupMode = false, editingGroup = null, groupBase = null;  /* 标题（分组）编辑模式 */
  var counts = {}, countsAt = 0, countsBusy = false, lastTag = null;  /* 名单条数缓存 */

  function say(msg, type, detail) {
    try {
      if (typeof toast === 'function') { toast(msg, type, detail); return; }
    } catch (e) { }
    var box = document.getElementById('toast-stack');
    if (!box) return;
    var previous=box.querySelector('[data-rv-notice]');if(previous)previous.remove();
    var el = document.createElement('div');
    el.dataset.rvNotice='';
    el.className = 'toast';
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* ---------- 文本 <-> 行模型 ---------- */
  function parse(text) {
    return String(text || '').split('\n').map(function (raw, i) {
      var s = raw.trim(), off = false, m;
      if (/^#/.test(s)) { off = true; s = s.replace(/^#\s*/, ''); }
      var rawOff = off && s.match(/^停用原文[:：]\s*(.*)$/);
      if (rawOff) return {id:'r'+(++seq),kind:'raw',type:'raw',value:rawOff[1],off:true,line:raw};
      m = s.match(/^(domain|full|keyword|regexp)\s*:\s*/i);
      if (m) return { id: 'r' + (++seq), kind: 'rule', type: m[1].toLowerCase(), value: s.slice(m[0].length), off: off, line: raw };
      /* 单独一个 # 当成「分组分隔线」：它和空行一样断开分组，
         但保存时不会像空行那样被前端丢掉（保存只留非空行），所以能长期生效 */
      if (off && !s) return { id: 'r' + (++seq), kind: 'sep', type: 'sep', value: '', off: true, line: raw };
      if (!s) return { id: 'r' + (++seq), kind: 'blank', type: 'blank', value: '', off: false, line: raw };
      if (off) return { id: 'r' + (++seq), kind: 'comment', type: 'comment', value: s, off: true, line: raw };
      return { id: 'r' + (++seq), kind: 'raw', type: 'raw', value: s, off: false, line: raw };
    });
  }
  function lineOf(r) {
    if (!r.touched) return r.line;
    if (r.kind === 'blank') return '';
    if (r.kind === 'sep') return '#';
    if (r.kind === 'comment') return '# ' + r.value;
    if (r.kind === 'raw') return (r.off ? '# 停用原文：' : '') + r.value;
    return (r.off ? '# ' : '') + (PREFIX[r.type] || 'domain:') + r.value;
  }
  /* 站点（console.js）用 textarea.dataset.original 当「上次保存值」来判断脏状态，
     并会把 textarea.value 存进 sessionStorage 草稿。我们改 value 时不会触发 input
     事件，站点察觉不到，于是：
       · dataset.original 停在旧值 → 切名单时把整份被改过的文本当脏草稿存下来
       · 草稿回填（if(drafts.has(tag)) text.value = drafts.get(tag)）会盖掉渲染好的列表
       · beforeunload 因 drafts.size 非空拦住用户关页面
     所以每次写回后主动同步一次：把基准值对齐到「已保存的内容」，再让站点按真实差异
     重算草稿。基准必须取 savedText（上次落库的内容）而不是当前 value，否则等于告诉
     站点「没有改动」，未保存的编辑会被静默丢掉。
     站点若没提供对应接口则安静跳过，不影响本站独立运行。 */
  function syncSiteState() {
    if (!ta) return;
    try {
      var api = window.LocalDNSInterface;
      if (ta.dataset && ta.dataset.original !== undefined) ta.dataset.original = savedText;
      if (api && typeof api.rememberDraft === 'function') api.rememberDraft();
    } catch (e) { }
  }
  function writeBack() {
    if (!ta) return;
    ta.value = rows.map(lineOf).join('\n');
    var lines = ta.value.split('\n').filter(function (x) { return x.trim(); }).length;
    var counter = document.getElementById('rule-lines');
    if (counter) counter.textContent = '共 ' + lines + ' 行';
    dirty = ta.value !== savedText;
    if (saveBtn) saveBtn.classList.toggle('rv-has-dirty', dirty);
    commitHist(ta.value);
    syncSiteState();
    renderStat();
  }
  /* ---------- 撤销 / 重做 ---------- */
  function paintHist() {
    if (!root) return;
    var u = root.querySelector('#rv-undo'), r = root.querySelector('#rv-redo');
    if (u) u.disabled = histAt <= 0;
    if (r) r.disabled = histAt >= hist.length - 1;
  }
  function commitHist(text) {
    if (histLock) return;
    if (histAt >= 0 && hist[histAt] === text) { paintHist(); return; }
    hist = hist.slice(0, histAt + 1);
    hist.push(text);
    if (hist.length > 60) hist.shift();
    histAt = hist.length - 1;
    paintHist();
  }
  function applyHist() {
    if (!ta) return;
    histLock = true;
    ta.value = hist[histAt] || '';
    rows = parse(ta.value); sel = []; q = '';
    var qBox = root && root.querySelector('#rv-q'); if (qBox) qBox.value = '';
    paintSearch();
    dirty = ta.value !== savedText;
    if (saveBtn) saveBtn.classList.toggle('rv-has-dirty', dirty);
    renderList(); renderStat();
    histLock = false;
    syncSiteState();
    var counter=document.getElementById("rule-lines");if(counter)counter.textContent="共 "+ta.value.split("\n").filter(Boolean).length+" 行";
    paintHist();
  }
  function undo() {
    if (histAt <= 0) { say('没有更早的状态了'); return; }
    histAt--; applyHist(); say('已撤销（' + (histAt + 1) + '/' + hist.length + '）');
  }
  function redo() {
    if (histAt >= hist.length - 1) { say('没有更新的状态了'); return; }
    histAt++; applyHist(); say('已重做（' + (histAt + 1) + '/' + hist.length + '）');
  }
  /* 当前正在看的名单 tag（胶囊上的 data-rule-tag 由站点自己维护） */
  function activeTag() {
    var b = document.querySelector('.rule-menu button.active');
    return b && b.dataset.ruleTag;
  }
  function setDirty(v) {
    dirty = !!v;
    if (saveBtn) saveBtn.classList.toggle('rv-has-dirty', dirty);
    renderStat();
  }
  /* 钩住站点的「保存成功」回调：只有它被调用才认为内容已落库 */
  function hookSaved() {
    var api = window.LocalDNSInterface;
    if (!api || typeof api.ruleSaved !== 'function' || api.__rvHooked) return;
    var orig = api.ruleSaved;
    api.ruleSaved = function (tag, value) {
      try {
        if (!root || !root.isConnected || activeTag() !== tag) return orig.apply(this, arguments);
        savedText = typeof value === 'string' ? value : (ta ? ta.value : savedText);
        setDirty(!!ta && ta.value !== savedText);
      } catch (e) { }
      return orig.apply(this, arguments);
    };
    api.__rvHooked = true;
  }

  /* ---------- 列表渲染 ---------- */
  function visibleRows() {
    var kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(function (r) {
      if (r.kind === 'blank' || r.kind === 'sep') return false;
      return (r.value || '').toLowerCase().indexOf(kw) >= 0 || NAME[r.type].indexOf(kw) >= 0;
    });
  }
  /* 能勾选的行（规则/原件行）；「全选」只作用于当前筛选结果 */
  function selectableRows() {
    return visibleRows().filter(function (r) { return r.kind === 'rule' || r.kind === 'raw'; });
  }
  function allSelected() {
    var v = selectableRows();
    return v.length > 0 && v.every(function (r) { return sel.indexOf(r.id) >= 0; });
  }
  function paintSearch() {
    var box = root && root.querySelector('#rv-q'), x = root && root.querySelector('#rv-qx');
    if (x) x.hidden = !(box && box.value);
  }
  function paintSelect() {
    var b = root && root.querySelector('#rv-all');
    if (!b) return;
    var label = allSelected() ? '取消全选' : '全选';
    if (b.textContent !== label) b.textContent = label;
    b.disabled = selectableRows().length === 0;
  }
  /* ---------- 分组：# 行的三种身份 ----------
     名单里的 # 行既可能是分组标题、是标题下的说明，也可能是某条规则的备注。
     判定只用「位置 + 显式前缀」两条，规则简单、可预测、可逆转：
       1) 标题    「# 标题：xxx」显式；或一个 # 块的第一行（上一行不是 # 行）
                  —— "# 腾讯CDN (smtcdns.com - 48-char hex)" 就是这种
       2) 组注释  标题块里其余的 # 行（"# 注意: 已将长度修正为精确的 {59}"）
       3) 规则备注「# 备注：xxx」显式，挂在它下面第一条规则上，编辑面板「备注」读写它；
                  紧跟规则之后的「# 注意/提示/匹配…」也按下一条规则的备注处理
       4) 名单说明「# 说明：xxx」显式，或者整句话（含，。；、这类句读）的 # 行：
                  它谁都不领养 —— 下面的规则就是没有标题的规则，照常一行一条
     结果写在 r.role（title / gnote / note / doc）上，列表按 role 渲染，
     标题、说明、备注还能在列表里一键互转，认错了也不用去改原文。 */
  var groups = [], lineGroup = {}, childGroup = {};
  var TITLE_RE = /^#\s*(?:标题|title)\s*[:：]\s*(.*)$/i;      /* 强制当标题 */
  var NOTE_RE_ANY = /^#\s*(?:备注|note)\s*[:：]\s*(.*)$/i;    /* 强制当规则备注 */
  var ANNO_KEY = /^(?:注意|注释|提示|匹配|仅处理|仅|另外|补充|来源)/;   /* 一眼像注释的 # 行 */
  var DOC_COLON = /^说明\s*[:：]/;                                     /* 「# 说明：…」= 名单说明 */
  var DOC_PUNCT = /[，。；、]/;                                        /* 整句话的 # 行也按名单说明，不当标题 */
  function isAnno(r) { return ANNO_KEY.test(commentLine(r).replace(/^#\s*/, '').trim()); }
  function commentLine(r) {                                     /* 这一行现在长什么样（编辑过的以现值算） */
    return String(r.touched ? lineOf(r) : (r.line != null ? r.line : '# ' + r.value));
  }
  /* cur 是当前标题组：贴着一个还没挂规则的标题写的说明算「这组的注释」，
     否则「注意: …」这类行算它下面那条规则的备注 */
  function commentRole(r, cur) {
    var t = commentLine(r);
    if (NOTE_RE_ANY.test(t)) return 'note';                     /* 显式备注，位置无关 */
    if (TITLE_RE.test(t)) return 'title';                       /* 显式标题，位置无关 */
    var body = t.replace(/^#\s*/, '').trim();
    if (isAnno(r)) return cur && !cur.children.length ? 'gnote' : 'note';
    if (DOC_COLON.test(body) || DOC_PUNCT.test(body)) return 'doc';   /* 名单说明：不领养下面的规则 */
    return 'title';                                             /* 其余裸 # 行一律是标题 */
  }
  function buildGroups() {
    groups = []; lineGroup = {}; childGroup = {};
    var cur = null;
    rows.forEach(function (r) {
      if (r.kind === 'comment') {
        var role = commentRole(r, cur);
        r.role = role;
        if (role === 'gnote' && cur) {                          /* 标题下的注释：并进标题卡 */
          cur.notes.push(r); cur.lines.push(r); lineGroup[r.id] = cur.id;
          return;
        }
        if (role === 'note') {                                  /* 规则备注：自己占一行，不进标题卡 */
          if (cur) childGroup[r.id] = cur.id;
          return;
        }
        if (role === 'doc') return;                             /* 名单说明：自己占一行，不领养也不打断分组 */
        cur = { id: r.id, title: r, notes: [], lines: [r], children: [] };
        groups.push(cur); lineGroup[r.id] = cur.id;
        return;
      }
      if (r.kind === 'blank' || r.kind === 'sep') { cur = null; return; }   /* 空行 / # 分隔线都断开分组 */
      if (cur) { cur.children.push(r.id); childGroup[r.id] = cur.id; }
      else cur = null;
    });
  }
  function stripTitlePrefix(t) { return String(t || '').replace(/^\s*(?:标题|title)\s*[:：]\s*/i, '').trim(); }
  function stripNotePrefix(t) { return String(t || '').replace(/^\s*(?:备注|note)\s*[:：]\s*/i, '').trim(); }
  /* 名单说明行：当成「只有一个标题行、没有注释、没有规则」的组来编辑，登录的仍是它自己那一行 */
  function openCommentSheet(row) {
    openGroupSheet({ id: row.id, title: row, notes: [], lines: [row], children: [], docOnly: true });
  }
  function groupById(id) {
    for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i];
    return null;
  }
  function groupOf(id) { return groupById(childGroup[id]); }
  function groupTitle(g) { return String((g && g.title && g.title.value) || '').trim(); }
  function renderStat() {
    var box = document.getElementById('rv-stat');       /* 统计挪到列表下方的页脚里，不在工具条里挤 */
    if (!box) return;
    buildGroups();
    var rules = rows.filter(function (r) { return r.kind === 'rule' || r.kind === 'raw'; });
    var off = rules.filter(function (r) { return r.off; }).length;
    var g = groups.filter(function (x) { return x.children.length; }).length;
    var statHTML = '共 <b>' + rules.length + '</b> 条 · 停用 <b>' + off + '</b>' +
      (g ? ' · 分组 <b>' + g + '</b>' : '') +
      (dirty ? ' · <span style="color:var(--amber)">有未保存修改</span>' : '');
    if (box.innerHTML !== statHTML) box.innerHTML = statHTML;
    var bar = root.querySelector('.rv-selbar');
    if (bar) {
      bar.hidden = !sel.length;
      var m = bar.querySelector('.n b'); if (m && m.textContent !== String(sel.length)) m.textContent = sel.length;
    }
    paintSelect();
  }
  /* 标题行：左边 # 标记，标题 + 注释，右边是这一组的规则条数与操作 */
  function groupRowHTML(g) {
    var notes = g.notes.map(function (n) { return esc(String(n.value || '').trim()); }).filter(Boolean);
    return '<div class="rv-row grp" data-id="' + g.id + '">' +
      '<span class="rv-mark" title="这条 # 行是分组标题">#</span>' +
      '<span class="rv-grp-main"><span class="rv-grp-title">' + esc(stripTitlePrefix(groupTitle(g))) + '</span>' +
        (notes.length ? '<span class="rv-grp-notes">' + notes.join('<br>') + '</span>' : '') +
        (g.children.length ? '' : '<span class="rv-grp-empty">还没有规则 · 用规则行上的「分组」按钮放进来</span>') + '</span>' +
      '<span class="rv-grp-count">' + (g.children.length ? g.children.length + ' 条' : '空标题') + '</span>' +
      '<span class="rv-ops"><button class="rv-ib" data-act="edit" title="编辑标题与注释">' + ICON.edit + '</button>' +
      (g.children.length ? '<button class="rv-ib" data-act="tonote" title="改成下面第一条规则的备注">' + ICON.note + '</button>' : '') +
      '<button class="rv-ib del" data-act="del" title="删除这个标题块">' + ICON.del + '</button></span></div>';
  }
  function ruleRowHTML(r) {
    var on = sel.indexOf(r.id) >= 0;
    var cmt = r.kind === 'comment';
    return '<div class="rv-row' + (r.off && r.kind !== 'comment' ? ' off' : '') + (r.kind === 'comment' ? ' cmt' : '') +
      (childGroup[r.id] ? ' child' : '') + (on ? ' sel' : '') + '" data-id="' + r.id + '">' +
      '<span class="rv-handle" title="拖动排序"><svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="4" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></svg></span>' +
      /* 注释行/说明行不参与批量选择与启停，就不给它复选框，免得勾了却数不进「已选 N 条」 */
      (cmt ? '<span class="rv-ck-na" title="# 行不参与批量操作">—</span>'
           : '<label class="rv-select" title="选择这条"><input type="checkbox" class="rv-ck"' + (on ? ' checked' : '') + ' aria-label="选择这条"></label>') +
      '<span class="rv-type t-' + r.type + (cmt && r.role === 'note' ? ' role-note' : '') + '">' +
        (cmt ? (r.role === 'note' ? '备注' : (r.role === 'doc' ? '说明' : '注释')) : NAME[r.type]) + '</span>' +
      '<span class="rv-value' + (r.type === 'regexp' || (r.value || '').length > 56 ? ' wrap' : '') + '" title="' + esc(lineOf(r)) + '">' + esc(r.value) + '</span>' +
      (cmt
        ? '<span class="rv-na" title="# 行不会启用或停用">—</span>'
        : '<label class="switch"><input type="checkbox" class="rv-sw"' + (r.off ? '' : ' checked') + ' aria-label="启用这条"><span class="switch-track"><span class="switch-thumb"></span></span></label>') +
      '<span class="rv-ops"><button class="rv-ib" data-act="edit" title="编辑">' + ICON.edit + '</button>' +
      (!cmt ? '<button class="rv-ib' + (childGroup[r.id] ? ' on' : '') + '" data-act="group" title="放进分组 / 移出分组">' + ICON.group + '</button>' : '') +
      (cmt ? '<button class="rv-ib" data-act="role" title="这一行是标题 / 说明 / 备注">' + ICON.note + '</button>' : '') +
      '<button class="rv-ib del" data-act="del" title="删除">' + ICON.del + '</button></span></div>';
  }
  function renderList() {
    var box = root.querySelector('.rv-list');
    buildGroups();
    var kw = q.trim().toLowerCase();
    var hits = function (r) {
      return String(r.value || '').toLowerCase().indexOf(kw) >= 0 || String(NAME[r.type] || '').toLowerCase().indexOf(kw) >= 0;
    };
    var show = {};
    if (!kw) {
      rows.forEach(function (r) { show[r.id] = true; });
    } else {
      groups.forEach(function (g) {                        /* 命中标题/注释：整组显示 */
        if (!hits(g.title) && !g.notes.some(hits)) return;
        show[g.id] = true;
        g.notes.forEach(function (n) { show[n.id] = true; });
        g.children.forEach(function (id) { show[id] = true; });
      });
      rows.forEach(function (r) {                           /* 命中规则：把所在标题一起带出来 */
        if (r.kind === 'blank' || r.kind === 'sep' || !hits(r)) return;
        show[r.id] = true;
        var g = groupOf(r.id) || groupById(lineGroup[r.id]);
        if (g) { show[g.id] = true; g.notes.forEach(function (n) { show[n.id] = true; }); }
      });
    }
    var anyReal = rows.some(function (r) { return show[r.id] && r.kind !== 'blank'; });
    if (!anyReal) {
      var hasRows = rows.some(function (r) { return r.kind !== 'blank'; });
      box.innerHTML = '<div class="rv-empty"><b>' + (hasRows ? '没有匹配的规则' : '这个名单还是空的') + '</b>' +
        (hasRows ? '换个关键词试试' : '点右上角「新增规则」加一条') + '</div>';
    } else {
      var out = [];
      rows.forEach(function (r) {
        if (!show[r.id]) return;
        if (r.kind === 'blank' || r.kind === 'sep') {
          out.push('<div class="rv-row ' + (r.kind === 'sep' ? 'sep' : 'blank') + '" data-id="' + r.id + '"' +
            (r.kind === 'sep' ? ' title="分组分隔线：它上面的规则不归下一个标题"' : '') + '></div>');
          return;
        }
        var g = groupById(r.id);
        if (g) { out.push(groupRowHTML(g)); return; }
        if (lineGroup[r.id]) return;                        /* 标题块里的注释行已并入标题卡 */
        out.push(ruleRowHTML(r));
      });
      box.innerHTML = out.join('');
    }
    Array.prototype.forEach.call(box.querySelectorAll('.rv-row:not(.blank):not(.sep)'), function (el) {
      var grp = groupById(el.dataset.id);
      if (grp) {                                   /* 标题行：点开就是编辑标题与注释 */
        el.onclick = function () { lastTrigger = el.querySelector('[data-act=edit]'); openGroupSheet(grp); };
        el.querySelector('[data-act=edit]').onclick = function (e) { e.stopPropagation(); lastTrigger = this; openGroupSheet(grp); };
        el.querySelector('[data-act=del]').onclick = function (e) { e.stopPropagation(); dropGroup(grp); };
        var tn = el.querySelector('[data-act=tonote]');
        if (tn) tn.onclick = function (e) { e.stopPropagation(); groupToNote(grp); };
        /* 拖动标题 = 标题 + 注释 + 组里的规则一起搬，避免又把结构拖散 */
        bindDrag(el, grp.lines.map(function (l) { return l.id; }).concat(grp.children), grp.lines[0], grp);
        return;
      }
      var row = byId(el.dataset.id);
      if (!row) return;
      var ck = el.querySelector('.rv-ck');
      var sw = el.querySelector('.rv-sw');
      var host = el.querySelector('.rv-value');
      if (ck) ck.onchange = function () {
        if (ck.checked) { if (sel.indexOf(row.id) < 0) sel.push(row.id); } else sel = sel.filter(function (x) { return x !== row.id; });
        el.classList.toggle('sel', ck.checked); renderStat();
      };
      if (sw) sw.onchange = function () {
        row.off = !sw.checked; row.touched = true;
        el.classList.toggle('off', row.off);
        writeBack();
        say(row.off ? '已停用 ' + row.value : '已启用 ' + row.value);
      };
      el.querySelector('[data-act=del]').onclick = function (e) { e.stopPropagation(); dropRow(row); };
      var gb = el.querySelector('[data-act=group]');
      if (gb) gb.onclick = function (e) { e.stopPropagation(); openGroupPicker(this, row); };
      var rb = el.querySelector('[data-act=role]');
      if (rb) rb.onclick = function (e) { e.stopPropagation(); openRolePicker(this, row); };
      if (!host) return;
      /* 「# 备注：…」这类说明行，点开的是它下面那条规则的编辑面板 */
      var target = row;
      if (row.kind === 'comment') {
        for (var k = rows.indexOf(row) + 1; k < rows.length; k++) {
          if (rows[k].kind === 'rule' || rows[k].kind === 'raw') { target = rows[k]; break; }
        }
      }
      var openRow = function () {
        lastTrigger = el.querySelector('[data-act=edit]');
        /* 名单说明行谁都不属于，点开改的是它自己那段文字 */
        if (row.kind === 'comment' && row.role === 'doc') openCommentSheet(row);
        else openSheet(target, false);
      };
      host.setAttribute('role','button');host.tabIndex=0;host.setAttribute('aria-label','编辑 '+row.value);
      host.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openRow();}};
      host.onclick = openRow;
      host.ondblclick = function(e){e.preventDefault();};
      el.querySelector('[data-act=edit]').onclick = function (e) { e.stopPropagation(); openRow(); };
      bindDrag(el, [row.id], row, null);
    });
    renderStat();
  }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }
  /* 保存标题块：原地改写那几行 #（标题 + 注释），多退少补 */
  function commitGroup() {
    var title = sheet().querySelector('#rv-grp-title').value.trim();
    /* 注释行要带个「注释：」前缀，重新解析时才认得出它是这组的注释而不是新标题 */
    var notes = sheet().querySelector('#rv-grp-notes').value.split('\n')
      .map(function (x) { return x.trim(); }).filter(Boolean)
      .map(function (x) {
        return (ANNO_KEY.test(x) || TITLE_RE.test('# ' + x) || NOTE_RE_ANY.test('# ' + x)) ? x : '注释：' + x;
      });
    if (!title) { say('标题不能为空'); sheet().querySelector('#rv-grp-title').focus(); return; }
    if (groupRole !== 'title') notes = [];                    /* 不是标题就没有「这组的注释」 */
    /* 角色写进文本：标题按需加「标题：」（句子式的文字不加前缀会被判成说明） */
    var head = groupRole === 'title' ? (needsTitlePrefix(title) ? '标题：' : '')
      : (groupRole === 'doc' ? '说明：' : '备注：');
    var want = [head + title].concat(notes), i;
    if (editingGroup) {
      var old = editingGroup.lines, at = rows.indexOf(old[0]);
      if (at < 0) { closeSheet(true); return; }
      var keep = rows.slice(0, at).concat(rows.slice(at + old.length));
      var rebuilt = want.map(function (t, k) {
        if (k < old.length) {
          old[k].value = t; old[k].touched = true; old[k].kind = 'comment'; old[k].type = 'comment'; old[k].off = true;
          return old[k];
        }
        return { id: 'r' + (++seq), kind: 'comment', type: 'comment', value: t, off: true, touched: true };
      });
      rows = keep.slice(0, at).concat(rebuilt, keep.slice(at));
      /* 从「说明/备注」改成「标题」时先空着，别顺手把下面的规则吞进来 */
      if (groupRole === 'title' && !(editingGroup.title && editingGroup.title.role === 'title')) keepTitleEmpty(rebuilt[0]);
      writeBack(); closeSheet(true); renderList();
      say('已更新标题：' + title);
      return;
    }
    var made = want.map(function (t) { return { id: 'r' + (++seq), kind: 'comment', type: 'comment', value: t, off: true, touched: true }; });
    var lastRule = null;
    rows.forEach(function (r) { if (r.kind === 'rule' || r.kind === 'raw') lastRule = r; });
    var atNew = lastRule ? rows.indexOf(lastRule) + 1 : rows.length;
    rows = rows.slice(0, atNew).concat(made, rows.slice(atNew));
    writeBack(); closeSheet(true); renderList();
    say('已新增标题：' + title + '（记得点保存）');
  }
  /* 删除整个标题块（# 行），下面的规则保留 */
  function dropGroup(g) {
    if (!g) return;
    var txt = g.lines.map(function (l) { return '# ' + l.value; }).join('\n');
    if (!window.confirm('删除这个标题块？\n' + txt + '\n\n下面的 ' + g.children.length + ' 条规则会保留。')) return;
    var ids = g.lines.map(function (l) { return l.id; });
    rows = rows.filter(function (r) { return ids.indexOf(r.id) < 0; });
    writeBack(); closeSheet(true); renderList();
    say('已删除标题');
  }
  /* 拖动：ids 里的行整体移动；落在标题行上就插到这个标题块之后（成为它下面第一条规则） */
  function bindDrag(el, ids, selfRow, selfGroup) {
    /* 只有按住左边的把手（标题行是 #）才能拖：否则想选中一行里的正则时老是误拖 */
    var handle = el.querySelector('.rv-handle, .rv-mark');
    el.setAttribute('draggable', 'false');
    if (handle) {
      handle.addEventListener('mousedown', function () { el.setAttribute('draggable', 'true'); });
      handle.addEventListener('touchstart', function () { el.setAttribute('draggable', 'true'); }, { passive: true });
    }
    el.addEventListener('dragstart', function (e) {
      dragIds = ids.slice();
      el.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragIds.join(',')); } catch (x) { } }
    });
    el.addEventListener('dragend', function () {
      dragIds = [];
      el.setAttribute('draggable', 'false');
      Array.prototype.forEach.call(document.querySelectorAll('#rv-root .rv-row'), function (x) { x.classList.remove('dragging', 'over'); });
    });
    el.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (dragIds.length && dragIds.indexOf(selfRow.id) < 0) el.classList.add('over');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('over'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault(); el.classList.remove('over');
      if (!dragIds.length || dragIds.indexOf(selfRow.id) >= 0) return;
      var moving = rows.filter(function (x) { return dragIds.indexOf(x.id) >= 0; });
      var rest = rows.filter(function (x) { return dragIds.indexOf(x.id) < 0; });
      var at;
      if (selfGroup) {
        var lastLine = selfGroup.lines[selfGroup.lines.length - 1];
        at = rest.indexOf(lastLine) + 1;
      } else {
        at = rest.indexOf(selfRow);
      }
      if (at < 0) return;
      rows = rest.slice(0, at).concat(moving, rest.slice(at));
      writeBack(); renderList();
      say(selfGroup ? '已移到「' + groupTitle(selfGroup) + '」下面' : '已调整顺序');
    });
  }
  function dropRow(row,confirmed) {
    var pn = row.kind === 'comment' ? { idx: -1 } : prevNote(row);
    if (!confirmed && !window.confirm('删除这条规则？\n' + lineOf(row) + (pn.idx >= 0 ? '\n（它上面的备注行一起删掉）' : ''))) return;
    rows = rows.filter(function (r, i) { return r.id !== row.id && i !== pn.idx; });
    sel = sel.filter(function (x) { return x !== row.id; });
    writeBack(); renderList(); say('已删除 ' + row.value);
  }
  /* 身份互转：标题 → 规则备注（标题行改写为「# 备注：…」，挂到它下面第一条规则） */
  function groupToNote(g) {
    if (!g || !g.children.length) return;
    var t = stripTitlePrefix(groupTitle(g));
    if (!t) return;
    if (!window.confirm('把「' + t + '」改成下面第一条规则的备注？\n这一行的 # 会写成「# 备注：' + t + '」。')) return;
    g.title.value = '备注：' + t; g.title.touched = true; g.title.role = 'note';
    writeBack(); renderList();
    say('已改成备注：' + t);
  }
  /* ---------- 进屋 / 出门：规则进分组、出分组 ----------
     分组仍然是「位置」定义的（标题行下面的规则属于它），所以这里只是把那一行
     搬到组末尾 / 搬到组末尾之外再垫一个空行；未编辑的行照旧原样保留。 */
  function moveToGroup(target, gid) {
    if (!target || rows.indexOf(target) < 0) return false;
    var pn = prevNote(target), moving = [target];
    if (pn.idx >= 0) moving = [rows[pn.idx], target];          /* 备注行跟着规则走 */
    var cur = groupOf(target.id), want = gid ? groupById(gid) : null;
    if (gid && !want) return false;
    if ((cur && want && cur.id === want.id) || (!cur && !want)) return false;   /* 本来就在那儿 */
    var rest = rows.filter(function (r) { return moving.indexOf(r) < 0; });
    var g = want || cur, anchor = null, i, c;
    anchor = g.lines[g.lines.length - 1];                      /* 先锚在这一组的标题行上 */
    for (i = 0; i < g.children.length; i++) {                  /* 再往后推到组里最后一条还在的规则 */
      c = byId(g.children[i]);
      if (c && rest.indexOf(c) >= 0) anchor = c;
    }
    if (!anchor) return false;
    var at = rest.indexOf(anchor);
    if (at < 0) return false;
    var out = rest.slice(0, at + 1).concat(moving, rest.slice(at + 1));
    if (!want) {                                               /* 出组：拿一行 # 当分隔线，否则又会被算回这一组 */
      var pos = out.indexOf(moving[0]), after = out[pos + moving.length], prev = out[pos - 1];
      if (after && (after.kind === 'sep' || after.kind === 'blank')) {
        out.splice(pos, moving.length);                        /* 后面已经有分隔线：把整块挪到它后面 */
        var at2 = out.indexOf(after) + 1;
        out = out.slice(0, at2).concat(moving, out.slice(at2));
      } else if (prev && prev.kind !== 'sep' && prev.kind !== 'blank') {
        out.splice(pos, 0, sepRow());
      }
    }
    rows = out;
    return true;
  }
  function fillGroupSelect(row, fresh) {
    var box = sheet().querySelector('#rv-group'), hint = sheet().querySelector('#rv-group-hint');
    if (!box) return;
    var curG = (!fresh && row) ? groupOf(row.id) : null;
    var html = '<option value="">（不分组）</option>';
    groups.forEach(function (g) {
      var t = stripTitlePrefix(groupTitle(g)) || '（空标题）';
      html += '<option value="' + g.id + '"' + (curG && curG.id === g.id ? ' selected' : '') + '>' +
        esc(t.length > 28 ? t.slice(0, 28) + '…' : t) + '</option>';
    });
    box.innerHTML = html;
    box.disabled = groups.length === 0;
    groupSelBase = box.value;
    hint.className = 'rv-hint';
    hint.textContent = groups.length
      ? (curG ? '现在在「' + stripTitlePrefix(groupTitle(curG)) + '」里（' + curG.children.length + ' 条）；选「（不分组）」就把它移出来'
              : '现在是单着的一条规则；选一个标题就归到那组下面')
      : '这个名单还没有标题，先在上面「＋ 新增 → 新增标题」建一个';
  }
  /* ---------- 行上的小菜单：规则=选分组，# 行=选角色 ---------- */
  var rowMenuEl = null;
  function closeRowMenu() { if (rowMenuEl) { rowMenuEl.remove(); rowMenuEl = null; } }
  function openRowMenu(anchor, cap, items) {
    closeRowMenu();
    var el = document.createElement('div');
    el.className = 'rv-menu-pop rv-menu-float';
    el.innerHTML = '<div class="rv-menu-cap">' + esc(cap) + '</div>' + items.map(function (it, i) {
      return '<button type="button" data-i="' + i + '"' + (it.active ? ' class="active"' : '') + '>' +
        esc(it.label) + '<span class="k">' + esc(it.active ? '当前' : (it.hint || '')) + '</span></button>';
    }).join('');
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.top = top + 'px';
    el.onclick = function (e) {
      var b = e.target.closest('button[data-i]');
      if (!b) return;
      var it = items[+b.dataset.i];
      closeRowMenu();
      if (it && it.pick) it.pick();
    };
    rowMenuEl = el;
    var first = el.querySelector('button.active') || el.querySelector('button');
    if (first) first.focus();
  }
  function openGroupPicker(anchor, row) {
    var cur = groupOf(row.id);
    var items = [{
      label: '（不分组）', hint: groups.length ? '单着的一条规则' : '名单里还没有标题', active: !cur,
      pick: function () { if (moveToGroup(row, '')) { writeBack(); renderList(); say('已从分组里移出来：' + row.value); } }
    }];
    groups.forEach(function (g) {
      items.push({
        label: stripTitlePrefix(groupTitle(g)) || '（空标题）', hint: g.children.length + ' 条', active: !!(cur && cur.id === g.id),
        pick: function () {
          if (moveToGroup(row, g.id)) { writeBack(); renderList(); say('已放进「' + stripTitlePrefix(groupTitle(g)) + '」：' + row.value); }
        }
      });
    });
    openRowMenu(anchor, '把这条放进哪一组', items);
  }
  /* 「#」行三种角色互转：标题 / 名单说明 / 规则备注 —— 写成显式前缀，永久有效 */
  /* 新变成标题的那一行先空着：紧跟其后的规则用空行隔开，它们仍是单着的
     （要不要放进来，用规则行上的「分组」按钮自己挑） */
  function keepTitleEmpty(row) {
    var i = rows.indexOf(row);
    if (i < 0) return;
    var next = rows[i + 1];
    if (!next || next.kind === 'blank' || next.kind === 'sep') return;
    /* 下一行是标题/说明这类不领养规则的 # 行就不用管；是「规则备注」则要连它一起隔开 */
    if (next.kind === 'comment') {
      var nrole = next.role || commentRole(next, null);
      if (nrole !== 'note') return;
    }
    rows.splice(i + 1, 0, sepRow());
  }
  /* 分隔线：写成单独一行 #，保存时不会被前端丢掉（空行会被丢） */
  function sepRow() {
    return { id: 'r' + (++seq), kind: 'sep', type: 'sep', value: '', off: true, touched: true, line: '#' };
  }
  function setCommentRole(row, role) {
    var was = row.role;
    var body = String(row.value || '').replace(/^\s*(?:标题|title|说明|备注|note)\s*[:：]\s*/i, '');
    var head = role === 'title' ? (needsTitlePrefix(body) ? '标题：' : '') : (role === 'doc' ? '说明：' : '备注：');
    row.value = head + body; row.touched = true; row.role = role;
    if (role === 'title' && was !== 'title') keepTitleEmpty(row);
    writeBack(); renderList();
    say(role === 'title' ? '已改成标题：' + body : (role === 'note' ? '已改成规则备注：' + body : '已改成名单说明：' + body));
  }
  /* 这段文字带中文句读、或看着像注释，就会被判成说明/注释，所以显式加「标题：」把它钉成标题 */
  function needsTitlePrefix(t) {
    var s = String(t || '').trim();
    return DOC_COLON.test(s) || DOC_PUNCT.test(s) || ANNO_KEY.test(s);
  }
  function openRolePicker(anchor, row) {
    var cur = row.role || (row.kind === 'comment' ? 'doc' : 'title');
    openRowMenu(anchor, '这一行是', [
      { label: '标题', hint: '领养下面的规则', active: cur === 'title', pick: function () { setCommentRole(row, 'title'); } },
      { label: '名单说明', hint: '谁都不领养，规则照常单着', active: cur === 'doc', pick: function () { setCommentRole(row, 'doc'); } },
      { label: '规则备注', hint: '贴到下面第一条规则上', active: cur === 'note', pick: function () { setCommentRole(row, 'note'); } }
    ]);
  }

  /* ---------- 编辑面板 ---------- */
  var TYPE_TIP = {
    domain: { ph: 't.hdhome.org', tip: '含子域一起命中' },
    full: { ph: 'stun.l.google.com', tip: '只匹配这一个，子域不命中' },
    keyword: { ph: 'kaspersky', tip: '请求里出现就命中' },
    regexp: { ph: '^[^.]+$', tip: '按正则匹配，谨慎使用' }
  };
  /* 备注用真实格式里本来就有的 # 注释表达：规则上一行写 "# 备注：…" */
  var NOTE_RE = /^#\s*备注\s*[:：]\s*(.*)$/;
  function prevNote(row) {
    var i = rows.indexOf(row);
    if (i <= 0) return { idx: -1, text: '' };
    var p = rows[i - 1], line = (p.touched ? lineOf(p) : p.line) || '', m;
    if (!isRuleNote(p)) return { idx: -1, text: '' };
    m = String(line).match(NOTE_RE);
    return { idx: i - 1, text: m ? m[1] : stripNotePrefix(p.value) };
  }
  /* 这一行 # 现在算不算「某条规则的备注」：# 备注：… / # 注意：… 这类，且没被当成分组注释 */
  function isRuleNote(p) {
    if (!p || p.kind !== 'comment') return false;
    if (p.role === 'note') return true;
    if (p.role === 'gnote' || p.role === 'title' || p.role === 'doc') return false;
    return NOTE_RE.test(commentLine(p)) || NOTE_RE_ANY.test(commentLine(p));
  }
  function sheet() { return sheetEl || document.getElementById('rv-sheet'); }
  function scrim() { return scrimEl || document.getElementById('rv-scrim'); }
  /* 名单里最主要的类型：PCDN IPv4/IPv6 这类几乎全是 regexp: 行，
     新增规则时默认成正则，而不是一律默认「域名」。 */
  function defaultType() {
    var stat = {};
    rows.forEach(function (r) { if (r.kind === 'rule') stat[r.type] = (stat[r.type] || 0) + 1; });
    var best = 'domain', n = 0;
    Object.keys(stat).forEach(function (k) { if (stat[k] > n) { n = stat[k]; best = k; } });
    return PREFIX[best] ? best : 'domain';
  }
  function curType() { var b = sheet().querySelector('#rv-type button.on'); return b ? b.dataset.t : 'domain'; }
  function setType(t, note) {
    if (!PREFIX[t]) return;
    Array.prototype.forEach.call(sheet().querySelectorAll('#rv-type button'), function (b) {
      b.classList.toggle('on', b.dataset.t === t);
      if (b.dataset.t === t) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    sheet().dataset.note = note || '';
  }
  function valid(v, t) {
    if (!v) return false;
    if (t === 'keyword') return true;
    if (t === 'regexp') { try { new RegExp(v); return true; } catch (e) { return false; } }
    return HOST_RE.test(v);
  }
  function errText(t) { return t === 'regexp' ? '正则写错了，检查括号或转义' : (t === 'keyword' ? '关键字不能为空' : '域名格式看起来不对'); }
  function linePreview() { var v = sheet().querySelector('#rv-value').value.trim(); return (sheetOff?'# ':'')+(rawMode?'':PREFIX[curType()] || 'domain:')+(v || '…'); }
  function hint(text, cls) {
    var h = sheet().querySelector('#rv-hint');
    h.className = 'rv-hint' + (cls ? ' ' + cls : '');
    h.innerHTML = text;
  }
  function paint() {
    var inp = sheet().querySelector('#rv-value');
    var raw = inp.value, v = raw.trim(), t = curType();
    var pm = v.match(PREFIX_RE), hash = /^#\s*/.test(v);
    var body = v.replace(/^#\s*/, '').replace(PREFIX_RE, '');
    var pending = !!pm || hash;                       /* 还没按回车识别，不算错 */
    var bad = !rawMode && !pending && !!body && !valid(body, t);
    inp.classList.toggle('bad', bad);
    var rawLabels={client_ip:'客户端 IP',direct_ip:'IP 或网段',rewrite:'重定向条目'};
    sheet().querySelector('#rv-value-label').textContent = rawMode?(rawLabels[activeTag()]||'原文'):NAME[t];
    inp.placeholder=rawMode?(activeTag()==='rewrite'?'例如 home.example.com 192.0.2.10':'例如 192.0.2.10'):'例如 '+TYPE_TIP[t].ph;
    var note = sheet().dataset.note;
    if (bad) hint(errText(t), 'bad');
    else if (pm) {
      var pt = pm[1].toLowerCase();
      hint('按回车识别为「' + NAME[pt] + '」 · 将写入 <span class="mono">' + esc(PREFIX[pt] + body) + '</span>' + (hash ? '（停用）' : ''), 'hit');
    } else if (hash) {
      hint('按回车按「停用」写入 <span class="mono">' + esc('# ' + PREFIX[t] + body) + '</span>', 'hit');
    } else if (rawMode) hint('将写入 <span class="mono">'+esc(linePreview())+'</span> · '+(sheetOff?'停用':'保留原文格式'));
    else hint('将写入 <span class="mono">' + esc(linePreview()) + '</span> · ' + (note || TYPE_TIP[t].tip), note ? 'hit' : '');
    sheet().classList.toggle('dirty', isDirtySheet());
  }
  function sheetSnapshot() {
    var pane=sheet();if(!pane)return '';
    if(groupMode)return JSON.stringify({role:groupRole,title:pane.querySelector('#rv-grp-title').value,notes:pane.querySelector('#rv-grp-notes').value});
    return JSON.stringify({type:curType(),raw:rawMode,off:sheetOff,value:pane.querySelector('#rv-value').value,note:pane.querySelector('#rv-note').value,group:pane.querySelector('#rv-group').value});
  }
  function isDirtySheet() { return !!sheetBaseline && sheetSnapshot() !== sheetBaseline; }
  function scheduleFocus(selector) {
    clearTimeout(focusTimer);var pane=sheet();
    focusTimer=setTimeout(function(){if(!pane || !pane.isConnected || !pane.classList.contains('show'))return;var input=pane.querySelector(selector);if(input){input.focus({preventScroll:true});if(input.setSelectionRange)input.setSelectionRange(input.value.length,input.value.length);}},50);
  }
  function showSheet() {
    var pane=sheet(),main=document.querySelector('.master-container');
    if(!ownsInert&&main){mainWasInert=main.inert;main.inert=true;ownsInert=true;}
    pendingLeave=null;sheetBaseline=sheetSnapshot();
    pane.querySelector('.rv-discard-prompt').hidden=true;
    pane.inert=false;pane.setAttribute('aria-hidden','false');pane.classList.remove('dirty');
    scrim().classList.add('show');pane.classList.add('show');
  }
  function showDiscardPrompt(next) {
    if(typeof next==='function')pendingLeave=next;
    var prompt=sheet().querySelector('.rv-discard-prompt');prompt.hidden=false;
    prompt.querySelector('[data-rv-continue]').focus();
  }
  var noteBase = '';
  function openSheet(row, fresh) {
    editing = row || null; isNew = !!fresh; armedEnter = false;
    groupMode = false; editingGroup = null; groupBase = null;
    sheet().querySelector('#rv-rulefields').hidden = false;
    sheet().querySelector('#rv-grpfields').hidden = true;
    sheet().querySelector('#rv-sheet-tip').textContent = '应用到名单后，点击名单页保存才生效';
    var scope = document.querySelector('.rule-menu button.active span');
    sheet().querySelector('#rv-sheet-title').textContent = fresh ? '新增规则' : '编辑规则';
    sheet().querySelector('#rv-sheet-scope').textContent = scope ? scope.textContent : '名单';
    sheet().querySelector('#rv-del').style.display = fresh ? 'none' : '';
    sheetOff=!!(row&&row.off);
    rawMode = fresh ? !!rawTags[activeTag()] : !!row && row.kind === 'raw';
    sheet().querySelector('#rv-type').closest('.rv-field').hidden=!!rawTags[activeTag()];
    if (rawMode) {
      /* 原件行本来就没有类型前缀，别谎报一个类型；保存时按原文写回 */
      Array.prototype.forEach.call(sheet().querySelectorAll('#rv-type button'), function (b) { b.classList.remove('on', 'pop'); });
      sheet().dataset.note = '';
    } else {
      setType(fresh || !row || row.type === 'raw' || row.type === 'comment' ? defaultType() : row.type);
    }
    sheet().querySelector('#rv-value').value = fresh ? '' : (row.value || '');
    noteBase = fresh ? '' : prevNote(row).text;
    sheet().querySelector('#rv-note').value = noteBase;
    buildGroups();                                   /* 分组下拉要按当前结构生成 */
    fillGroupSelect(row, fresh);
    sheet().querySelector('#rv-group').onchange = function () { sheet().classList.toggle('dirty', isDirtySheet()); };
    sheet().classList.remove('dirty');
    paint();
    sheetBack = forgetTrigger();
    showSheet();
    scheduleFocus('#rv-value');
  }
  /* 标题（分组）编辑器：来源就是名单里的 # 行 —— 第一行当标题，其余当注释 */
  /* 面板上的角色切换：标题 / 名单说明 / 规则备注，切换时字段跟着变 */
  function paintGroupRole(role) {
    groupRole = role;
    var box = sheet().querySelector('#rv-grp-role');
    if (box) Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.r === role); });
    var tf = sheet().querySelector('#rv-grp-title').closest('.rv-field');
    if (tf) {
      var lab = tf.querySelector('label').childNodes[0];
      if (lab) lab.nodeValue = role === 'title' ? '标题' : (role === 'doc' ? '说明' : '备注');
    }
    var nf = sheet().querySelector('#rv-grp-notes') ? sheet().querySelector('#rv-grp-notes').closest('.rv-field') : null;
    if (nf) nf.hidden = role !== 'title';
    var hint = sheet().querySelector('#rv-grp-hint');
    if (hint) {
      hint.textContent = role === 'title'
        ? '标题下面（直到下一个标题或空行）的规则都算这一组'
        : (role === 'doc'
          ? '谁都不领养：下面的规则还是单着的，照常一行一条'
          : '贴到下面第一条规则上，在那条规则面板的「备注」里也能看到');
    }
  }
  function openGroupSheet(g) {
    groupMode = true;
    editingGroup = g || null; editing = null; isNew = false; armedEnter = false; rawMode = false;
    var docOnly = !!(g && g.docOnly);
    var scope = document.querySelector('.rule-menu button.active span');
    var lines = g ? g.lines : [];
    var title = g ? stripTitlePrefix(groupTitle(g)) : '';
    var notes = g ? g.notes.map(function (n) { return String(n.value || '').trim(); }).filter(Boolean).join('\n') : '';
    groupBase = { title: title, notes: notes };
    var role0 = docOnly ? 'doc' : (g && g.title && g.title.role ? g.title.role : 'title');
    if (role0 === 'gnote') role0 = 'title';
    groupRole = role0;
    sheet().querySelector('#rv-sheet-title').textContent = docOnly ? '编辑说明' : (g ? '编辑标题与注释' : '新增标题');
    sheet().querySelector('#rv-sheet-scope').textContent = (scope ? scope.textContent : '名单') +
      (docOnly ? ' · 名单说明' : (g ? ' · ' + (g.children.length ? g.children.length + ' 条规则' : '暂无规则') : ''));
    sheet().querySelector('#rv-sheet-tip').textContent = '这行 # 的角色、文字都可以直接改';
    sheet().querySelector('#rv-del').style.display = g ? '' : 'none';
    sheet().querySelector('#rv-rulefields').hidden = true;
    sheet().querySelector('#rv-grpfields').hidden = false;
    paintGroupRole(role0);
    sheet().querySelector('#rv-grp-title').value = title;
    sheet().querySelector('#rv-grp-notes').value = notes;
    sheet().querySelector('#rv-grp-hint').textContent = g
      ? '标题写成一行 #，注释写成 # 注释：… ；这一组下面已经有 ' + g.children.length + ' 条规则，保存后仍留在这个标题下'
      : '标题写成一行 #，注释写成 # 注释：… ；它下面的规则（直到下一个标题或空行）都算这一组';
    sheet().classList.remove('dirty');
    sheet().querySelector('#rv-grp-title').oninput = function () { sheet().classList.toggle('dirty', isDirtySheet()); };
    sheet().querySelector('#rv-grp-notes').oninput = function () { sheet().classList.toggle('dirty', isDirtySheet()); };
    sheet().querySelector('#rv-grp-role').onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      paintGroupRole(b.dataset.r);
      sheet().classList.toggle('dirty', isDirtySheet());
    };
    sheet().querySelector('#rv-grp-title').onkeydown = function (e) { if (!e.isComposing && e.keyCode!==229 && e.key === 'Enter') { e.preventDefault(); commit(); } };
    sheet().querySelector('#rv-grp-notes').onkeydown = function (e) { if (!e.isComposing && e.keyCode!==229 && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } };
    sheetBack = forgetTrigger();
    showSheet();
    scheduleFocus('#rv-grp-title');
  }
  function closeSheet(force) {
    var pane=sheet();if(!pane)return true;
    if(!force && isDirtySheet()){showDiscardPrompt();return false;}
    clearTimeout(focusTimer);pendingLeave=null;sheetBaseline='';
    if(scrim())scrim().classList.remove('show');
    pane.classList.remove('show','dirty');pane.inert=true;pane.setAttribute('aria-hidden','true');
    pane.querySelector('.rv-discard-prompt').hidden=true;
    var main=document.querySelector('.master-container');if(ownsInert&&main)main.inert=mainWasInert;ownsInert=false;
    editing=null;isNew=false;rawMode=false;sheetOff=false;groupMode=false;editingGroup=null;groupBase=null;
    if(sheetBack&&sheetBack.isConnected&&sheetBack.offsetParent!==null){try{sheetBack.focus({preventScroll:true});}catch(e){}}
    sheetBack=null;return true;
  }
  function closeNewMenu() {
    if (menuPop) menuPop.hidden = true;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }
  /* 全局键盘与「点空白关下拉」只注册一次。
     以前把它们写在 build() 里：站点重绘一次面板就多一份监听器，
     一次 Ctrl+Z 会连撤两步（历史栈直接跳过头）。 */
  var globalBound = false;
  function bindGlobal() {
    if (globalBound) return;
    globalBound = true;
    document.addEventListener('keydown', function (e) {
      if (!root || !root.isConnected) return;
      if(e.isComposing||e.keyCode===229)return;
      var nativeDialog=document.querySelector('dialog[open]');
      if(nativeDialog){if(nativeDialog.id==='rp-wrap'&&(e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='s'){e.preventDefault();doPaste();}return;}
      if (e.key === 'Escape') {
        if (sheetEl && sheetEl.classList.contains('show')) { e.preventDefault();e.stopPropagation();closeSheet();return; }
        if (rowMenuEl) { closeRowMenu(); return; }
        if (menuPop && !menuPop.hidden) { closeNewMenu(); return; }
        var wrap = document.getElementById('rp-wrap');
        if (wrap && wrap.open) { e.preventDefault();closePaste();return; }
        if (sel.length) { sel = []; renderList(); return; }        /* 先取消选择 */
        var qb = root && root.querySelector('#rv-q');
        if (qb && qb.value) { q = ''; qb.value = ''; paintSearch(); renderList(); }   /* 再清搜索 */
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = String(e.key || '').toLowerCase();
      if (k === 's') { e.preventDefault();if(sheetEl&&sheetEl.classList.contains('show'))commit();else if(saveBtn)saveBtn.click();return; }
      if (sheetEl && sheetEl.classList.contains('show')) return;   /* 面板里让浏览器自己撤销输入 */
      if (view === 'raw' && e.target === ta) return;               /* 原文框里同理 */
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;   /* 搜索框里撤销的是输入 */
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    });
    document.addEventListener('click', function (e) {
      if (rowMenuEl && !e.target.closest('.rv-menu-float') && !e.target.closest('[data-act=group]') && !e.target.closest('[data-act=role]')) closeRowMenu();
      if (!menuPop || menuPop.hidden) return;
      if (e.target.closest && (e.target.closest('#rv-newmenu') || e.target.closest('#rv-new'))) return;
      closeNewMenu();
    });
  }
  /* 关闭面板后焦点该回到哪：优先还给叫出面板的那个按钮（菜单项会先被藏掉） */
  function forgetTrigger() {
    var el = lastTrigger && document.body.contains(lastTrigger) && lastTrigger.offsetParent !== null
      ? lastTrigger : document.activeElement;
    lastTrigger = null;
    return el;
  }
  /* 识别：把 # 注释、前缀、类型一次对齐；返回是否有变化 */
  function recognize() {
    var inp = sheet().querySelector('#rv-value'), raw = inp.value, s = String(raw).replace(/[\r\n]+/g, ' ').trim();
    var off = false, hit = null, m, changed = false;
    if (/^#\s*/.test(s)) { off = true;sheetOff=true;s = s.replace(/^#\s*/, '').trim();changed=true; }
    m = s.match(PREFIX_RE);
    if(rawMode&&(!m||rawTags[activeTag()])){if(s!==raw.trim()){inp.value=s;changed=true;}paint();return changed;}
    if (m) { hit = m[1].toLowerCase(); s = s.slice(m[0].length).trim(); changed = true; rawMode = false; }
    if (s !== raw.trim()) { inp.value = s; changed = true; }
    var t = hit || curType(), notes = [];
    if (hit) notes.push('已按前缀 ' + hit + ': 识别');
    if (off) notes.push('原行是注释，按停用处理');
    if (!valid(s, t)) {
      if (REGEX_CHAR_RE.test(s)) { t = 'regexp'; notes.push('看起来是正则'); }
      else if (HOST_RE.test(s)) { t = 'domain'; notes.push('看起来是域名'); }
      else if (s) { t = 'keyword'; notes.push('不是域名形态'); }
      changed = true;
    }
    if (t !== curType()) { setType(t, notes.join(' · ')); changed = true; }
    else if (notes.length) setType(t, notes.join(' · '));
    // The original row stays untouched until commit().
    paint();
    return changed;
  }
  function commit() {
    if (groupMode) { commitGroup(); return; }
    var input=sheet().querySelector('#rv-value').value;if(/^\s*#/.test(input)||PREFIX_RE.test(input))recognize();
    var v = sheet().querySelector('#rv-value').value.trim(), t = curType();
    var note = sheet().querySelector('#rv-note').value.trim();
    var wasRaw = rawMode;
    if (!rawMode && !valid(v, t)) { paint(); sheet().querySelector('#rv-value').focus(); say(errText(t)); return; }
    if (rawMode && !v) { say('内容不能为空'); sheet().querySelector('#rv-value').focus(); return; }
    var target;
    if (isNew) {
      var dup = rows.some(function (r) { return (r.kind === 'rule' || r.kind === 'raw') && r.value === v && r.type === (rawMode?'raw':t); });
      if (dup) { say('列表里已经有这条：' + (PREFIX[t] || '') + v); sheet().querySelector('#rv-value').focus(); return; }
      target = { id: 'r' + (++seq), kind: rawMode?'raw':'rule', type: rawMode?'raw':t, value: v, off: sheetOff, touched: true };
      rows.push(target);
    } else if (editing) {
      if (rawMode) { editing.type = 'raw'; editing.value = v; editing.kind = 'raw'; }
      else { editing.type = t; editing.value = v; editing.kind = 'rule'; }
      editing.off=sheetOff;
      editing.touched = true;
      target = editing;
    }
    var movedMsg = '';
    if (target) {
      applyNote(target, note);
      var gid = sheet().querySelector('#rv-group') ? sheet().querySelector('#rv-group').value : '';
      buildGroups();                                   /* 备注插进去之后，组成员关系按最新结构算 */
      var moved = moveToGroup(target, gid);
      if (moved) movedMsg = gid ? '已放进「' + stripTitlePrefix(groupTitle(groupById(gid))) + '」' : '已从分组里移出来';
    }
    writeBack();
    closeSheet(true); renderList();
    say(movedMsg || ('已写入列表：' + (wasRaw ? v : PREFIX[t] + v) + '（记得点保存）'));
  }
  /* 备注落在规则上一行的注释里；清空备注就把那一行删掉 */
  function applyNote(target, note) {
    var pn = prevNote(target);
    if (note) {
      if (pn.idx >= 0) { rows[pn.idx].value = '备注：' + note; rows[pn.idx].touched = true; }
      else {
        var at = rows.indexOf(target);
        rows.splice(at, 0, { id: 'r' + (++seq), kind: 'comment', type: 'comment', value: '备注：' + note, off: true, touched: true });
      }
    } else if (pn.idx >= 0) rows.splice(pn.idx, 1);
  }

  /* ---------- 骨架 ---------- */
  function build(editor, textarea, save) {
    ta = textarea; saveBtn = save; view = 'list';
    var host = document.createElement('div');
    host.className = 'rv';
    host.id = 'rv-root';
    host.innerHTML =
      '<div class="rv-toolbar">' +
        '<label class="rv-search">' + ICON.search + '<input id="rv-q" placeholder="搜索内容或类型" autocomplete="off">' +
          '<button type="button" class="rv-search-x" id="rv-qx" title="清空搜索" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></label>' +
        '<span class="rv-new-wrap">' +
          '<button class="button small" id="rv-new" aria-haspopup="menu" aria-expanded="false">' + ICON.plus + '新增<span class="rv-caret"></span></button>' +
          '<span class="rv-menu-pop" id="rv-newmenu" role="menu" hidden>' +
            '<button type="button" role="menuitem" data-new="rule">新增规则<span class="k">按类型加一条</span></button>' +
            '<button type="button" role="menuitem" data-new="group">新增标题<span class="k">给一组规则起个小标题</span></button>' +
            '<button type="button" role="menuitem" data-new="paste">批量粘贴<span class="k">一行一条，重复自动跳过</span></button>' +
          '</span>' +
        '</span>' +
        '<button class="button small ghost" id="rv-all">全选</button>' +
        '<button class="button small ghost" id="rv-undo" title="撤销 Ctrl+Z" disabled>撤销</button>' +
        '<button class="button small ghost" id="rv-redo" title="重做 Ctrl+Shift+Z" disabled>重做</button>' +
        '<button class="button small ghost" id="rv-mode">原文</button>' +
      '</div>' +
      '<div class="rv-list"></div>' +
      '<div class="rv-selbar" hidden><span class="n">已选 <b>0</b> 条</span>' +
        '<button class="button small" data-bulk="on">批量启用</button>' +
        '<button class="button small" data-bulk="off">批量停用</button>' +
        '<span class="grow"></span>' +
        '<button class="button small ghost" data-bulk="clear">取消选择</button>' +
        '<button class="button small danger" data-bulk="del">删除</button></div>';
    editor.insertBefore(host, textarea);
    textarea.style.display = 'none';
    root = host;
    rows = parse(textarea.value); sel = []; q = ''; dirty = false;
    /* 站点可能把 sessionStorage 里的草稿回填进 textarea，此时 textarea.value 是草稿而不是
       已保存内容。站点自己的基准在 dataset.original 上，有就用它，避免我们把草稿当成
       保存点（会导致脏状态判断反向、保存按钮提示错位）。 */
    savedText = (textarea.dataset && textarea.dataset.original !== undefined)
      ? textarea.dataset.original : textarea.value;
    hist = [textarea.value]; histAt = 0; paintHist();
    dirty = textarea.value !== savedText;
    if (saveBtn) saveBtn.classList.toggle('rv-has-dirty', dirty);
    root.querySelector('#rv-undo').onclick = undo;
    root.querySelector('#rv-redo').onclick = redo;
    var qBox = root.querySelector('#rv-q');
    qBox.oninput = function (e) { q = e.target.value; paintSearch(); renderList(); };
    root.querySelector('#rv-qx').onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      q = ''; qBox.value = ''; paintSearch(); renderList(); qBox.focus();
    };
    /* 「+ 新增」一个按钮装三件事，工具条不再一排按钮 */
    var newBtn = root.querySelector('#rv-new'), newMenu = root.querySelector('#rv-newmenu');
    menuBtn = newBtn; menuPop = newMenu;
    newBtn.onclick = function (e) {
      e.stopPropagation();
      newMenu.hidden = !newMenu.hidden;
      newBtn.setAttribute('aria-expanded', newMenu.hidden ? 'false' : 'true');
      if (!newMenu.hidden) { var first = newMenu.querySelector('button'); if (first) first.focus(); }
    };
    newMenu.onclick = function (e) {
      var b = e.target.closest('button[data-new]');
      if (!b) return;
      closeNewMenu();
      lastTrigger = newBtn;
      if (b.dataset.new === 'rule') openSheet(null, true);
      else if (b.dataset.new === 'group') openGroupSheet(null);
      else openPaste();
    };
    newMenu.onkeydown = function (e) {
      if (e.key === 'Escape') { closeNewMenu(); newBtn.focus(); }
    };
    root.querySelector('#rv-all').onclick = function () {
      var vis = selectableRows(), all = allSelected();
      vis.forEach(function (r) {
        if (all) sel = sel.filter(function (x) { return x !== r.id; });
        else if (sel.indexOf(r.id) < 0) sel.push(r.id);
      });
      renderList();
    };
    root.querySelector('#rv-mode').onclick = function () {
      /* 注意：不能把 #rv-root 整个藏掉，否则这个按钮自己也被藏了，切不回列表 */
      var raw = !root.classList.contains('raw');
      view = raw ? 'raw' : 'list';
      root.classList.toggle('raw', raw);
      textarea.style.display = raw ? '' : 'none';
      if (!raw) {
        /* 原文里可能手改过：切回列表必须以原文为准重新解析，否则之后的编辑会拿旧列表覆盖 */
        rows = parse(textarea.value); sel = []; q = '';
        var qBox = root.querySelector('#rv-q'); if (qBox) qBox.value = '';
        paintSearch();
        dirty = textarea.value !== savedText;
        commitHist(textarea.value);
        renderList(); renderStat();
      }
      if (raw) {
        var lh = root.querySelector('.rv-list').getBoundingClientRect().height;
        textarea.style.height = Math.max(300, Math.round(lh || 420)) + 'px';
        textarea.focus();
      }
      this.textContent = raw ? '列表' : '原文';
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-bulk]'), function (b) {
      b.onclick = function () {
        var act = b.dataset.bulk, n = sel.length;
        if (act === 'clear') { sel = []; renderList(); return; }
        if (!n) return;
        if (act === 'del' && !window.confirm('删除选中的 ' + n + ' 条规则？')) return;
        if (act === 'del') rows = rows.filter(function (r) { return sel.indexOf(r.id) < 0; });
        else rows.forEach(function (r) {
          if (sel.indexOf(r.id) < 0) return;
          if (r.kind === 'comment' || r.kind === 'blank' || r.kind === 'sep') return;   /* 注释/分隔线不参与启停 */
          r.off = act === 'off'; r.touched = true;
        });
        sel = []; writeBack(); renderList();
        say(act === 'del' ? '已删除 ' + n + ' 条' : (act === 'off' ? '已停用 ' : '已启用 ') + n + ' 条');
      };
    });
    renderList();
    fitList();
    /* 面板挂在 body 上，站点重绘时不会跟着销毁：重建前先把旧的一律清掉，
       否则每重绘一次就多留一层透明遮罩+面板（曾经堆到 12 层）。 */
    Array.prototype.forEach.call(document.querySelectorAll('#rv-scrim, #rv-sheet'), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    document.body.insertAdjacentHTML('beforeend',
      '<div class="rv-scrim" id="rv-scrim"></div>' +
      '<aside class="rv-sheet" id="rv-sheet" role="dialog" aria-modal="true" aria-labelledby="rv-sheet-title" tabindex="-1">' +
        '<div class="rv-sheet-head"><div><h2 id="rv-sheet-title">编辑规则</h2>' +
          '<div class="rv-sub"><span id="rv-sheet-scope">名单</span><span class="rv-sep"></span><span id="rv-sheet-tip">回车识别类型，再回车保存</span><span class="rv-dot"></span></div></div>' +
          '<div class="rv-sheet-tools">' +
            '<button class="rv-x del" id="rv-del" title="删除这条">' + ICON.del + '</button>' +
            '<button class="rv-x" id="rv-close" title="关闭"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>' +
          '</div></div>' +
        '<section class="rv-discard-prompt" role="alert" hidden><p>修改尚未应用到名单。要放弃这次编辑吗？</p><div><button type="button" class="button small" data-rv-continue>继续编辑</button><button type="button" class="button small" data-rv-discard>放弃修改</button></div></section>' +
        '<div class="rv-fields" id="rv-rulefields">' +
          '<div class="rv-field"><label>规则类型<span class="rv-lh">可粘贴整行，回车后自动识别</span></label>' +
            '<div class="rv-seg" id="rv-type">' +
              '<button type="button" data-t="domain" class="on">域名（含子域）</button>' +
              '<button type="button" data-t="full">完整域名</button>' +
              '<button type="button" data-t="keyword">关键字</button>' +
              '<button type="button" data-t="regexp">正则</button>' +
            '</div></div>' +
          '<div class="rv-field"><label id="rv-value-label" for="rv-value">域名</label>' +
            '<input class="rv-inp" id="rv-value" spellcheck="false" autocomplete="off">' +
            '<div class="rv-hint" id="rv-hint"></div></div>' +
          '<div class="rv-field"><label for="rv-note">备注<span class="rv-lh">可留空 · 存成「# 备注：…」贴在规则上一行，只对这条生效</span></label>' +
            '<input class="rv-inp" id="rv-note" placeholder="一句话说明，可留空" autocomplete="off"></div>' +
          '<div class="rv-field"><label for="rv-group">分组<span class="rv-lh">放进某个标题下面，或者移出来单着</span></label>' +
            '<select class="rv-inp" id="rv-group"></select>' +
            '<div class="rv-hint" id="rv-group-hint"></div></div>' +
        '</div>' +
        '<div class="rv-fields" id="rv-grpfields" hidden>' +
          '<div class="rv-field"><label>这一行是<span class="rv-lh">标题=领养下面的规则 · 名单说明=谁都不领养 · 规则备注=贴到下面第一条规则上</span></label>' +
            '<div class="rv-seg" id="rv-grp-role">' +
              '<button type="button" data-r="title">标题</button>' +
              '<button type="button" data-r="doc">名单说明</button>' +
              '<button type="button" data-r="note">规则备注</button>' +
            '</div></div>' +
          '<div class="rv-field"><label for="rv-grp-title">标题<span class="rv-lh">名单里的裸 # 行就是标题，下面的规则都归到它</span></label>' +
            '<input class="rv-inp" id="rv-grp-title" placeholder="例如 腾讯CDN (smtcdns.com - 48-char hex)" autocomplete="off"></div>' +
          '<div class="rv-field"><label for="rv-grp-notes">注释<span class="rv-lh">可留空 · 一行一条，存成 # 注释：… 这种带前缀的注释行</span></label>' +
            '<textarea class="rv-inp rv-area" id="rv-grp-notes" rows="3" spellcheck="false" placeholder="例如 注意: 已将长度修正为精确的 {59}"></textarea>' +
            '<div class="rv-hint" id="rv-grp-hint">保存后这一组下面已有的规则不变，仍由它们的位置决定</div></div>' +
        '</div>' +
        '<div class="rv-foot"><button class="button primary" id="rv-ok">应用到名单</button>' +
        '<button class="button" id="rv-cancel">取消</button></div>' +
      '</aside>');
    scrimEl = document.getElementById('rv-scrim');
    sheetEl = document.getElementById('rv-sheet');
    var sv = sheetEl;sv.inert=true;sv.setAttribute('aria-hidden','true');
    sv.querySelector('#rv-value').setAttribute('aria-describedby','rv-hint');
    sv.querySelector('[data-rv-continue]').onclick=function(){pendingLeave=null;sv.querySelector('.rv-discard-prompt').hidden=true;scheduleFocus(groupMode?'#rv-grp-title':'#rv-value');};
    sv.querySelector('[data-rv-discard]').onclick=function(){var next=pendingLeave;closeSheet(true);if(next)next();};
    sv.querySelector('#rv-type').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      rawMode = false;                                   /* 手动选了类型就按类型写 */
      setType(b.dataset.t, ''); paint();
      sv.querySelector('#rv-value').focus();
    };
    sv.querySelector('#rv-value').addEventListener('input', function () { armedEnter = false; paint(); });
    sv.querySelector('#rv-note').addEventListener('input', function () { paint(); });
    sv.querySelector('#rv-note').addEventListener('keydown', function (e) {
      if(e.isComposing||e.keyCode===229)return;
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    sv.querySelector('#rv-value').addEventListener('keydown', function (e) {
      if(e.isComposing||e.keyCode===229)return;
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { commit(); return; }
      if (armedEnter || !recognize()) { armedEnter = false; commit(); }
      else { armedEnter = true; hint('已识别为「' + (rawMode?'原文':NAME[curType()]) + '」 · <span class="mono">' + esc(linePreview()) + '</span> · 再按一次回车应用到名单', 'hit'); }
    });
    sv.querySelector('#rv-ok').onclick = commit;
    sv.querySelector('#rv-cancel').onclick = function () { closeSheet(); };
    sv.querySelector('#rv-close').onclick = function () { closeSheet(); };
    sv.querySelector('#rv-del').onclick = function () {
      if (groupMode) { var g = editingGroup; if (!g) { closeSheet(true); return; } dropGroup(g); return; }
      var r = editing; if (!r) return; if (!window.confirm('删除这条规则？\n' + lineOf(r))) return; closeSheet(true); dropRow(r,true);
    };
    scrimEl.onclick = function () { closeSheet(); };
    /* 面板里 Tab 在面板内循环，不要跑回页面后面 */
    sv.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = sv.querySelectorAll('button, input, textarea, select');
      var list = Array.prototype.filter.call(f, function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    /* 只有站点真的保存成功（会调 LocalDNSInterface.ruleSaved）才把「有未保存修改」清掉；
       以前用 700ms 定时器，保存失败也会被误清，用户就以为存上了 */
    hookSaved();
    if (save) save.addEventListener('click', function () { setTimeout(hookSaved, 400); });
    /* 原文模式里手改也要进历史，切回列表才不会丢 */
    var rawTimer = null;
    textarea.addEventListener('input', function () {
      if (view !== 'raw') return;
      setDirty(textarea.value !== savedText);
      clearTimeout(rawTimer);
      rawTimer = setTimeout(function () { commitHist(textarea.value); }, 600);
    });
  }

  function enhance() {
    hookSaved();
    var editor = document.querySelector('.rule-editor');
    var textarea = document.getElementById('rule-text');
    if (!editor || !textarea || textarea.dataset.original === undefined || document.getElementById('rv-root')) return;
    build(editor, textarea, document.getElementById('rule-save'));
  }
  /* ---------- 与定稿对齐的外层改动 ---------- */
  function decorate() {
    var editor = document.querySelector('.rule-editor');
    if (!editor || !document.getElementById('rv-root')) return;
    /* 压平层级：标题行（名单名 + 说明 + 按钮）并进工具条，只留「胶囊 / 工具条 / 表头」三层 */
    var head = editor.querySelector('.section-header');
    if (head) {
      var bar = root.querySelector('.rv-toolbar');
      var acts = head.querySelector('.section-header-actions');
      if (bar && acts) bar.appendChild(acts);
      var state = editor.querySelector('.console-rule-state');
      if (bar && state) bar.appendChild(state);
      head.remove();
      var stat = root.querySelector('#rv-stat');
      if (stat && !stat.title) stat.title = '左边拖动可排序 · 每行开关单独启停 · 点域名或铅笔打开编辑';
    }
    /* 统计（共 N 条 · 停用 N · 分组 N · 有未保存修改）挪到列表下面的页脚，
       工具条只留控件，不再挤一长排 */
    var foot = editor.querySelector('.rule-editor-footer');
    if (foot) {
      var st = document.getElementById('rv-stat');
      if (!st) { st = document.createElement('span'); st.id = 'rv-stat'; st.className = 'rv-stat'; }
      if (st.parentNode !== foot) foot.appendChild(st);
      renderStat();                                   /* 刚挂上去是空的，立刻补一次内容 */
    }
    var dl = document.getElementById('rule-download');
    if (dl && dl.dataset.rvRenamed !== '1') {
      dl.dataset.rvRenamed = '1';
      dl.innerHTML = dl.innerHTML.replace(/下载列表/, '导出');
    }
    if (dl) dl.classList.add('rv-ghost');
    loadCounts();
  }
  /* 名单胶囊后面的条数已撤掉（用户：感觉鸡肋）。不再逐个名单拉接口填数字，
     条数看列表下方的页脚统计就够，也省掉 11 个并发请求。 */
  function paintCounts() { }
  function loadCounts() { }
  /* 批量粘贴：一行一条，自动认前缀、# 当停用，重复的跳过 */
  function openPaste() {
    var wrap = document.getElementById('rp-wrap');
    if (!wrap) {
      document.body.insertAdjacentHTML('beforeend',
        '<dialog class="rp-wrap" id="rp-wrap" aria-label="批量粘贴"><div class="rp-panel">' +
          '<h2>批量粘贴</h2>' +
          '<p>一行一条，可直接贴线上原文（支持 domain: / full: / keyword: / regexp: 前缀，<code>#</code> 开头按停用）；与现有规则重复的会自动跳过。</p>' +
          '<textarea id="rp-text" aria-label="批量规则原文" spellcheck="false" placeholder="domain:example.com&#10;full:stun.l.google.com&#10;keyword:kaspersky"></textarea>' +
          '<div class="rp-foot"><button class="button primary" id="rp-ok">追加到列表</button>' +
          '<button class="button" id="rp-cancel">取消</button><span class="grow"></span>' +
          '<span class="rp-note" id="rp-note"></span></div></div></dialog>');
      wrap = document.getElementById('rp-wrap');
      wrap.addEventListener('click', function (e) { if (e.target === wrap) closePaste(); });
      wrap.querySelector('#rp-text').addEventListener('input', pastePreview);
      wrap.querySelector('#rp-cancel').onclick = closePaste;
      wrap.querySelector('#rp-ok').onclick = doPaste;
    }
    if(!wrap.open)wrap.showModal();
    var t = wrap.querySelector('#rp-text');
    t.value = '';
    pastePreview();
    t.focus();
  }
  function parsePaste(text) {
    return parse(text).filter(function(r){return r.kind !== 'blank';});
  }
  function closePaste() { var wrap=document.getElementById('rp-wrap');if(wrap&&wrap.open)wrap.close(); }
  function pastedRows() {
    var input=document.getElementById('rp-text'),list=parsePaste(input?input.value:''),seen=new Set();
    function key(r){return r.kind+'|'+r.type+'|'+r.value;}
    rows.forEach(function(r){if(r.kind==='rule'||r.kind==='raw')seen.add(key(r));});
    var unique=list.filter(function(r){if(r.kind!=='rule'&&r.kind!=='raw')return true;var k=key(r);if(seen.has(k))return false;seen.add(k);return true;});
    return {rows:unique,duplicates:list.length-unique.length};
  }
  function pastePreview() {
    var result=pastedRows(),label=document.getElementById('rp-note');
    label.textContent=result.rows.length||result.duplicates?'将追加 '+result.rows.length+' 行'+(result.duplicates?' · 跳过重复 '+result.duplicates+' 条规则':''):'';
  }
  function doPaste() {
    var result=pastedRows();
    if(!result.rows.length){closePaste();say('没有可追加的内容');return;}
    rows=rows.concat(result.rows);writeBack();renderList();closePaste();say('已追加 '+result.rows.length+' 行（记得点保存）');
  }
  function canLeave(next) {
    if(!root||!root.isConnected)return true;
    if(sheetEl&&sheetEl.classList.contains('show')){
      if(isDirtySheet()){showDiscardPrompt(next);return false;}
      closeSheet(true);
    }
    var paste=document.getElementById('rp-wrap');
    if(paste&&paste.open){if(paste.querySelector('#rp-text').value.trim()&&!confirm('批量粘贴尚未加入名单，放弃并离开吗？'))return false;closePaste();}
    return true;
  }
  /* 站点重绘会把我们插进去的整个面板换掉，这时挂在 body 上的遮罩/面板要跟着收走 */
  function tick() {
    if (root && !document.body.contains(root)) {
      /* 站点把整块面板换掉了：开着的编辑面板、浮层菜单也要一起收走，别再挂着孤儿节点 */
      if (sheetEl && sheetEl.classList.contains('show')) { try { closeSheet(true); } catch (e) { } }
      closePaste();var paste=document.getElementById('rp-wrap');if(paste)paste.remove();
      sheetEl = scrimEl = null;
      try { closeRowMenu(); closeNewMenu(); } catch (e) { }
    }
    Array.prototype.forEach.call(document.querySelectorAll('#rv-scrim, #rv-sheet'), function (n) {
      if (!n.classList.contains('show') && (!root || !document.body.contains(root))) n.remove();
    });
    enhance();
    decorate();
  }
  /* 让整页正好一屏：按列表上方已有的高度，把列表高度收到视口内，页面就不出现滚动条 */
  function fitList() {
    var list = root && root.querySelector('.rv-list');
    if (!list) return;
    var top = list.getBoundingClientRect().top + window.scrollY;
    var avail = Math.round(window.innerHeight - top - 56);
    if (avail < 200) avail = 200;
    if (avail > 660) avail = 660;
    if (Math.abs(avail - list.getBoundingClientRect().height) > 4) list.style.height = avail + 'px';
  }
  window.addEventListener('beforeunload',function(e){var paste=document.getElementById('rp-wrap');if((sheetEl&&sheetEl.classList.contains('show')&&isDirtySheet())||(paste&&paste.open&&paste.querySelector('#rp-text').value.trim())){e.preventDefault();e.returnValue='';}});
  window.LocalDNSRules = {canLeave:canLeave,refreshText:function(){
    if(!ta || !ta.isConnected || !root || !root.isConnected)return;
    rows=parse(ta.value);sel=[];q='';
    var query=root.querySelector('#rv-q');if(query)query.value='';
    commitHist(ta.value);setDirty(ta.value!==savedText);syncSiteState();renderList();paintSearch();
  }};
  bindGlobal();
  tick();
  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(fitList, 150); });
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;                       /* 同一帧只处理一次，避免自我触发堆积 */
    pending = true;
    try { paintCounts(); tick(); } catch (e) { }   /* 同步补条数：赶在浏览器绘制之前 */
    requestAnimationFrame(function () { pending = false; try { tick(); fitList(); } catch (e) { } });
  }).observe(document.getElementById('page-content') || document.body, { childList: true, subtree: true });
})();
