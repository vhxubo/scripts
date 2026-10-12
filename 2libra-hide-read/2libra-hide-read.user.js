// ==UserScript==
// @name         2libra 已读帖子隐藏
// @namespace    https://vhxubo.local/2libra-hide-read
// @version      1.0.0
// @description  在 2libra.com 自动隐藏读过的帖子：点击帖子标题（含中键/新标签打开）或进入帖子详情页时记入已读，主列表与「今日热议」等处的已读条目整行隐藏；油猴菜单可临时显示已读、一键清空记录；已读数据存油猴存储、跨标签页同步，超上限自动淘汰最早记录。
// @author       vhxubo
// @match        https://2libra.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'twoLibraHideRead';
  const MAX_RECORDS = 5000;   // 已读记录上限，超出淘汰最早记录
  // true：隐藏已读帖所在整行（主列表 li / 侧栏条目）；false：只隐藏标题链接本身
  const HIDE_WHOLE_ROW = true;
  const TITLE_SELECTOR = 'a.title-link[href]';

  let records = loadRecords(); // { '/post/<节点>/<id>': 首次阅读时间戳 }
  let showRead = false;        // 「临时显示已读」开关，仅当前页面有效
  let menuIds = [];

  // ---------- 存取 ----------
  function loadRecords() {
    try {
      const v = GM_getValue(STORE_KEY, {});
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }

  function saveRecords() {
    const entries = Object.entries(records);
    if (entries.length > MAX_RECORDS) {
      entries.sort((a, b) => b[1] - a[1]);
      records = Object.fromEntries(entries.slice(0, MAX_RECORDS));
    }
    GM_setValue(STORE_KEY, records);
  }

  // ---------- 已读判定与记录 ----------
  // 归一化为帖子路径：剥掉查询串与末尾斜杠；聚合列表页（/post/latest、/post/hot/* 等）
  // 与非帖子链接返回空串
  function postPathOf(url) {
    try {
      const u = new URL(url, location.href);
      let p = u.pathname;
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      if (!p.startsWith('/post/')) return '';
      if (!/^\/post\/[^/]+\/[^/]+/.test(p)) return '';
      if (/^\/post\/latest(?:-comments)?($|\/)/.test(p)) return '';
      if (/^\/post\/hot($|\/)/.test(p)) return '';
      return p;
    } catch (e) {
      return '';
    }
  }

  function isRead(path) {
    return Object.prototype.hasOwnProperty.call(records, path);
  }

  function markRead(path) {
    path = postPathOf(path);
    if (!path || isRead(path)) return;
    records[path] = Date.now();
    saveRecords();
  }

  function checkLocation() {
    markRead(postPathOf(location.href));
  }

  // ---------- 隐藏 ----------
  // 帖子行容器：主列表是 li，侧栏「今日热议」等是带 border-b 的条目 div；兜底隐藏链接本身
  function rowOf(link) {
    return link.closest('li, [class*="border-b"]') || link;
  }

  function sweep() {
    checkLocation();
    const current = location.pathname === '/' ? '/' : location.pathname.replace(/\/+$/, '');
    for (const link of document.querySelectorAll(TITLE_SELECTOR)) {
      const path = postPathOf(link.href);
      const target = HIDE_WHOLE_ROW ? rowOf(link) : link;
      const hide = path && isRead(path) && !showRead && path !== current;
      if (hide) {
        target.style.display = 'none';
      } else {
        target.style.removeProperty('display');
      }
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

  // ---------- 点击记录（捕获阶段，覆盖中键/新标签打开） ----------
  function onActivate(e) {
    const el = e.target;
    const link = el && el.closest ? el.closest('a[href]') : null;
    if (link) {
      markRead(postPathOf(link.href));
      requestSweep(); // 当前列表立即反馈（中键新标签打开时页面不跳转）
    }
  }

  // ---------- 油猴菜单 ----------
  function registerMenus() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      for (const id of menuIds) {
        try { GM_unregisterMenuCommand(id); } catch (e) { /* 忽略 */ }
      }
    }
    menuIds = [];
    const count = Object.keys(records).length;
    menuIds.push(GM_registerMenuCommand(`已读记录 ${count} 条 · 点击清空`, () => {
      if (window.confirm(`确定清空全部 ${count} 条已读记录？隐藏的帖子将重新显示。`)) {
        records = {};
        GM_setValue(STORE_KEY, records);
        requestSweep();
      }
    }));
    menuIds.push(GM_registerMenuCommand(
      showRead ? '已读帖子：临时显示中（点击恢复隐藏）' : '临时显示已读帖子（刷新后失效）',
      () => {
        showRead = !showRead;
        registerMenus();
        requestSweep();
      }
    ));
  }

  // ---------- 启动 ----------
  checkLocation();
  sweep();

  // Next.js 客户端路由：监听 DOM 变化重新扫描（水合、翻页、切换板块都会触发）
  new MutationObserver(requestSweep).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // SPA 路由跳转到达帖子详情页时记录已读
  const hist = typeof unsafeWindow !== 'undefined' ? unsafeWindow.history : window.history;
  for (const method of ['pushState', 'replaceState']) {
    const origin = hist[method];
    hist[method] = function () {
      const result = origin.apply(this, arguments);
      checkLocation();
      requestSweep();
      return result;
    };
  }
  window.addEventListener('popstate', () => {
    checkLocation();
    requestSweep();
  });

  // 点击/中键标题与「最后回复」等帖子链接时立即记录（捕获阶段先于站点脚本）
  document.addEventListener('click', onActivate, true);
  document.addEventListener('auxclick', onActivate, true);

  // 其它标签页新产生的已读记录同步到当前页
  if (typeof GM_addValueChangeListener === 'function') {
    GM_addValueChangeListener(STORE_KEY, () => {
      records = loadRecords();
      requestSweep();
    });
  }

  registerMenus();
})();
