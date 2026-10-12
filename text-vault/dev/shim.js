/**
 * GM API shim — 在无 Tampermonkey 的浏览器里模拟油猴 API,便于本地实测。
 * 暴露 window.TextVault.__debug 供测试断言。
 */
(function () {
  'use strict';

  const store = {};
  const listeners = []; // { key, fn }

  window.GM_getValue = function (key, def) {
    return key in store ? store[key] : def;
  };
  window.GM_setValue = function (key, val) {
    const old = store[key];
    store[key] = val;
    // 模拟「其它标签页」修改:通知 remote 监听者
    listeners.forEach((l) => {
      if (l.key === key) {
        try { l.fn(key, old, val, true); } catch (e) { console.error('[shim] listener error', e); }
      }
    });
  };
  window.GM_registerMenuCommand = function (label, fn) {
    window.__menus = window.__menus || {};
    window.__menus[label] = fn;
    document.dispatchEvent(new CustomEvent('gm-menu', { detail: label }));
  };
  window.GM_setClipboard = function (text) {
    window.__lastClipboard = text;
    document.title = 'clip:' + String(text).slice(0, 40);
  };
  window.GM_addValueChangeListener = function (key, fn) {
    listeners.push({ key, fn });
  };

  // mock 剪贴板读取：默认返回 __lastClipboard；置 window.__denyClipboard = true 模拟权限拒绝
  if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
  navigator.clipboard.readText = function () {
    if (window.__denyClipboard) return Promise.reject(new Error('Document is not focused'));
    return Promise.resolve(window.__lastClipboard == null ? '' : window.__lastClipboard);
  };

  // 测试钩子：捕获脚本创建的 closed shadow root，让 e2e 测试能定位内部元素
  const origAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = origAttach.call(this, init);
    if (this.id === 'text-vault-host') window.__tv = { host: this, root };
    return root;
  };

  window.TextVault = {
    __debug: {
      dump: () => JSON.parse(store.textVaultEntries || '[]'),
      raw: () => store,
      clipboard: () => window.__lastClipboard,
      menus: () => Object.keys(window.__menus || {}),
      runMenu: (label) => window.__menus && window.__menus[label] && window.__menus[label](),
      setClipboard: (t) => { window.__lastClipboard = t; },
    },
  };
})();
