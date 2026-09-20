/*
 * LineTrans 网页翻译台
 * 与 Android 客户端 / 独立 Node 服务端共用同一套 API：
 *   GET  api/info
 *   GET  api/docs
 *   GET  api/doc?id=ID
 *   POST api/unit   { docId, index, translation?, done?, starred? }
 *   POST api/doc    { docId, name?, folder?, unitMode? }
 *   POST api/ai     { docId, index }
 *   GET  api/export?id=ID&format=txt_bilingual
 */
(function () {
  'use strict';

  var TOKEN = new URLSearchParams(location.search).get('token') || '';
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

  // ---------- 文档列表 ----------

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
      el.querySelector('span').textContent = d.name;
      el.querySelector('.folder').textContent = d.folder || '默认';
      el.querySelector('.p').textContent = d.done + ' / ' + d.total + ' · ' + pct(d.done, d.total) + '%';
      el.querySelector('.mini-progress > i').style.width = pct(d.done, d.total) + '%';
      el.addEventListener('click', function () { openDoc(d.id); });
      list.appendChild(el);
    });
  }

  // ---------- 文档内容 ----------

  function openDoc(id) {
    api('api/doc?id=' + encodeURIComponent(id)).then(function (doc) {
      state.doc = doc;
      state.current = -1;
      renderDocs();
      renderDoc();
      setConn('已连接', true);
    }).catch(function (e) { toast('打开失败：' + e.message); });
  }

  function updateProgress() {
    if (!state.doc) return;
    var bar = $('progressBar');
    var p = pct(state.doc.done, state.doc.total);
    bar.style.width = p + '%';
    $('progressText').textContent = state.doc.done + ' / ' + state.doc.total + ' · ' + p + '%';
    $('btnMode').textContent = state.doc.unitMode === 'SENTENCE' ? '逐句' : '逐行';
    var remaining = state.doc.total - state.doc.done;
    $('btnBatch').textContent = state.batch.running
      ? '停止（' + state.batch.done + '/' + state.batch.total + '）'
      : 'AI 翻译剩余 ' + remaining;
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
    $('docSub').textContent = (doc.folder || '默认') + ' · ' + (doc.unitMode === 'SENTENCE' ? '逐句' : '逐行') +
      (state.info && state.info.provider ? ' · 模型服务：' + state.info.provider : ' · 未配置模型');
    $('progressWrap').hidden = false;
    $('filters').hidden = false;
    $('emptyState').hidden = true;
    $('btnMode').disabled = false;
    $('btnBatch').disabled = false;
    $('btnExport').disabled = false;
    updateProgress();

    var units = visibleUnits();
    $('unitCount').textContent = '显示 ' + units.length + ' / ' + doc.total;

    var editor = $('editor');
    editor.innerHTML = '';
    units.forEach(function (u) { editor.appendChild(renderRow(u)); });
  }

  function rowStatus(u) { return u.done ? 'done' : ''; }

  function renderRow(u) {
    var row = document.createElement('div');
    row.className = 'row' + (state.current === u.i ? ' current' : '');
    row.dataset.index = u.i;

    var indexCell = document.createElement('div');
    indexCell.className = 'row-index';
    indexCell.innerHTML = '<div class="dot ' + rowStatus(u) + '"></div><span>' + (u.i + 1) + '</span>';
    var star = document.createElement('button');
    star.className = 'star' + (u.starred ? ' on' : '');
    star.textContent = u.starred ? '★' : '☆';
    star.title = '收藏';
    star.addEventListener('click', function () { saveUnit(u.i, { starred: !u.starred }); });
    indexCell.appendChild(star);

    var sourceCell = document.createElement('div');
    sourceCell.className = 'cell';
    sourceCell.appendChild(buildSource(u));

    var translationCell = document.createElement('div');
    translationCell.className = 'cell translation-cell';
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

    var tools = document.createElement('div');
    tools.className = 'row-tools';
    var aiBtn = document.createElement('button');
    aiBtn.className = 'icon-btn';
    aiBtn.textContent = 'AI';
    aiBtn.title = '用已配置的模型翻译这一句';
    aiBtn.addEventListener('click', function () { aiTranslate(u.i, aiBtn); });
    var copyBtn = document.createElement('button');
    copyBtn.className = 'icon-btn';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(ta.value || '').then(function () { toast('已复制译文'); });
    });
    tools.appendChild(aiBtn);
    tools.appendChild(copyBtn);
    wrap.appendChild(tools);
    translationCell.appendChild(wrap);

    row.appendChild(indexCell);
    row.appendChild(sourceCell);
    row.appendChild(translationCell);
    return row;
  }

  function buildSource(u) {
    var box = document.createElement('div');
    box.className = 'source';
    box.textContent = u.source;
    box.title = '双击可修改原文';
    box.addEventListener('dblclick', function () {
      var ta = document.createElement('textarea');
      ta.className = 'source-edit';
      ta.value = u.source;
      ta.addEventListener('blur', function () {
        var text = ta.value;
        api('api/unit', { method: 'POST', body: JSON.stringify({ docId: state.doc.id, index: u.i, source: text }) })
          .then(function () { u.source = text; box.textContent = text; box.style.display = ''; if (ta.parentNode) ta.remove(); })
          .catch(function (e) { toast('保存原文失败：' + e.message); });
      });
      box.style.display = 'none';
      box.parentNode.insertBefore(ta, box.nextSibling);
      ta.focus();
    });
    return box;
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

  // ---------- 保存 / AI ----------

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
        return res;
      })
      .catch(function (e) { toast('保存失败：' + e.message); })
      .finally(function () { state.saving--; });
  }

  function applyLocal(index, patch) {
    var unit = state.doc.units.find(function (u) { return u.i === index; });
    if (!unit) return;
    if (typeof patch.translation === 'string') unit.translation = patch.translation;
    if (typeof patch.source === 'string') unit.source = patch.source;
    if (typeof patch.starred === 'boolean') unit.starred = patch.starred;
    if (typeof patch.done === 'boolean') unit.done = patch.done;
    unit.done = unit.done || !!unit.translation.trim();
    if (state.filter !== 'all' || state.query) renderDoc();
    else {
      var row = document.querySelector('.row[data-index="' + index + '"]');
      if (row) {
        var dot = row.querySelector('.dot');
        if (dot) dot.className = 'dot ' + (unit.done ? 'done' : '');
        var star = row.querySelector('.star');
        if (star) { star.textContent = unit.starred ? '★' : '☆'; star.className = 'star' + (unit.starred ? ' on' : ''); }
      }
    }
  }

  function aiTranslate(index, button) {
    if (button) { button.disabled = true; button.textContent = '…'; }
    return api('api/ai', { method: 'POST', body: JSON.stringify({ docId: state.doc.id, index: index }) })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '翻译失败');
        var unit = state.doc.units.find(function (u) { return u.i === index; });
        unit.translation = res.text;
        unit.done = true;
        state.doc.done = res.done;
        updateProgress();
        var row = document.querySelector('.row[data-index="' + index + '"]');
        if (row) {
          var ta = row.querySelector('textarea.translation');
          if (ta) { ta.value = res.text; }
          var dot = row.querySelector('.dot');
          if (dot) dot.className = 'dot done';
        }
        if (res.cost) toast('已翻译（≈' + Number(res.cost).toFixed(4) + ' 元）');
        return res;
      })
      .catch(function (e) { toast('AI 翻译失败：' + e.message); })
      .finally(function () {
        if (button) { button.disabled = false; button.textContent = 'AI'; }
      });
  }

  function runBatch() {
    if (state.batch.running) { state.batch.stop = true; return; }
    var pending = state.doc.units.filter(function (u) { return !u.done; });
    if (!pending.length) { toast('没有待翻译内容'); return; }
    state.batch = { running: true, stop: false, done: 0, total: pending.length };
    updateProgress();
    (function next(i) {
      if (state.batch.stop || i >= pending.length) {
        state.batch.running = false;
        updateProgress();
        toast(state.batch.stop ? '已停止批量翻译' : '批量翻译完成');
        return;
      }
      aiTranslate(pending[i].i, null).then(function () {
        state.batch.done++;
        updateProgress();
        next(i + 1);
      });
    })(0);
  }

  // ---------- 事件绑定 ----------

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
      var url = 'api/export?id=' + encodeURIComponent(state.doc.id) + '&format=txt_bilingual&token=' + encodeURIComponent(TOKEN);
      window.open(url, '_blank');
    });
    $('btnMode').addEventListener('click', function () {
      if (!state.doc) return;
      var next = state.doc.unitMode === 'SENTENCE' ? 'LINE' : 'SENTENCE';
      api('api/doc', { method: 'POST', body: JSON.stringify({ docId: state.doc.id, unitMode: next }) })
        .then(function () { openDoc(state.doc.id); toast('已切换为' + (next === 'SENTENCE' ? '逐句' : '逐行')); })
        .catch(function (e) { toast('切换失败：' + e.message); });
    });
    window.addEventListener('beforeunload', function (e) {
      if (state.saving > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---------- 启动 ----------

  api('api/info').then(function (info) {
    state.info = info;
    $('serverInfo').textContent = info.name + ' · ' + info.version + (info.mode ? '（' + info.mode + '）' : '');
    if (info.targetLang) $('docSub').textContent = '目标语言：' + info.targetLang;
    setConn('已连接', true);
    return api('api/docs');
  }).then(function (res) {
    state.docs = res.docs || [];
    renderDocs();
    if (state.docs.length) openDoc(state.docs[0].id);
  }).catch(function (e) {
    setConn('连接失败', false);
    toast('无法连接服务：' + e.message +
      '（若手机端设置了访问令牌，请在网址后加 ?token=你的令牌）');
  });

  bind();
})();
