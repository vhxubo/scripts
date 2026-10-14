// ==UserScript==
// @name         2libra 头像原样恢复
// @namespace    https://vhxubo.local/2libra-avatar-restore
// @version      1.0.0
// @description  解除 2libra.com 全站头像组件（class 含 [&_img]:block 的容器）上的处理效果：去掉 blur/saturate 模糊、scale 缩放、rotateY 透视旋转、drop-shadow 投影偏移等 filter/transform 样式；隐藏站点用 canvas 绘制的处理图，直接显示 img 里的原图；禁用 avatar-shrink-hover 悬停缩放。油猴菜单可整体开关。
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
  // 悬停缩放类名：样式表规则未知，摘掉类名 + CSS 兜底双保险
  const SHRINK_CLASS = 'avatar-shrink-hover';

  function buildCss() {
    return [
      // 组件内各层 div 都是效果层（模糊层挂 filter: blur(2px) saturate(.85) 与
      // scale(1.04)，3D 卡片层挂 perspective(300px) rotateY(...)，外层挂
      // drop-shadow 投影），统一清空，!important 覆盖内联样式
      `${WRAP_SEL},
${WRAP_SEL} div {
  filter: none !important;
  transform: none !important;
  transition: none !important;
  will-change: auto !important;
  backface-visibility: visible !important;
  perspective: none !important;
}`,
      // canvas 上画的是站点处理过的图（模糊/低清版本），原图 img 紧随其后被
      // 置为 display:none；有原生 img 兜底时隐藏 canvas 让出位置。
      // 浏览器不支持 :has 时仅丢弃本条规则，img 仍会叠在 canvas 之上，不受影响
      `${WRAP_SEL} canvas:has(+ img) {
  display: none !important;
}`,
      // 恢复被隐藏的原图；img 自带「绝对定位铺满容器 + object-fit: cover」的
      // 内联样式（或与容器等大的自适应宽），位置与原始显示一致
      `${WRAP_SEL} img {
  display: block !important;
  opacity: 1 !important;
  filter: none !important;
  transform: none !important;
}`,
      // 悬停缩放的样式表兜底（具体生效属性未知，覆盖常见状态）
      `.${SHRINK_CLASS},
.${SHRINK_CLASS}:hover,
.${SHRINK_CLASS}:active {
  filter: none !important;
  transform: none !important;
  transition: none !important;
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

  // ---------- 摘除悬停缩放类名 ----------
  function sweep() {
    if (!enabled) return;
    for (const el of document.querySelectorAll('.' + SHRINK_CLASS)) {
      try { el.classList.remove(SHRINK_CLASS); } catch (e) { /* 非 HTML 元素忽略 */ }
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
