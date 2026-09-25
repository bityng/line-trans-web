#!/usr/bin/env node
/*
 * LineTrans 网页翻译台 · 独立服务端
 *
 * 与安卓客户端（line-trans-android）共用同一套网页界面与 HTTP API：
 *   GET  /                     网页翻译台
 *   GET  /api/info             服务信息
 *   GET  /api/docs             文档列表
 *   GET  /api/doc?id=ID        文档详情（含全部句子）
 *   POST /api/unit             保存单句译文/原文/收藏/完成状态
 *   POST /api/doc              修改文档（名称、文件夹、逐行/逐句）
 *   POST /api/ai               用配置的模型翻译一句
 *   GET  /api/export?id&format 导出对照文本
 *
 * 零依赖，Node 18+ 直接运行：node server.js
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const IMPORT_DIR = path.join(ROOT, 'docs');
const VERSION = '1.5.0';

// 文本清洗/切分用到的正则（在数据初始化前就要能用到）
const TIMECODE = /^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->.*$/;
const INDEX_ONLY = /^\d{1,4}[.、)]?$/;
const MD_PREFIX = /^(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/;

// ---------------- 配置 ----------------

function loadConfig() {
  const file = path.join(ROOT, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('[警告] config.json 解析失败，使用默认配置：', e.message);
    }
  }
  return {
    host: process.env.LT_HOST || cfg.host || '0.0.0.0',
    port: Number(process.env.LT_PORT || cfg.port || 8787),
    token: process.env.LT_TOKEN || cfg.token || '',
    targetLang: cfg.targetLang || 'zh-CN',
    sourceLang: cfg.sourceLang || 'auto',
    detectLanguage: cfg.detectLanguage !== false,
    contextUnits: Number(cfg.contextUnits ?? 3),
    systemPrompt: cfg.systemPrompt || '你是专业翻译。请把用户提供的内容从 {sourceLang} 翻译成 {targetLang}。只输出译文，不要解释，不要添加多余内容，保持原有格式与换行。',
    glossary: cfg.glossary || '',
    provider: cfg.provider || { type: 'openai', baseUrl: '', apiKey: '', model: '' }
  };
}

let config = loadConfig();

// ---------------- 数据 ----------------

function emptyState() {
  return { version: 1, usage: { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 }, docs: [] };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const fresh = emptyState();
    importFolderIfAny(fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!Array.isArray(parsed.docs)) parsed.docs = [];
    if (!parsed.usage) parsed.usage = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    return parsed;
  } catch (e) {
    console.error('[警告] state.json 解析失败，已备份并新建：', e.message);
    fs.copyFileSync(STATE_FILE, STATE_FILE + '.broken-' + Date.now());
    return emptyState();
  }
}

function saveState(next = state) {
  state = next;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/** 首次启动时把 docs/*.txt 导入成文档，方便直接拿本地文本开工。 */
function importFolderIfAny(target) {
  if (!fs.existsSync(IMPORT_DIR)) return;
  const files = fs.readdirSync(IMPORT_DIR).filter((f) => /\.(txt|md|srt|csv)$/i.test(f));
  files.forEach((file) => {
    const raw = fs.readFileSync(path.join(IMPORT_DIR, file), 'utf8');
    const text = smartClean(raw);
    const units = parseUnits(text, 'LINE').map((source) => ({ source, translation: '', done: false, starred: false }));
    target.docs.push({
      id: crypto.randomUUID(),
      name: file.replace(/\.[^.]+$/, ''),
      folder: '默认',
      unitMode: 'LINE',
      sourceText: text,
      pinned: false,
      lastIndex: 0,
      updatedAt: Date.now(),
      units
    });
    console.log('[导入] ' + file + ' → ' + units.length + ' 行');
  });
}

// ---------------- 文本处理（与客户端保持一致） ----------------

function smartClean(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !TIMECODE.test(l) && !INDEX_ONLY.test(l) && !l.startsWith('WEBVTT'))
    .map((l) => l.replace(MD_PREFIX, ''))
    .filter((l) => l)
    .join('\n');
}

function parseUnits(text, mode) {
  if (mode === 'SENTENCE') {
    const re = /[^。！？!?；;.…\n]+[。！？?!；;.…\n]*[”’"'）)]*/g;
    return (text.match(re) || []).map((s) => s.trim()).filter(Boolean);
  }
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function detectLanguage(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (kana > latin) return 'ja';
  if (hangul > latin) return 'ko';
  if (cjk > latin) return 'zh-CN';
  if (latin > cjk) return 'en';
  return 'auto';
}

function glossaryEntries() {
  return (config.glossary || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const sep = l.search(/[=：:\t]/);
      if (sep <= 0) return null;
      const key = l.slice(0, sep).trim();
      const value = l.slice(sep + 1).trim();
      return key && value ? [key, value] : null;
    })
    .filter(Boolean);
}

function buildSystemPrompt(sourceText, docName, mode) {
  const sourceLang = config.detectLanguage ? detectLanguage(sourceText) : config.sourceLang;
  const glossary = glossaryEntries();
  const glossaryBlock = glossary.length
    ? '术语表（必须严格使用以下译法）：\n' + glossary.map(([a, b]) => '- ' + a + ' → ' + b).join('\n')
    : '';
  let prompt = config.systemPrompt
    .replaceAll('{sourceLang}', sourceLang === 'auto' ? '原语言' : sourceLang)
    .replaceAll('{targetLang}', config.targetLang)
    .replaceAll('{docName}', docName)
    .replaceAll('{mode}', mode === 'SENTENCE' ? '逐句' : '逐行');
  prompt = prompt.includes('{glossary}')
    ? prompt.replaceAll('{glossary}', glossaryBlock)
    : glossaryBlock ? prompt + '\n' + glossaryBlock : prompt;
  if (mode === 'SENTENCE') prompt += '\n当前按句翻译，请保证译文是完整通顺的句子。';
  return prompt;
}

function buildUserPrompt(doc, index) {
  const unit = doc.units[index];
  const prev = doc.units
    .slice(Math.max(0, index - Math.max(0, config.contextUnits)))
    .filter((u) => u.translation && u.translation.trim())
    .slice(-Math.max(0, config.contextUnits));
  let out = '文档：' + doc.name + '  |  当前模式：' + (doc.unitMode === 'SENTENCE' ? '逐句' : '逐行') +
    '  |  当前进度：' + (index + 1) + '/' + doc.units.length;
  if (prev.length) {
    out += '  |  前文参考：' + prev.map((u) => '【原文：' + u.source + ' → 译文：' + u.translation + '】').join('');
  }
  out += '  |  待翻译原文：' + unit.source;
  return out;
}

// ---------------- AI 调用 ----------------

// 数据在文本工具函数之后加载：首次启动会用到 smartClean/parseUnits 导入 docs/
let state = loadState();
if (!fs.existsSync(STATE_FILE)) saveState();

async function callModel(system, user) {
  const p = config.provider || {};
  if (!p.baseUrl || !p.model) throw new Error('尚未配置 provider.baseUrl / provider.model（见 config.json）');
  const base = String(p.baseUrl).replace(/\/+$/, '');
  const isAnthropic = p.type === 'anthropic' || base.includes('anthropic.com');
  const url = base.endsWith('/v1') ? base : base + '/v1';

  if (isAnthropic) {
    const res = await fetch(url + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: p.model,
        system,
        max_tokens: p.maxTokens || 4096,
        temperature: p.temperature ?? 0.2,
        messages: [{ role: 'user', content: user }]
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('API 错误 (' + res.status + ')：' + (body?.error?.message || JSON.stringify(body).slice(0, 200)));
    const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return { text, promptTokens: body.usage?.input_tokens || 0, completionTokens: body.usage?.output_tokens || 0, cachedTokens: body.usage?.cache_read_input_tokens || 0 };
  }

  const res = await fetch(url + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (p.apiKey || '') },
    body: JSON.stringify({
      model: p.model,
      temperature: p.temperature ?? 0.2,
      max_tokens: p.maxTokens || 4096,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('API 错误 (' + res.status + ')：' + (body?.error?.message || JSON.stringify(body).slice(0, 200)));
  const message = body.choices?.[0]?.message?.content;
  const text = Array.isArray(message) ? message.map((m) => m.text || '').join('') : (message || '');
  return {
    text: String(text).trim(),
    promptTokens: body.usage?.prompt_tokens || 0,
    completionTokens: body.usage?.completion_tokens || 0,
    cachedTokens: body.usage?.prompt_tokens_details?.cached_tokens || 0
  };
}

function costOf(promptTokens, completionTokens) {
  const p = config.provider || {};
  const input = (promptTokens / 1e6) * (p.inputPrice || 0);
  const output = (completionTokens / 1e6) * (p.outputPrice || 0);
  return input + output;
}

// ---------------- 视图模型 ----------------

const isDone = (u) => !!(u.done || (u.translation && u.translation.trim()));

function docSummary(d) {
  const total = d.units.length;
  const done = d.units.filter(isDone).length;
  return {
    id: d.id,
    name: d.name,
    folder: d.folder || '默认',
    unitMode: d.unitMode,
    total,
    done,
    progress: total ? Math.round(done * 100 / total) : 0,
    pinned: !!d.pinned,
    starred: d.units.filter((u) => u.starred).length,
    updatedAt: d.updatedAt || 0
  };
}

function docDetail(d) {
  const summary = docSummary(d);
  return Object.assign({}, summary, {
    units: d.units.map((u, i) => ({
      i,
      source: u.source,
      translation: u.translation || '',
      done: isDone(u),
      starred: !!u.starred
    }))
  });
}

function findDoc(id) {
  return state.docs.find((d) => d.id === id);
}

function applyMode(doc, target) {
  if (doc.unitMode === target) return;
  const source = doc.sourceText || doc.units.map((u) => u.source).join('\n');
  const old = new Map(doc.units.map((u) => [u.source, u]));
  doc.units = parseUnits(source, target).map((s) => {
    const prev = old.get(s);
    return prev
      ? { source: s, translation: prev.translation || '', done: !!prev.done, starred: !!prev.starred }
      : { source: s, translation: '', done: false, starred: false };
  });
  doc.unitMode = target;
}

function exportText(doc, format) {
  const u = doc.units;
  const esc = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  switch (format) {
    case 'txt_translated':
      return u.map((x) => x.translation).filter((t) => t && t.trim()).join('\n');
    case 'txt_source':
      return u.map((x) => (x.translation && x.translation.trim() ? x.translation : x.source)).join('\n');
    case 'md':
      return ['| # | 原文 | 译文 |', '| --- | --- | --- |']
        .concat(u.map((x, i) => '| ' + (i + 1) + ' | ' + x.source.replace(/\|/g, '\\|').replace(/\n/g, ' ') +
          ' | ' + (x.translation || '').replace(/\|/g, '\\|').replace(/\n/g, ' ') + ' |'))
        .join('\n');
    case 'csv':
      return ['index,source,translation']
        .concat(u.map((x, i) => [i + 1, esc(x.source), esc(x.translation || '')].join(',')))
        .join('\n');
    case 'json':
      return JSON.stringify({
        name: doc.name, mode: doc.unitMode, total: u.length,
        translated: u.filter(isDone).length,
        units: u.map((x, i) => ({ index: i + 1, source: x.source, translation: x.translation || '' }))
      }, null, 2);
    default:
      return u.map((x) => (x.translation && x.translation.trim() ? x.source + '\t' + x.translation : x.source)).join('\n');
  }
}

function exportName(doc, format) {
  const base = (doc.name || '未命名文档').replace(/\.txt$/i, '');
  const ext = format === 'md' ? 'md' : format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'txt';
  return base + '_对照.' + ext;
}

// ---------------- HTTP ----------------

function sendJson(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon' };

function serveStatic(res, name) {
  const file = path.join(PUBLIC_DIR, name);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': body.length });
  res.end(body);
}

async function handleApi(req, res, url, payload) {
  const p = url.searchParams;
  switch (url.pathname) {
    case '/api/info':
      return sendJson(res, 200, {
        name: 'LineTrans Web',
        version: VERSION,
        mode: '独立服务端',
        targetLang: config.targetLang,
        provider: config.provider?.model || null,
        docCount: state.docs.length,
        canTranslate: !!(config.provider?.baseUrl && config.provider?.model)
      });

    case '/api/docs':
      return sendJson(res, 200, {
        docs: state.docs
          .slice()
          .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
          .map(docSummary)
      });

    case '/api/doc': {
      if (req.method === 'POST') {
        const doc = findDoc(payload.docId);
        if (!doc) return sendJson(res, 404, { error: '文档不存在' });
        if (typeof payload.name === 'string' && payload.name.trim()) doc.name = payload.name.trim();
        if (typeof payload.folder === 'string') doc.folder = payload.folder;
        if (typeof payload.pinned === 'boolean') doc.pinned = payload.pinned;
        if (payload.unitMode === 'LINE' || payload.unitMode === 'SENTENCE') applyMode(doc, payload.unitMode);
        doc.updatedAt = Date.now();
        saveState();
        const s = docSummary(doc);
        return sendJson(res, 200, { ok: true, total: s.total, done: s.done });
      }
      const doc = findDoc(p.get('id'));
      return doc ? sendJson(res, 200, docDetail(doc)) : sendJson(res, 404, { error: '文档不存在' });
    }

    case '/api/unit': {
      const doc = findDoc(payload.docId);
      if (!doc) return sendJson(res, 404, { error: '文档不存在' });
      const unit = doc.units[payload.index];
      if (!unit) return sendJson(res, 404, { error: '句子不存在' });
      if (typeof payload.translation === 'string') unit.translation = payload.translation;
      if (typeof payload.source === 'string' && payload.source.trim()) unit.source = payload.source;
      if (typeof payload.done === 'boolean') unit.done = payload.done;
      if (typeof payload.starred === 'boolean') unit.starred = payload.starred;
      if (unit.translation && unit.translation.trim()) unit.done = true;
      doc.lastIndex = payload.index;
      doc.updatedAt = Date.now();
      saveState();
      const s = docSummary(doc);
      return sendJson(res, 200, { ok: true, total: s.total, done: s.done });
    }

    case '/api/ai': {
      const doc = findDoc(payload.docId);
      if (!doc) return sendJson(res, 404, { error: '文档不存在' });
      const index = Number(payload.index);
      const unit = doc.units[index];
      if (!unit) return sendJson(res, 404, { error: '句子不存在' });
      try {
        const result = await callModel(buildSystemPrompt(unit.source, doc.name, doc.unitMode), buildUserPrompt(doc, index));
        unit.translation = result.text;
        unit.done = true;
        doc.lastIndex = index;
        doc.updatedAt = Date.now();
        state.usage.calls += 1;
        state.usage.promptTokens += result.promptTokens;
        state.usage.completionTokens += result.completionTokens;
        const cost = costOf(result.promptTokens, result.completionTokens);
        state.usage.cost += cost;
        saveState();
        const s = docSummary(doc);
        return sendJson(res, 200, {
          ok: true,
          text: result.text,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          cachedTokens: result.cachedTokens,
          cost,
          total: s.total,
          done: s.done
        });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    case '/api/export': {
      const doc = findDoc(p.get('id'));
      if (!doc) return sendJson(res, 404, { error: '文档不存在' });
      const format = p.get('format') || 'txt_bilingual';
      const body = exportText(doc, format);
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="' + encodeURIComponent(exportName(doc, format)) + '"'
      });
      return res.end(body);
    }

    default:
      return sendJson(res, 404, { error: 'unknown api' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (config.token && url.searchParams.get('token') !== config.token) {
    return sendJson(res, 401, { error: '未授权：请在网址后加 ?token=你的令牌' });
  }

  if (url.pathname.startsWith('/api/')) {
    const payload = req.method === 'POST' ? await readBody(req) : {};
    try {
      return await handleApi(req, res, url, payload);
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, 'index.html');
  if (url.pathname === '/app.js') return serveStatic(res, 'app.js');
  if (url.pathname === '/style.css') return serveStatic(res, 'style.css');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404');
});

server.listen(config.port, config.host, () => {
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
  console.log('LineTrans 网页翻译台 v' + VERSION + ' 已启动');
  console.log('  本机：  http://127.0.0.1:' + config.port + '/');
  nets.forEach((n) => console.log('  局域网：http://' + n.address + ':' + config.port + '/'));
  console.log('  数据：  ' + STATE_FILE);
  console.log('  模型：  ' + (config.provider?.model || '未配置（编辑 config.json 后可启用 AI 翻译）'));
  if (!fs.existsSync(path.join(ROOT, 'config.json'))) {
    console.log('  提示：  复制 config.example.json 为 config.json 并填入 API Key 即可使用 AI 翻译');
  }
});
