// ==UserScript==
// @name         2libra 表格条数统计
// @namespace    https://vhxubo.local/2libra-table-counter
// @version      1.0.1
// @description  在 2libra.com 给页面里所有 table 组件（金币流水等）加一行「共 N 条」统计徽标：表格数据增删、异步加载、翻页筛选、SPA 路由切换时实时同步；徽标插在表格正前方、内联样式不依赖站点类名，表格隐藏（如响应式切换）时徽标同步隐藏；只统计可见行（display:none 的行不计），油猴菜单一键开关并持久化。
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

  const STORE_KEY = 'twoLibraTableCounterEnabled';
  const BADGE_FLAG = 'data-table-counter'; // 徽标标记，用于查找与清理

  let enabled = loadEnabled();
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

  // ---------- 计数（纯函数，供测试） ----------
  // 统计各 tbody 中未被 CSS 隐藏的行数；行在隐藏的表格里时自身 display 仍为
  // table-row，因此表格整体隐藏与否不影响计数，只影响徽标显隐
  function visibleRowCount(table) {
    let n = 0;
    for (const tbody of table.tBodies) {
      for (const tr of tbody.rows) {
        if (rowHidden(tr)) continue;
        n++;
      }
    }
    return n;
  }

  function rowHidden(tr) {
    try {
      return getComputedStyle(tr).display === 'none';
    } catch (e) {
      return false;
    }
  }

  // 以最终样式为准：hidden 可被 md:table 等响应式规则覆盖。
  function isTableHidden(table) {
    try {
      return getComputedStyle(table).display === 'none';
    } catch (e) {
      return !!(table.classList && table.classList.contains('hidden'));
    }
  }

  function formatCount(n) {
    return `共 ${n} 条`;
  }

  // ---------- 徽标 ----------
  function makeBadge() {
    const el = document.createElement('div');
    el.setAttribute(BADGE_FLAG, '');
    // 内联样式不依赖站点类名；初始 display:none，首次 updateBadge 再决定显隐
    el.style.cssText = [
      'display:none',
      'font-size:11px',
      'line-height:1.4',
      'text-align:right',
      'opacity:.55',
      'margin:0 2px 4px 0',
      'pointer-events:none',
      'user-select:none',
    ].join(';');
    return el;
  }

  // 徽标始终是表格的正向前一个兄弟节点；站点重渲染挪走/删掉徽标时重新补插
  function badgeFor(table) {
    const previous = table.previousElementSibling;
    if (previous && previous.hasAttribute(BADGE_FLAG)) return previous;
    const parent = table.parentNode;
    if (!parent) return null; // 表格暂未挂载，等下一次 sweep
    const badge = makeBadge();
    parent.insertBefore(badge, table);
    return badge;
  }

  // 只在文案/显隐真正变化时写 DOM，避免徽标自身改动再次触发全局观察器造成循环
  function updateBadge(table) {
    const badge = badgeFor(table);
    if (!badge) return;
    const text = formatCount(visibleRowCount(table));
    if (badge.textContent !== text) badge.textContent = text;
    const want = enabled && !isTableHidden(table) ? '' : 'none';
    if (badge.style.display !== want) badge.style.display = want;
  }

  function removeAllBadges() {
    for (const el of document.querySelectorAll(`[${BADGE_FLAG}]`)) {
      el.remove();
    }
  }

  // ---------- 扫描 ----------
  // 覆盖所有带 tbody 的 table；新表格出现（SPA 路由/异步渲染）由全局观察器触发重扫
  function sweep() {
    if (!enabled) {
      removeAllBadges();
      return;
    }
    for (const table of document.querySelectorAll('table')) {
      if (!table.tBodies || table.tBodies.length === 0) continue;
      updateBadge(table);
    }
  }

  let sweepQueued = false;
  function requestSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    requestAnimationFrame(() => {
      sweepQueued = false;
      sweep();
    });
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
      enabled ? '表格条数统计：开启中（点击关闭）' : '表格条数统计：已关闭（点击开启）',
      () => {
        setEnabled(!enabled);
        registerMenus();
      }
    ));
  }

  function setEnabled(v) {
    enabled = v;
    saveEnabled();
    requestSweep();
  }

  // ---------- 启动 ----------
  sweep();

  // 单一全局观察器：行增删/整表替换（childList）与类名/行内样式显隐切换（attributes）
  // 都收敛到去抖后的 sweep，逐表重算条数并同步徽标
  new MutationObserver(requestSweep).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style'],
  });

  // 媒体查询切换不会修改 DOM，需要在窗口尺寸变化后重算显隐和行数。
  window.addEventListener('resize', requestSweep);
  window.addEventListener('load', requestSweep);

  registerMenus();
})();
