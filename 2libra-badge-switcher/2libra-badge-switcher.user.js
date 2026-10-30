// ==UserScript==
// @name         2libra 评论金币徽章助手
// @namespace    https://vhxubo.local/2libra-badge-switcher
// @version      1.0.0
// @description  在 2libra.com 帖子页评论框上方实时显示字数与预计金币消耗，识别「固定扣费」（如前排打手恒定 8 金币）与「按比例减免」（如都听我说减 30%）两类评论徽章并推荐更省的一种：少于 100 字用减免徽章更划算，超过 100 字红色提醒并提供一键切换按钮，Alt+B 快捷键在两者间互切；切换通过 /api/badges/equip 完成，切换前自动检查是否收费。
// @author       vhxubo
// @match        https://2libra.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'twoLibraBadgeSwitcherEnabled';
  const BAR_FLAG = 'data-badge-switcher'; // 状态栏标记，用于查找与清理

  // ---------- 状态 ----------
  let enabled = loadEnabled();
  let pair = { fixed: null, percent: null }; // 两类省金币徽章（来自 /api/badges/my）
  let equipped = new Set();                  // 当前已佩戴徽章 badge_id 集合
  let busy = false;                          // 切换请求进行中
  let menuIds = [];

  // ---------- 存取 ----------
  function loadEnabled() {
    try {
      const v = GM_getValue(STORE_KEY, true);
      return typeof v === 'boolean' ? v : true;
    } catch (e) {
      return true;
    }
  }

  function saveEnabled() {
    try {
      GM_setValue(STORE_KEY, enabled);
    } catch (e) {
      /* 忽略 */
    }
  }

  // ---------- 计费（纯函数，供测试） ----------
  // 基础扣费阶梯，镜像站点前端 COIN_COST.comment：字数越多扣越多
  function baseCost(len) {
    return len > 5000 ? 200 : len > 2000 ? 120 : len > 1000 ? 60 : len > 100 ? 30 : 10;
  }

  // 某枚徽章下发表评论的预计扣费：
  // - 固定扣费徽章（attributes.comment_cost，负数表示扣除）直接覆盖阶梯
  // - 减免徽章（attributes.comment_cost_percent 为减免比例）在阶梯上打折
  // - 其他/未佩戴不影响基础扣费
  function badgeCost(len, ub) {
    const attr = ub && ub.badge && ub.badge.attributes;
    if (!attr) return baseCost(len);
    if (typeof attr.comment_cost === 'number') return Math.abs(attr.comment_cost);
    if (typeof attr.comment_cost_percent === 'number') {
      return Math.round(baseCost(len) * (1 - attr.comment_cost_percent));
    }
    return baseCost(len);
  }

  // 从 /api/badges/my 的列表里挑出两类评论费用徽章；同类多枚时保留更省的一枚。
  // 只认 comment_cost / comment_cost_percent 字段，站内其他 attributes
  // （float_percent、coin_system_cost_percent 等）不会被误判
  function classifyBadges(list) {
    const out = { fixed: null, percent: null };
    for (const ub of Array.isArray(list) ? list : []) {
      const attr = ub && ub.badge && ub.badge.attributes;
      if (!attr) continue;
      if (typeof attr.comment_cost === 'number') {
        if (!out.fixed || Math.abs(attr.comment_cost) < Math.abs(out.fixed.badge.attributes.comment_cost)) out.fixed = ub;
      } else if (typeof attr.comment_cost_percent === 'number') {
        if (!out.percent || attr.comment_cost_percent > out.percent.badge.attributes.comment_cost_percent) out.percent = ub;
      }
    }
    return out;
  }

  // 推荐更省的一枚；没有相关徽章、或候选都比不戴贵时返回 null
  function recommend(len, p) {
    const cands = [p.fixed, p.percent].filter(Boolean);
    if (!cands.length) return null;
    const best = cands.reduce((a, b) => (badgeCost(len, b) < badgeCost(len, a) ? b : a));
    return badgeCost(len, best) < baseCost(len) ? best : null;
  }

  // 当前佩戴的两类徽章之一（都没有则 null）
  function currentCostBadge(p, eq) {
    return [p.fixed, p.percent].find((b) => b && eq.has(b.badge_id)) || null;
  }

  // 状态栏展示模型（纯函数）：warn=true 表示「超 100 字还戴着减免徽章」需要提醒
  function barModel(len, p, eq) {
    const cur = currentCostBadge(p, eq);
    const curCost = badgeCost(len, cur);
    const m = {
      count: `${len} 字`,
      status: `当前：${cur ? cur.badge.name : '未佩戴费用徽章'} · 发评约 ${curCost} 金币`,
      hint: '',
      warn: false,
      target: null,
      btn: '',
    };
    const best = recommend(len, p);
    if (!best || best === cur) {
      // 没有可比项，或已是当前佩戴：两枚都缺时不给「最省」结论
      m.hint = best && best === cur ? '✓ 当前最省' : '';
      return m;
    }
    const bestCost = badgeCost(len, best);
    m.target = best;
    m.btn = `切换「${best.badge.name}」（${bestCost} 金币）`;
    if (len > 100 && cur === p.percent) {
      m.warn = true;
      m.hint = `⚠️ 超 100 字，减免 30% 不再划算`;
    } else {
      m.hint = `可省 ${curCost - bestCost} 金币`;
    }
    return m;
  }

  // ---------- 工具（纯函数，供测试） ----------
  // 解码 JWT payload（只需 sub / username），失败返回 null
  function jwtDecode(token) {
    try {
      const b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  // equipped 接口兼容两种形态：[{badge_id}] 或 [{badge:{id}}]
  function normalizeEquipped(d) {
    if (!Array.isArray(d)) return [];
    return d
      .map((x) => (x && typeof x.badge_id === 'string' ? x.badge_id : x && x.badge && x.badge.id))
      .filter(Boolean);
  }

  // 帖子详情页（含扁平模式 /post-flat/...），排除聚合列表页
  function isPostDetail(pathname) {
    if (!/^\/post(?:-flat)?\/[^/]+\/[^/]+/.test(pathname)) return false;
    return !/^\/post\/(?:latest(?:-comments)?|hot)(?:\/|$)/.test(pathname);
  }

  function readCookie(name) {
    const hit = document.cookie.split(/;\s*/).find((c) => c.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
  }

  // ---------- API ----------
  async function apiJson(path, options) {
    const token = readCookie('access_token');
    const res = await fetch(path, Object.assign({
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
    }, options));
    const data = await res.json();
    if (!res.ok || data.c !== 0) throw new Error(data.m || `HTTP ${res.status}`);
    return data.d;
  }

  async function initData() {
    const token = readCookie('access_token');
    const jwt = token && jwtDecode(token);
    if (!jwt || !jwt.sub) return; // 未登录或 token 解析失败，保持仅字数模式
    try {
      const my = await apiJson('/api/badges/my');
      pair = classifyBadges(my);
    } catch (e) {
      pair = { fixed: null, percent: null };
    }
    await refreshEquipped();
  }

  async function refreshEquipped() {
    const token = readCookie('access_token');
    const jwt = token && jwtDecode(token);
    if (!jwt || !jwt.sub) return;
    try {
      const eq = await apiJson(`/api/badges/user/${jwt.sub}/equipped`);
      equipped = new Set(normalizeEquipped(eq));
    } catch (e) {
      /* 已佩戴状态获取失败时保留旧值 */
    }
    requestRender();
  }

  // 切换徽章：先确认是否收费，再佩戴目标并尝试摘下另一枚（站点允许并存，避免叠加歧义）
  async function switchTo(target) {
    if (busy || !target) return;
    busy = true;
    requestRender();
    try {
      let need = false;
      let amount = 0;
      try {
        const ck = await apiJson('/api/badges/equip/check-cost');
        need = !!(ck && ck.needCost);
        amount = (ck && ck.costAmount) || 0;
      } catch (e) {
        /* 检查失败不阻塞切换 */
      }
      if (need && amount > 0) {
        const ok = window.confirm(`本次切换徽章需消耗 ${amount} 金币，是否继续？`);
        if (!ok) return;
      }
      await apiJson('/api/badges/equip', {
        method: 'POST',
        body: JSON.stringify({ badge_id: target.badge_id, equip: true }),
      });
      const other = target === pair.fixed ? pair.percent : pair.fixed;
      if (other && equipped.has(other.badge_id)) {
        try {
          await apiJson('/api/badges/equip', {
            method: 'POST',
            body: JSON.stringify({ badge_id: other.badge_id, equip: false }),
          });
        } catch (e) {
          /* 摘除失败不影响结果 */
        }
      }
      equipped = new Set([target.badge_id]);
      toast(`已切换为「${target.badge.name}」`);
    } catch (e) {
      toast(`切换失败：${e && e.message ? e.message : e}`, true);
    } finally {
      busy = false;
      refreshEquipped();
    }
  }

  // ---------- 状态栏 ----------
  const EDITOR_SELECTOR = '.w-md-editor';
  const INPUT_SELECTOR = '.w-md-editor-text-input, .w-md-editor-text textarea, textarea';

  function editorText(editor) {
    const ta = editor.querySelector(INPUT_SELECTOR);
    return ta && ta.value ? ta.value : '';
  }

  function makeBar() {
    const bar = document.createElement('div');
    bar.setAttribute(BAR_FLAG, '');
    bar.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:2px 10px',
      'align-items:center',
      'justify-content:flex-end',
      'font-size:11px',
      'line-height:1.5',
      'margin:0 2px 4px 0',
      'opacity:.8',
      'user-select:none',
    ].join(';');
    for (let i = 0; i < 3; i++) bar.appendChild(document.createElement('span'));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = [
      'font-size:11px',
      'line-height:1.4',
      'padding:1px 8px',
      'border:1px solid currentColor',
      'border-radius:6px',
      'background:transparent',
      'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', () => switchTo(bar.__target));
    bar.appendChild(btn);
    return bar;
  }

  // 状态栏始终是编辑器的正向前一个兄弟节点；站点重渲染挪走/删掉时重新补插
  function barFor(editor) {
    const previous = editor.previousElementSibling;
    if (previous && previous.hasAttribute(BAR_FLAG)) return previous;
    const parent = editor.parentNode;
    if (!parent) return null; // 编辑器暂未挂载，等下一次渲染
    const bar = makeBar();
    parent.insertBefore(bar, editor);
    return bar;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  // 只在文案/显隐真正变化时写 DOM，避免状态栏自身改动触发观察器循环
  function updateBar(editor, bar) {
    if (!bar) return;
    const model = barModel(editorText(editor).length, pair, equipped);
    const [countEl, statusEl, hintEl, btnEl] = bar.children;
    setText(countEl, model.count);
    countEl.style.color = model.warn ? '#dc2626' : '';
    countEl.style.fontWeight = model.warn ? '600' : '';
    setText(statusEl, model.status);
    setText(hintEl, model.hint + (model.hint ? ' · ' : '') + 'Alt+B 切换');
    hintEl.style.color = model.warn
      ? '#dc2626'
      : model.hint.startsWith('✓') ? '#16a34a' : model.hint ? '#d97706' : '';
    hintEl.style.fontWeight = model.warn ? '600' : '';
    if (busy) {
      setText(btnEl, '切换中…');
      btnEl.style.display = '';
      btnEl.disabled = true;
    } else if (model.target) {
      setText(btnEl, model.btn);
      btnEl.style.display = '';
      btnEl.disabled = false;
      bar.__target = model.target;
    } else {
      btnEl.style.display = 'none';
    }
  }

  function removeBars() {
    for (const el of document.querySelectorAll(`[${BAR_FLAG}]`)) el.remove();
  }

  // ---------- 渲染 ----------
  function render() {
    if (!enabled || !isPostDetail(window.location.pathname)) {
      removeBars();
      return;
    }
    const bars = document.querySelectorAll(`[${BAR_FLAG}]`);
    for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) {
      updateBar(editor, barFor(editor));
    }
    // 编辑器被站点移除后，清理孤儿状态栏
    for (const bar of bars) {
      const next = bar.nextElementSibling;
      if (!next || !next.matches(EDITOR_SELECTOR)) bar.remove();
    }
  }

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  // ---------- 快捷键 ----------
  // Alt+B：在两枚费用徽章间互切；当前戴的是别的徽章时切到推荐项
  function onHotkey(e) {
    if (!enabled) return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'b' && e.key !== 'B') return;
    e.preventDefault();
    const cur = currentCostBadge(pair, equipped);
    const target = cur === pair.fixed ? pair.percent : cur === pair.percent ? pair.fixed : recommend(activeLength(), pair);
    if (!target) {
      toast('没有可切换的费用徽章（需持有「固定扣费」或「减免」类徽章）', true);
      return;
    }
    switchTo(target);
  }

  // 取焦点所在编辑器（回复框）的字数，兜底第一个编辑器
  function activeLength() {
    const active = document.activeElement;
    for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) {
      if (editor.contains(active)) return editorText(editor).length;
    }
    const first = document.querySelector(EDITOR_SELECTOR);
    return first ? editorText(first).length : 0;
  }

  // ---------- 轻提示 ----------
  function toast(msg, isErr) {
    if (!document.body) return;
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:99999',
      'padding:8px 14px',
      'border-radius:8px',
      'font-size:13px',
      'color:#fff',
      'max-width:80vw',
      isErr ? 'background:#dc2626' : 'background:rgba(0,0,0,.78)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // ---------- 油猴菜单 ----------
  function registerMenus() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      for (const id of menuIds) {
        try { GM_unregisterMenuCommand(id); } catch (e) { /* 忽略 */ }
      }
    }
    menuIds = [];
    menuIds.push(GM_registerMenuCommand(
      enabled ? '徽章助手：开启中（点击关闭）' : '徽章助手：已关闭（点击开启）',
      () => {
        enabled = !enabled;
        saveEnabled();
        registerMenus();
        requestRender();
      }
    ));
    menuIds.push(GM_registerMenuCommand('重新拉取徽章数据', () => {
      initData();
      toast('已刷新徽章数据');
    }));
  }

  // ---------- 启动 ----------
  registerMenus();
  render();
  initData();

  // 输入走捕获阶段的 input 事件（React 受控组件也会触发），DOM 增删走全局观察器
  document.addEventListener('input', requestRender, true);
  window.addEventListener('keydown', onHotkey);

  new MutationObserver(requestRender).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // 其他标签页/个人页里换徽章后，回到本页时同步佩戴状态
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshEquipped();
  });
})();
