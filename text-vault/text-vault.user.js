// ==UserScript==
// @name         文本暂存匣 · 选中即记、一键回填
// @namespace    https://vhxubo.local/textvault
// @version      1.0.0
// @description  文本片段的跨页面暂存与回填：选中文字后点浮出的「✚ 记」按钮（或油猴菜单 / Alt+Shift+V）把文本存进油猴存储，全站共享；悬浮球打开面板，点击条目——页面里有聚焦的输入框就插入光标处，没有就复制到剪贴板；无选中文本时记录命令自动改读剪贴板；支持编辑、删除（可撤销）、置顶、搜索、去重置顶，悬浮球可拖动、多标签页实时同步。
// @author       vhxubo
// @match        *://*/*
// @match        file:///*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_addValueChangeListener
// @run-at       document-end
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  const STORE_KEY = 'textVaultEntries';
  const POS_KEY = 'textVaultFabPos';
  const MAX_ENTRIES = 1000;     // 条目上限，超出时优先淘汰最旧的未置顶条目
  const MAX_TEXT_LEN = 20000;   // 单条文本上限，超出截断
  const DEDUPE = true;          // 记录重复文本时不新增，改为置顶并刷新时间
  const SNAP_BTN = true;        // 选中文本后浮出「✚ 记」小按钮
  const HOTKEY_CODE = 'KeyV';   // Alt+Shift+<code> 开关面板

  /* ==================== 存储层 ==================== */
  let entries = loadEntries();

  function loadEntries() {
    try {
      const arr = JSON.parse(GM_getValue(STORE_KEY, '[]'));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((e) => e && typeof e.text === 'string')
        .map((e) => ({
          id: String(e.id || uid()),
          text: String(e.text),
          domain: String(e.domain || ''),
          createdAt: Number(e.createdAt) || Date.now(),
          updatedAt: Number(e.updatedAt) || Number(e.createdAt) || Date.now(),
          pinned: !!e.pinned,
          count: Number(e.count) || 0,
        }));
    } catch {
      return [];
    }
  }

  function save() {
    GM_setValue(STORE_KEY, JSON.stringify(entries));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function addEntry(text, source) {
    if (!text || !text.trim()) return { ok: false, msg: '空白文本不记录' };
    const content = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) + '…[已截断]' : text;
    if (DEDUPE) {
      const hit = entries.find((e) => e.text.trim() === text.trim());
      if (hit) {
        hit.text = content;
        hit.updatedAt = Date.now();
        save();
        return { ok: true, msg: '已存在，去重置顶' };
      }
    }
    entries.unshift({
      id: uid(),
      text: content,
      domain: source || location.hostname || 'file',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      count: 0,
    });
    evict();
    save();
    return { ok: true, msg: '已记录' };
  }

  function evict() {
    while (entries.length > MAX_ENTRIES) {
      const idx = entries.map((e) => e.pinned).lastIndexOf(false);
      if (idx < 0) break;
      entries.splice(idx, 1);
    }
  }

  function updateEntry(id, text) {
    const e = byId(id);
    if (!e || !text || !text.trim()) return false;
    e.text = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) + '…[已截断]' : text;
    e.updatedAt = Date.now();
    save();
    return true;
  }

  function removeEntry(id) {
    const idx = entries.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    return entries.splice(idx, 1)[0];
  }

  function restoreEntry(entry, idx) {
    entries.splice(Math.max(0, Math.min(idx, entries.length)), 0, entry);
    save();
  }

  function byId(id) {
    return entries.find((x) => x.id === id);
  }

  function bump(id) {
    const e = byId(id);
    if (!e) return;
    e.count += 1; // 不动 updatedAt，使用后不打乱列表顺序
    save();
  }

  /* ==================== 工具函数 ==================== */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    const d = new Date(ts);
    const now = new Date();
    const y = now.getFullYear() !== d.getFullYear() ? d.getFullYear() + '/' : '';
    return y + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function metaOf(e) {
    const parts = [];
    if (e.domain) parts.push(e.domain);
    if (e.count > 0) parts.push('用过 ' + e.count + ' 次');
    parts.push(fmtTime(e.updatedAt));
    return parts.join(' · ');
  }

  /* ==================== 写入页面输入框 ==================== */
  const NON_TEXT_INPUT = ['button', 'submit', 'reset', 'file', 'checkbox', 'radio', 'image', 'range', 'color', 'hidden'];

  function isEditable(el) {
    if (!el || !el.tagName || el === document.body || el === document.documentElement) return null;
    if (el.isContentEditable) return el;
    if (el.tagName === 'TEXTAREA') return el;
    if (el.tagName === 'INPUT' && !NON_TEXT_INPUT.includes((el.getAttribute('type') || 'text').toLowerCase())) return el;
    return null;
  }

  // 写入目标：优先当前聚焦的输入框（脚本面板夺焦已被 mousedown preventDefault 拦住），
  // 否则回退到「最后聚焦过的输入框」，再没有就走剪贴板
  let lastEditable = null;
  let host = null; // init 时赋值

  function currentTarget() {
    const ae = document.activeElement;
    if (ae && ae !== host && ae !== document.body) {
      const el = isEditable(ae);
      if (el) return el;
    }
    if (lastEditable && lastEditable.isConnected && !lastEditable.disabled && !lastEditable.readOnly) return lastEditable;
    return null;
  }

  function insertInto(el, text) {
    el.focus();
    if (el.isContentEditable) {
      try {
        return document.execCommand('insertText', false, text);
      } catch {
        return false;
      }
    }
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text); // 原生插入，会派发 input 事件，React/Vue 均能感知
    } catch {
      ok = false;
    }
    if (ok) return true;
    // 兜底：原生 value setter（绕开 React 对 value 的拦截）+ 手动派发事件
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      if (desc && desc.set) desc.set.call(el, next);
      else el.value = next;
      el.selectionStart = el.selectionEnd = start + text.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function useEntry(entry) {
    const target = currentTarget();
    if (target) {
      const ok = insertInto(target, entry.text);
      bump(entry.id);
      if (ok) toast('已写入输入框');
      else {
        GM_setClipboard(entry.text);
        toast('写入失败，已改为复制到剪贴板');
      }
    } else {
      GM_setClipboard(entry.text);
      bump(entry.id);
      toast('未发现输入框，已复制到剪贴板');
    }
  }

  /* ==================== UI（Shadow DOM） ==================== */
  const STYLE = `
:host {
  all: initial;
  position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --bg: #ffffff; --fg: #1f2328; --muted: #57606a; --border: #d8dee4; --hover: #f3f4f6;
  --accent: #0969da; --accent-hov: #0550ae; --danger: #cf222e; --pin: #eac54f; --input-bg: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1c2128; --fg: #e6edf3; --muted: #8b949e; --border: #30363d; --hover: #262c36;
    --accent: #4493f8; --accent-hov: #2f81f7; --danger: #f85149; --pin: #d4a72c; --input-bg: #0d1117;
  }
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }
button, input, textarea { font: inherit; color: inherit; }

.fab {
  position: absolute; pointer-events: auto; touch-action: none;
  width: 44px; height: 44px; border-radius: 50%; border: none;
  background: linear-gradient(135deg, var(--accent-hov), var(--accent));
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; cursor: grab; user-select: none;
  box-shadow: 0 4px 14px rgba(9, 105, 218, .45);
}
.fab:active { cursor: grabbing; }
.fab .num { pointer-events: none; letter-spacing: -.5px; }

.snap {
  position: absolute; pointer-events: auto;
  border: none; border-radius: 999px; padding: 4px 12px;
  background: var(--accent); color: #fff; font-size: 12px; cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .25);
}
.snap:hover { background: var(--accent-hov); }

.panel {
  position: absolute; pointer-events: auto;
  width: 340px; max-width: calc(100vw - 16px); height: min(560px, 76vh);
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .2); overflow: hidden;
}
.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border-bottom: 1px solid var(--border); font-weight: 600;
}
.panel-head .cnt { color: var(--muted); font-weight: 400; font-size: 12px; }
.head-actions { display: flex; gap: 2px; }
.icon-btn {
  border: none; background: transparent; cursor: pointer; color: var(--muted);
  border-radius: 6px; min-width: 24px; height: 24px; line-height: 24px; padding: 0 3px;
}
.icon-btn:hover { background: var(--hover); color: var(--fg); }
.panel-toolbar { padding: 8px 12px; border-bottom: 1px solid var(--border); }
.search {
  width: 100%; padding: 5px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--input-bg); color: var(--fg); outline: none;
}
.search:focus { border-color: var(--accent); }
.composer { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
.composer textarea, .edit-area, .modal-area {
  width: 100%; resize: vertical; min-height: 64px; max-height: 220px;
  padding: 6px 8px; border: 1px solid var(--accent); border-radius: 8px;
  background: var(--input-bg); color: var(--fg); outline: none;
}
.composer-actions, .edit-actions, .modal-actions { display: flex; gap: 6px; }
.mini {
  border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px;
}
.mini.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.mini.ghost { background: transparent; color: var(--muted); }
.mini:hover { filter: brightness(.96); }

.list { overflow-y: auto; flex: 1; overscroll-behavior: contain; }
.item { padding: 8px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
.item:hover { background: var(--hover); }
.item.pinned { box-shadow: inset 3px 0 0 var(--pin); }
.item-text {
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.item-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; }
.meta-info { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-actions { display: flex; gap: 2px; opacity: .35; transition: opacity .12s; flex-shrink: 0; }
.item:hover .item-actions { opacity: 1; }
.item-actions .icon-btn.pinned { color: var(--pin); opacity: 1; }
.item-actions .icon-btn.danger:hover { color: var(--danger); }
.item.editing { cursor: default; }
.item.editing .edit-area { margin-bottom: 2px; }
.empty { padding: 28px 16px; text-align: center; color: var(--muted); }

.panel-foot {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 12px; border-top: 1px solid var(--border);
}
.link-btn {
  border: none; background: none; color: var(--muted); cursor: pointer;
  font-size: 12px; padding: 2px 8px; border-radius: 6px;
}
.link-btn:hover { background: var(--hover); color: var(--danger); }
.link-btn.armed { color: #fff; background: var(--danger); font-weight: 600; }
.foot-hint { color: var(--muted); font-size: 11px; }

.toast {
  position: absolute; pointer-events: auto; left: 50%; bottom: 28px; transform: translateX(-50%);
  background: #24292f; color: #fff; border-radius: 8px; padding: 8px 14px;
  display: flex; gap: 12px; align-items: center; max-width: 80vw;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .3);
}
.toast button { border: none; background: none; color: #79c0ff; cursor: pointer; font-size: 12px; font-weight: 600; }

.modal-mask {
  position: absolute; inset: 0; pointer-events: auto;
  background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center;
}
.modal {
  width: min(420px, 90vw); background: var(--bg); color: var(--fg);
  border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, .35);
}
.modal-title { font-weight: 600; }
`;

  const HTML = `
<button class="fab" title="文本暂存匣 — 拖动移动 · 点击开关面板（Alt+Shift+V）"><span class="num">0</span></button>
<button class="snap" hidden>✚ 记</button>
<div class="panel" hidden>
  <div class="panel-head">
    <span>文本暂存匣 <span class="cnt"></span></span>
    <span class="head-actions">
      <button class="icon-btn act-add" title="新增一条">＋</button>
      <button class="icon-btn act-close" title="关闭（Esc）">✕</button>
    </span>
  </div>
  <div class="panel-toolbar"><input class="search" type="search" placeholder="搜索已存文本…"></div>
  <div class="composer" hidden>
    <textarea class="composer-area" placeholder="新条目内容 — Ctrl+Enter 保存，Esc 取消"></textarea>
    <div class="composer-actions">
      <button class="mini primary act-composer-save">保存</button>
      <button class="mini ghost act-composer-cancel">取消</button>
    </div>
  </div>
  <div class="list"></div>
  <div class="panel-foot">
    <button class="link-btn act-clear">清空全部</button>
    <span class="foot-hint">点击条目：写入输入框 / 复制</span>
  </div>
</div>
<div class="toast" hidden><span class="toast-msg"></span><button class="toast-act" hidden></button></div>
<div class="modal-mask" hidden>
  <div class="modal">
    <div class="modal-title">无法自动读取剪贴板，请手动粘贴</div>
    <textarea class="modal-area" placeholder="Ctrl+V 粘贴要记录的内容"></textarea>
    <div class="modal-actions">
      <button class="mini primary act-modal-save">记录</button>
      <button class="mini ghost act-modal-cancel">取消</button>
    </div>
  </div>
</div>
`;

  let root, fabEl, numEl, snapEl, panelEl, cntEl, searchEl, composerEl, composerArea, listEl, clearBtn, toastEl, toastMsg, toastAct, modalMask, modalArea;
  let editingId = null;
  let pendingText = '';
  let panelVisible = false;

  function buildUI() {
    host = document.createElement('div');
    host.id = 'text-vault-host';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${STYLE}</style>${HTML}`;
    (document.body || document.documentElement).appendChild(host);

    fabEl = root.querySelector('.fab');
    numEl = root.querySelector('.num');
    snapEl = root.querySelector('.snap');
    panelEl = root.querySelector('.panel');
    cntEl = root.querySelector('.cnt');
    searchEl = root.querySelector('.search');
    composerEl = root.querySelector('.composer');
    composerArea = root.querySelector('.composer-area');
    listEl = root.querySelector('.list');
    clearBtn = root.querySelector('.act-clear');
    toastEl = root.querySelector('.toast');
    toastMsg = root.querySelector('.toast-msg');
    toastAct = root.querySelector('.toast-act');
    modalMask = root.querySelector('.modal-mask');
    modalArea = root.querySelector('.modal-area');

    applyFabPos();
    bindUI();
    render();
  }

  /* ---------- 渲染 ---------- */
  function render() {
    numEl.textContent = entries.length > 99 ? '99+' : String(entries.length);
    if (!panelVisible) return;

    cntEl.textContent = entries.length ? `共 ${entries.length} 条` : '';
    const q = searchEl.value.trim().toLowerCase();
    const shown = entries
      .filter((e) => !q || e.text.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));

    if (!shown.length) {
      listEl.innerHTML = `<div class="empty">${entries.length ? '没有匹配的记录' : '暂无记录<br>选中网页文字点「✚ 记」，或用油猴菜单记录剪贴板'}</div>`;
      return;
    }

    listEl.innerHTML = shown.map((e) => {
      if (e.id === editingId) {
        return `<div class="item editing" data-id="${e.id}">
          <textarea class="edit-area" placeholder="编辑内容 — Ctrl+Enter 保存，Esc 取消"></textarea>
          <div class="edit-actions">
            <button class="mini primary" data-act="save-edit">保存</button>
            <button class="mini ghost" data-act="cancel-edit">取消</button>
          </div>
        </div>`;
      }
      return `<div class="item${e.pinned ? ' pinned' : ''}" data-id="${e.id}">
        <div class="item-text"></div>
        <div class="item-meta">
          <span class="meta-info">${esc(metaOf(e))}</span>
          <span class="item-actions">
            <button class="icon-btn${e.pinned ? ' pinned' : ''}" data-act="pin" title="${e.pinned ? '取消置顶' : '置顶'}">${e.pinned ? '★' : '☆'}</button>
            <button class="icon-btn" data-act="edit" title="编辑">✎</button>
            <button class="icon-btn" data-act="copy" title="复制">⧉</button>
            <button class="icon-btn danger" data-act="del" title="删除">✕</button>
          </span>
        </div>
      </div>`;
    }).join('');

    // 文本经 textContent 写入，防 XSS
    listEl.querySelectorAll('.item').forEach((node) => {
      const e = byId(node.dataset.id);
      if (!e) return;
      const t = node.querySelector('.item-text');
      if (t) t.textContent = e.text;
      const ta = node.querySelector('.edit-area');
      if (ta) {
        ta.value = e.text;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }

  /* ---------- toast ---------- */
  let toastTimer = 0;
  function toast(msg, opts) {
    const { action, onAction, ms = 2200 } = opts || {};
    toastMsg.textContent = msg;
    if (action) {
      toastAct.hidden = false;
      toastAct.textContent = action;
      toastAct.onclick = () => {
        hideToast();
        if (onAction) onAction();
      };
    } else {
      toastAct.hidden = true;
      toastAct.onclick = null;
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    toastEl.hidden = true;
  }

  /* ---------- 面板开关与定位 ---------- */
  function togglePanel() {
    panelVisible ? closePanel() : openPanel();
  }
  function openPanel() {
    panelVisible = true;
    panelEl.hidden = false;
    positionPanel();
    render();
  }
  function closePanel() {
    panelVisible = false;
    panelEl.hidden = true;
    snapEl.hidden = true;
  }
  function positionPanel() {
    const fr = fabEl.getBoundingClientRect();
    const ph = panelEl.offsetHeight || 400;
    panelEl.style.right = Math.max(8, Math.min(innerWidth - fr.right, innerWidth - 356)) + 'px';
    const above = innerHeight - fr.top + 8;
    panelEl.style.bottom = Math.max(8, Math.min(above, innerHeight - ph - 8)) + 'px';
  }

  /* ---------- 悬浮球拖动 ---------- */
  function applyFabPos() {
    try {
      const p = JSON.parse(GM_getValue(POS_KEY, 'null'));
      if (p && typeof p.right === 'number' && typeof p.bottom === 'number') {
        fabEl.style.right = Math.max(4, Math.min(p.right, innerWidth - 52)) + 'px';
        fabEl.style.bottom = Math.max(4, Math.min(p.bottom, innerHeight - 52)) + 'px';
        return;
      }
    } catch { /* 忽略损坏的位置数据 */ }
    fabEl.style.right = '18px';
    fabEl.style.bottom = '90px';
  }
  function saveFabPos() {
    const r = fabEl.getBoundingClientRect();
    GM_setValue(POS_KEY, JSON.stringify({
      right: Math.max(4, Math.round(innerWidth - r.right)),
      bottom: Math.max(4, Math.round(innerHeight - r.bottom)),
    }));
  }

  /* ---------- UI 事件 ---------- */
  function bindUI() {
    // 拖动 / 点击悬浮球
    let drag = null;
    fabEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      fabEl.setPointerCapture(e.pointerId);
    });
    fabEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true;
      const half = fabEl.offsetWidth / 2;
      fabEl.style.left = Math.max(4, Math.min(e.clientX - half, innerWidth - fabEl.offsetWidth - 4)) + 'px';
      fabEl.style.top = Math.max(4, Math.min(e.clientY - half, innerHeight - fabEl.offsetHeight - 4)) + 'px';
      fabEl.style.right = 'auto';
      fabEl.style.bottom = 'auto';
    });
    fabEl.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) saveFabPos();
      else togglePanel();
    });

    // 面板头部
    root.querySelector('.act-add').addEventListener('click', openComposer);
    root.querySelector('.act-close').addEventListener('click', closePanel);
    searchEl.addEventListener('input', render);

    // 列表：mousedown 阻止面板夺焦，保住页面输入框的焦点与光标
    listEl.addEventListener('mousedown', (e) => {
      if (!e.target.closest('textarea')) e.preventDefault();
    });
    listEl.addEventListener('click', onListClick);
    listEl.addEventListener('keydown', (e) => {
      const ta = e.target.closest('.edit-area');
      if (!ta) return;
      const item = ta.closest('.item');
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit(item.dataset.id, ta.value);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        editingId = null;
        render();
      }
    });

    // 新增
    composerArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveComposer();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closeComposer();
      }
    });
    root.querySelector('.act-composer-save').addEventListener('click', saveComposer);
    root.querySelector('.act-composer-cancel').addEventListener('click', closeComposer);

    // 清空（两段确认）
    clearBtn.addEventListener('click', () => {
      if (!entries.length) return;
      if (clearBtn.classList.contains('armed')) {
        entries = [];
        editingId = null;
        save();
        setClearArmed(false);
        render();
        toast('已清空全部记录');
      } else {
        setClearArmed(true);
        setTimeout(() => setClearArmed(false), 3000);
      }
    });

    // 兜底粘贴模态
    root.querySelector('.act-modal-save').addEventListener('click', () => {
      modalMask.hidden = true;
      toast(addEntry(modalArea.value).msg);
    });
    root.querySelector('.act-modal-cancel').addEventListener('click', () => { modalMask.hidden = true; });
    modalMask.addEventListener('mousedown', (e) => { if (e.target === modalMask) modalMask.hidden = true; });
  }

  function onListClick(e) {
    const item = e.target.closest('.item');
    if (!item) return;
    const id = item.dataset.id;
    const entry = byId(id);
    if (!entry) return;
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      switch (btn.dataset.act) {
        case 'pin':
          entry.pinned = !entry.pinned;
          save();
          render();
          break;
        case 'edit':
          editingId = id;
          render();
          break;
        case 'copy':
          GM_setClipboard(entry.text);
          bump(id);
          toast('已复制到剪贴板');
          break;
        case 'del': {
          const idx = entries.findIndex((x) => x.id === id);
          const removed = removeEntry(id);
          if (removed) {
            if (editingId === id) editingId = null;
            save();
            render();
            const undoData = { entry: removed, idx };
            toast('已删除', {
              action: '撤销',
              ms: 5000,
              onAction: () => {
                restoreEntry(undoData.entry, undoData.idx);
                render();
                toast('已恢复');
              },
            });
          }
          break;
        }
        case 'save-edit':
          saveEdit(id, item.querySelector('.edit-area').value);
          break;
        case 'cancel-edit':
          editingId = null;
          render();
          break;
      }
      return;
    }
    if (item.classList.contains('editing')) return;
    useEntry(entry);
  }

  function saveEdit(id, text) {
    if (updateEntry(id, text)) {
      editingId = null;
      render();
      toast('已保存');
    } else {
      toast('内容为空，未保存');
    }
  }

  function openComposer() {
    composerEl.hidden = false;
    composerArea.value = '';
    composerArea.focus();
  }
  function closeComposer() {
    composerEl.hidden = true;
    composerArea.value = '';
  }
  function saveComposer() {
    const r = addEntry(composerArea.value);
    if (r.ok) {
      closeComposer();
      render();
    }
    toast(r.msg);
  }

  function setClearArmed(v) {
    clearBtn.classList.toggle('armed', v);
    clearBtn.textContent = v ? '再点一次确认清空！' : '清空全部';
  }

  /* ==================== 选区浮出按钮 ==================== */
  let snapTimer = 0;

  // 返回「不在脚本 UI 内」的选中文本，无则返回 ''
  function selectionOutsideUI() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    const node = sel.anchorNode;
    if (!node) return ''; // 选区在 shadow 内部时浏览器不暴露节点
    if (host === node || root.contains(node) || (node.parentNode && root.contains(node.parentNode))) return '';
    return sel.toString();
  }

  function hideSnap() {
    snapEl.hidden = true;
    pendingText = '';
  }

  function checkSelection() {
    if (!SNAP_BTN || panelVisible || !modalMask.hidden) { hideSnap(); return; }
    const text = selectionOutsideUI();
    if (!text.trim()) { hideSnap(); return; }
    const sel = document.getSelection();
    let rect;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch { hideSnap(); return; }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const n = sel.anchorNode;
      const el = n && (n.nodeType === 1 ? n : n.parentElement);
      if (el) rect = el.getBoundingClientRect();
    }
    if (!rect) { hideSnap(); return; }
    pendingText = text;
    snapEl.hidden = false;
    snapEl.style.left = Math.max(8, Math.min(rect.right + scrollX - 8, scrollX + innerWidth - 90)) + 'px';
    snapEl.style.top = Math.max(8, Math.min(rect.bottom + scrollY + 6, scrollY + innerHeight - 46)) + 'px';
  }

  function bindSelection() {
    document.addEventListener('selectionchange', () => {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(checkSelection, 180);
    });
    document.addEventListener('mouseup', () => {
      clearTimeout(snapTimer);
      checkSelection();
    });
    window.addEventListener('scroll', hideSnap, true);
    window.addEventListener('resize', hideSnap);
    snapEl.addEventListener('mousedown', (e) => e.preventDefault()); // 保住选区与页面焦点
    snapEl.addEventListener('click', () => {
      const t = pendingText;
      hideSnap();
      if (!t) return;
      toast(addEntry(t).msg);
    });
  }

  /* ==================== 记录：选中文本 / 剪贴板 ==================== */
  async function recordFromMenu() {
    const selText = selectionOutsideUI();
    if (selText.trim()) {
      toast(addEntry(selText).msg);
      return;
    }
    let clip = null;
    try {
      clip = await navigator.clipboard.readText();
    } catch { /* 页面失焦或无权限（如点击扩展菜单后焦点不在页面） */ }
    if (clip === null) {
      openPasteModal();
      return;
    }
    if (clip.trim()) toast(addEntry(clip).msg + '（来自剪贴板）');
    else toast('剪贴板是空的');
  }

  function openPasteModal() {
    modalMask.hidden = false;
    modalArea.value = '';
    try { modalArea.focus(); } catch { /* 页面无焦点时忽略 */ }
  }

  function clearFromMenu() {
    openPanel();
    setClearArmed(true);
    setTimeout(() => setClearArmed(false), 3000);
    toast('再点一次「清空全部」以确认');
  }

  /* ==================== 全局事件 ==================== */
  function bindGlobal() {
    // 记住最后聚焦的页面输入框
    window.addEventListener('focusin', (e) => {
      if (e.target === host) return; // 焦点在脚本面板内
      const el = isEditable(e.target);
      if (el) lastEditable = el;
    }, true);

    // 热键 + Esc
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === HOTKEY_CODE) {
        e.preventDefault();
        togglePanel();
        return;
      }
      if (e.key !== 'Escape') return;
      if (!modalMask.hidden) { modalMask.hidden = true; e.preventDefault(); return; }
      if (!panelVisible) return;
      if (editingId) { editingId = null; render(); e.preventDefault(); return; }
      if (!composerEl.hidden) { closeComposer(); e.preventDefault(); return; }
      closePanel();
      e.preventDefault();
    }, true);

    // 跨标签页同步
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(STORE_KEY, (key, oldVal, newVal, remote) => {
        if (!remote) return;
        entries = loadEntries();
        render();
      });
    }
  }

  /* ==================== 油猴菜单 & 启动 ==================== */
  function init() {
    buildUI();
    bindSelection();
    bindGlobal();
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('➕ 记录选中文本 / 剪贴板', recordFromMenu);
      GM_registerMenuCommand('📂 打开 / 收起面板', togglePanel);
      GM_registerMenuCommand('🗑 清空全部记录', clearFromMenu);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
