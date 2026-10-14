// ==UserScript==
// @name         2libra 头像原样恢复
// @namespace    https://vhxubo.local/2libra-avatar-restore
// @version      1.1.0
// @description  解除 2libra.com 全站头像组件（class 含 [&_img]:block 的容器）上的处理效果：去掉 blur/saturate 模糊、scale 缩放、rotateY 透视旋转、drop-shadow 投影偏移等 filter/transform 样式，并禁用 avatar-shrink-hover 悬停缩放、avatar-spin-hover 旋转、avatar-zoom-hover 跟随缩放；保留站点「GIF 头像悬停才播放动画」的原生机制（不动 canvas/img 显隐）。油猴菜单可整体开关。
// @author       vhxubo
// @match        https://2libra.com/*
// @run-at       document-start
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // 头像组件根节点的标志性 class：Tailwind 任意变体选择器原样出现在 class 属性里，
  // 站点所有头像容器（列表、侧栏、帖子、个人主页）都带它，普通图片不带
  const SIGNATURE = '[&_img]:block';
  const WRAP_SEL = `[class*="${SIGNATURE}"]`;
  // 站点 avatar_effect 对应的效果类名（pandora_info.avatar_effect），
  // 样式表规则未知部分较多，CSS 兜底 + 摘类名双保险
  const EFFECT_CLASSES = [
    'avatar-shrink-hover', // shrink：子元素 scale(0.4) 悬停缩放
    'avatar-spin-hover',   // spin：avatar-spin-rotate 关键帧无限旋转
    'avatar-zoom-hover',   // zoom：鼠标跟随 transform 缩放
  ];

  function buildCss() {
    const effectSel = EFFECT_CLASSES.map((c) => '.' + c).join(',\n');
    return [
      // 组件内各层 div 都是效果层：blur/saturate 模糊、scale 缩放、rotateY 透视、
      // drop-shadow 投影、skew 角度都以内联样式挂在 div 上，统一清空。
      // !important 同时压过内联样式与站点样式表。
      // 注意：canvas/img 的显隐完全不动——GIF 头像「悬停才播放」由站点控制
      // （静止时显示 canvas 静止帧，悬停时站点把 GIF img 设为 display:block，
      // 移开再藏回），这里的变换清理不涉及 display/opacity，播放机制原样保留。
      `${WRAP_SEL},
${WRAP_SEL} div {
  filter: none !important;
  transform: none !important;
  transition: none !important;
  will-change: auto !important;
  backface-visibility: visible !important;
  perspective: none !important;
}`,
      // 悬停缩放/旋转/跟随缩放：shrink 对子元素 scale(.4)、spin 是关键帧动画、
      // zoom 靠 JS 内联 transform，这里对效果类名兜底（animation 必须单独清）
      `${effectSel},
${effectSel}:hover,
${effectSel}:active {
  filter: none !important;
  transform: none !important;
  transition: none !important;
  animation: none !important;
}`,
    ].join('\n');
  }

  // ---------- 状态与样式注入 ----------
  // document-start 注入，头像不会先模糊一帧再恢复；head 未就绪时挂到 html 上同样生效
  let enabled = true;
  const styleEl = document.createElement('style');
  styleEl.textContent = buildCss();
  (document.head || document.documentElement).appendChild(styleEl);

  function applyEnabled() {
    styleEl.disabled = !enabled;
    if (enabled) requestSweep();
    registerMenu();
  }

  // ---------- 摘除效果类名 ----------
  // 类名摘除比 CSS 兜底更彻底：站点样式表对类名的任何规则（含后续新增）一并失效
  function sweep() {
    if (!enabled) return;
    const selector = EFFECT_CLASSES.map((c) => '.' + c).join(',');
    for (const el of document.querySelectorAll(selector)) {
      for (const c of EFFECT_CLASSES) {
        try { el.classList.remove(c); } catch (e) { /* 非 HTML 元素忽略 */ }
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

  // ---------- 油猴菜单：整体开关 ----------
  let menuId = null;
  function registerMenu() {
    if (typeof GM_unregisterMenuCommand === 'function' && menuId !== null) {
      try { GM_unregisterMenuCommand(menuId); } catch (e) { /* 忽略 */ }
    }
    if (typeof GM_registerMenuCommand !== 'function') return;
    menuId = GM_registerMenuCommand(
      enabled ? '头像原始样式：开启中（点击关闭）' : '头像原始样式：已关闭（点击开启）',
      () => {
        enabled = !enabled;
        applyEnabled();
      }
    );
  }

  // ---------- 启动 ----------
  // Next.js 客户端路由：水合、翻页、切换板块会新增节点，悬停动画会改 class，
  // 统一交给观察者重扫（class 变化需要 attributes 监听）
  new MutationObserver(requestSweep).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  applyEnabled();
})();
