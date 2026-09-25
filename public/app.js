/*
 * LineTrans 网页翻译台
 * 与安卓客户端 / 独立服务端（line-trans-web）共用同一套 API：
 *   GET  api/info | api/docs | api/doc?id=ID
 *   POST api/unit  { docId, index, translation?, source?, done?, starred? }
 *   POST api/doc   { docId, name?, folder?, pinned?, unitMode? }
 *   POST api/ai    { docId, index }
 *   GET  api/export?id=ID&format=txt_bilingual
 */
(function () {
  'use strict';

  var TOKEN = new URLSearchParams(location.search).get('token') || '';
  var THEME_KEY = 'lt-theme';
  var state = {
    info: null,
    docs: [],
    doc: null,
    filter: 'all',
    query: '',
    docQuery: '',
    current: -1,
    saving: 0,
    batch: { running: false, stop: false, done: 0, total: 0 }
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------------- 主题 ----------------

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    Array.prototype.forEach.call(document.querySelectorAll('#themeCards .theme-card'), function (card) {
      card.classList.toggle('active', card.dataset.theme === theme);
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var dark = theme === 'dark' ||
        (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      meta.setAttribute('content', dark ? '#000000' : '#ffffff');
    }
  }

  function initTheme() {
    var saved = 'system';
    try { saved = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { /* ignore */ }
    applyTheme(saved);
  }

  // ---------------- 请求 ----------------

  function api(path, options) {
    var url = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(url, options).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error(t || ('HTTP ' + res.status)); });
      }
      var type = res.headers.get('content-type') || '';
      return type.indexOf('application/json') >= 0 ? res.json() : res.text();
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function setConn(text, ok) {
    var el = $('connState');
    el.textContent = text;
    el.className = 'pill' + (ok ? ' on' : '');
  }

  function pct(done, total) { return total ? Math.round(done * 100 / total) : 0; }

  // ---------------- 文档列表 ----------------

  function renderDocs() {
    var list = $('docList');
    var q = state.docQuery.toLowerCase();
    var docs = state.docs.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0; });
    list.innerHTML = '';
    if (!docs.length) {
      list.innerHTML = '<div class="muted" style="padding:12px">没有文档</div>';
      return;
    }
    docs.forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'doc-item' + (state.doc && state.doc.id === d.id ? ' active' : '');
      el.innerHTML =
        '<div class="doc-name">' + (d.pinned ? '📌 ' : '') + '<span></span></div>' +
        '<div class="doc-sub"><span class="folder"></span><span class="p"></span></div>' +
        '<div class="mini-progress"><i></i></div>';
      el.querySelector('.doc-name span').textContent = d.name;
      el.querySelector('.folder').textContent = d.folder || '默认';
      el.querySelector('.p').textContent = d.done + ' / ' + d.total + ' · ' + pct(d.done, d.total) + '%';
      el.querySelector('.mini-progress > i').style.width = pct(d.done, d.total) + '%';
      el.addEventListener('click', function () { openDoc(d.id); });
      list.appendChild(el);
    });
  }

  // ---------------- 文档内容 ----------------

  function openDoc(id) {
    api('api/doc?id=' + encodeURIComponent(id)).then(function (doc) {
      state.doc = doc;
      state.current = -1;
      renderDocs();
      renderDoc();
      setConn('已连接', true);
      $('scrollArea').scrollTop = 0;
    }).catch(function (e) { toast('打开失败：' + e.message); });
  }

  function updateProgress() {
    if (!state.doc) return;
    var p = pct(state.doc.done, state.doc.total);
    $('progressBar').style.width = p + '%';
    $('progressText').textContent = state.doc.done + ' / ' + state.doc.total + ' · ' + p + '%';
    $('btnMode').textContent = state.doc.unitMode === 'SENTENCE' ? '逐句' : '逐行';
    var remaining = state.doc.total - state.doc.done;
    var canTranslate = !!(state.info && state.info.canTranslate);
    if (state.batch.running) {
      $('btnBatch').textContent = '停止（' + state.batch.done + '/' + state.batch.total + '）';
      $('btnBatch').disabled = false;
    } else if (!canTranslate) {
      $('btnBatch').textContent = '未配置模型';
      $('btnBatch').disabled = true;
      $('btnBatch').title = '请先在服务端配置 provider.baseUrl / apiKey / model（手机端：设置 → AI 翻译）';
    } else {
      $('btnBatch').textContent = 'AI 翻译剩余 ' + remaining;
      $('btnBatch').disabled = remaining === 0;
      $('btnBatch').title = '';
    }
  }

  function visibleUnits() {
    if (!state.doc) return [];
    var q = state.query.toLowerCase();
    return state.doc.units.filter(function (u) {
      if (state.filter === 'todo' && u.done) return false;
      if (state.filter === 'star' && !u.starred) return false;
      if (q && (u.source + ' ' + u.translation).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderDoc() {
    var doc = state.doc;
    if (!doc) return;
    $('docTitle').textContent = doc.name;
    $('docSub').textContent = (doc.folder || '默认') + ' · ' +
      (doc.unitMode === 'SENTENCE' ? '逐句' : '逐行') +
      (state.info && state.info.provider ? ' · 模型：' + state.info.provider : ' · 未配置模型');
    $('subbar').hidden = false;
    $('dock').hidden = false;
    $('emptyState').hidden = true;
    $('btnMode').disabled = false;
    $('btnExport').disabled = false;
    updateProgress();

    var units = visibleUnits();
    $('unitCount').textContent = '显示 ' + units.length + ' / ' + doc.total;

    var editor = $('editor');
    editor.innerHTML = '';
    units.forEach(function (u) { editor.appendChild(renderRow(u)); });
  }

  function renderRow(u) {
    var row = document.createElement('div');
    row.className = 'row' + (state.current === u.i ? ' current' : '');
    row.dataset.index = u.i;

    var head = document.createElement('div');
    head.className = 'row-head';
    var pill = document.createElement('span');
    pill.className = 'index-pill';
    pill.textContent = (u.i + 1);
    var dot = document.createElement('span');
    dot.className = 'dot' + (u.done ? ' done' : '');
    var star = document.createElement('button');
    star.className = 'star' + (u.starred ? ' on' : '');
    star.textContent = u.starred ? '★' : '☆';
    star.title = '收藏';
    star.addEventListener('click', function () { saveUnit(u.i, { starred: !u.starred }); });
    var spacer = document.createElement('span');
    spacer.className = 'spacer';
    var copyBtn = document.createElement('button');
    copyBtn.className = 'tool';
    copyBtn.textContent = '复制';
    var aiBtn = document.createElement('button');
    aiBtn.className = 'tool';
    aiBtn.textContent = 'AI 翻译';
    head.appendChild(pill);
    head.appendChild(dot);
    head.appendChild(star);
    head.appendChild(spacer);
    head.appendChild(copyBtn);
    head.appendChild(aiBtn);

    var source = document.createElement('div');
    source.className = 'source';
    source.textContent = u.source;
    source.title = '双击可修改原文';
    source.addEventListener('dblclick', function () { editSource(u, source); });

    var wrap = document.createElement('div');
    wrap.className = 'translation-wrap';
    var ta = document.createElement('textarea');
    ta.className = 'translation';
    ta.value = u.translation || '';
    ta.placeholder = '在这里输入译文…';
    ta.spellcheck = false;
    var timer = null;
    ta.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { saveUnit(u.i, { translation: ta.value }); }, 500);
    });
    ta.addEventListener('focus', function () { state.current = u.i; highlight(); });
    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ta.blur(); gotoRelative(u.i, 1); }
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); gotoRelative(u.i, 1); }
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); gotoRelative(u.i, -1); }
    });
    wrap.appendChild(ta);

    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(ta.value || u.source).then(function () { toast('已复制'); });
    });
    aiBtn.addEventListener('click', function () { aiTranslate(u.i, aiBtn); });

    row.appendChild(head);
    row.appendChild(source);
    row.appendChild(wrap);
    return row;
  }

  function editSource(u, box) {
    var ta = document.createElement('textarea');
    ta.className = 'source-edit';
    ta.value = u.source;
    var commit = function () {
      var text = ta.value;
      if (text === u.source) { restore(); return; }
      api('api/unit', { method: 'POST', body: JSON.stringify({ docId: state.doc.id, index: u.i, source: text }) })
        .then(function () { u.source = text; restore(); })
        .catch(function (e) { toast('保存原文失败：' + e.message); });
    };
    var restore = function () {
      box.textContent = u.source;
      box.style.display = '';
      if (ta.parentNode) ta.remove();
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { ta.value = u.source; ta.blur(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') ta.blur();
    });
    box.style.display = 'none';
    box.parentNode.insertBefore(ta, box.nextSibling);
    ta.focus();
  }

  function highlight() {
    Array.prototype.forEach.call(document.querySelectorAll('.row'), function (row) {
      row.classList.toggle('current', Number(row.dataset.index) === state.current);
    });
  }

  function gotoRelative(index, delta) {
    var units = visibleUnits();
    var pos = units.findIndex(function (u) { return u.i === index; });
    var next = units[pos + delta];
    if (!next) return;
    state.current = next.i;
    highlight();
    var row = document.querySelector('.row[data-index="' + next.i + '"]');
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var ta = row.querySelector('textarea.translation');
      if (ta) ta.focus();
    }
  }

  // ---------------- 保存 / AI ----------------

  function saveUnit(index, patch) {
    var body = Object.assign({ docId: state.doc.id, index: index }, patch);
    state.saving++;
    return api('api/unit', { method: 'POST', body: JSON.stringify(body) })
      .then(function (res) {
        applyLocal(index, patch);
        if (res && typeof res.done === 'number') {
          state.doc.done = res.done;
          state.doc.total = res.total;
        }
        updateProgress();
        updateDocSummary();
        return res;
      })
      .catch(function (e) { toast('保存失败：' + e.message); })
      .finally(function () { state.saving--; });
  }

  function updateDocSummary() {
    if (!state.doc) return;
    var item = state.docs.find(function (d) { return d.id === state.doc.id; });
    if (!item) return;
    item.done = state.doc.done;
    item.total = state.doc.total;
    renderDocs();
  }

  function applyLocal(index, patch) {
    var unit = state.doc.units.find(function (u) { return u.i === index; });
    if (!unit) return;
    if (typeof patch.translation === 'string') unit.translation = patch.translation;
    if (typeof patch.source === 'string') unit.source = patch.source;
    if (typeof patch.starred === 'boolean') unit.starred = patch.starred;
    if (typeof patch.done === 'boolean') unit.done = patch.done;
    unit.done = unit.done || !!unit.translation.trim();
    var row = document.querySelector('.row[data-index="' + index + '"]');
    if (row) {
      var dot = row.querySelector('.dot');
      if (dot) dot.className = 'dot' + (unit.done ? ' done' : '');
      var star = row.querySelector('.star');
      if (star) { star.textContent = unit.starred ? '★' : '☆'; star.className = 'star' + (unit.starred ? ' on' : ''); }
    }
  }

  function aiTranslate(index, button) {
    if (button) { button.disabled = true; button.textContent = '翻译中…'; }
    return api('api/ai', { method: 'POST', body: JSON.stringify({ docId: state.doc.id, index: index }) })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '翻译失败');
        var unit = state.doc.units.find(function (u) { return u.i === index; });
        unit.translation = res.text;
        unit.done = true;
        if (typeof res.done === 'number') { state.doc.done = res.done; state.doc.total = res.total; }
        updateProgress();
        updateDocSummary();
        var row = document.querySelector('.row[data-index="' + index + '"]');
        if (row) {
          var ta = row.querySelector('textarea.translation');
          if (ta) ta.value = res.text;
          var dot = row.querySelector('.dot');
          if (dot) dot.className = 'dot done';
        }
        if (res.cost) toast('已翻译（≈' + Number(res.cost).toFixed(4) + ' 元）');
        return res;
      })
      .catch(function (e) { toast('AI 翻译失败：' + e.message); })
      .finally(function () {
        if (button) { button.disabled = false; button.textContent = 'AI 翻译'; }
      });
  }

  function runBatch() {
    if (state.batch.running) { state.batch.stop = true; return; }
    if (!state.info || !state.info.canTranslate) {
      toast('还没有配置 AI 模型，无法批量翻译');
      return;
    }
    var pending = state.doc.units.filter(function (u) { return !u.done; });
    if (!pending.length) { toast('没有待翻译内容'); return; }
    state.batch = { running: true, stop: false, done: 0, total: pending.length };
    updateProgress();
    (function next(i) {
      if (state.batch.stop || i >= pending.length) {
        var stopped = state.batch.stop;
        state.batch.running = false;
        updateProgress();
        toast(stopped ? '已停止批量翻译' : '批量翻译完成');
        return;
      }
      aiTranslate(pending[i].i, null).then(function (res) {
        if (!res || res.ok === false) {
          // 出错就停下来，避免一路报错刷屏
          state.batch.running = false;
          updateProgress();
          return;
        }
        state.batch.done++;
        updateProgress();
        next(i + 1);
      });
    })(0);
  }

  // ---------------- 设置弹窗 ----------------

  function openSettings() {
    $('settingsMask').hidden = false;
    $('infoMode').textContent = state.info ? (state.info.mode || '—') : '—';
    $('infoVersion').textContent = state.info ? state.info.version : '—';
    $('infoModel').textContent = state.info && state.info.provider ? state.info.provider : '未配置';
    $('infoLang').textContent = state.info ? state.info.targetLang : '—';
    $('infoDocs').textContent = state.docs.length + ' 篇';
    $('infoToken').textContent = TOKEN ? '已启用' : '未设置';
  }

  function closeSettings() { $('settingsMask').hidden = true; }

  function bind() {
    $('docSearch').addEventListener('input', function (e) { state.docQuery = e.target.value; renderDocs(); });
    $('unitSearch').addEventListener('input', function (e) { state.query = e.target.value; renderDoc(); });
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
      chip.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        state.filter = chip.dataset.filter;
        renderDoc();
      });
    });
    $('btnBatch').addEventListener('click', runBatch);
    $('btnExport').addEventListener('click', function () {
      if (!state.doc) return;
      window.open('api/export?id=' + encodeURIComponent(state.doc.id) +
        '&format=txt_bilingual&token=' + encodeURIComponent(TOKEN), '_blank');
    });
    $('btnMode').addEventListener('click', function () {
      if (!state.doc) return;
      var next = state.doc.unitMode === 'SENTENCE' ? 'LINE' : 'SENTENCE';
      api('api/doc', { method: 'POST', body: JSON.stringify({ docId: state.doc.id, unitMode: next }) })
        .then(function () { openDoc(state.doc.id); toast('已切换为' + (next === 'SENTENCE' ? '逐句' : '逐行')); })
        .catch(function (e) { toast('切换失败：' + e.message); });
    });

    $('btnSettings').addEventListener('click', openSettings);
    $('btnCloseSettings').addEventListener('click', closeSettings);
    $('settingsMask').addEventListener('click', function (e) {
      if (e.target === $('settingsMask')) closeSettings();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSettings();
    });
    Array.prototype.forEach.call(document.querySelectorAll('#themeCards .theme-card'), function (card) {
      card.addEventListener('click', function () { applyTheme(card.dataset.theme); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#settingsNav button'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#settingsNav button'), function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        ['general', 'conn', 'about'].forEach(function (name) {
          $('pane-' + name).hidden = name !== btn.dataset.pane;
        });
      });
    });
    window.addEventListener('beforeunload', function (e) {
      if (state.saving > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---------------- 启动 ----------------

  initTheme();
  bind();

  api('api/info').then(function (info) {
    state.info = info;
    $('serverInfo').textContent = (info.mode || '网页翻译台') + ' · v' + info.version;
    if (info.targetLang) $('dockHint').textContent = '目标语言 ' + info.targetLang + ' · 输入即自动保存';
    setConn('已连接', true);
    return api('api/docs');
  }).then(function (res) {
    state.docs = res.docs || [];
    renderDocs();
    if (state.docs.length) openDoc(state.docs[0].id);
  }).catch(function (e) {
    setConn('连接失败', false);
    toast('无法连接服务：' + e.message + '（若手机端设置了访问令牌，请在网址后加 ?token=你的令牌）');
  });
})();
