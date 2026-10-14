#!/usr/bin/env node
// 2libra 头像原样恢复 逻辑测试：直接读取同目录的 2libra-avatar-restore.user.js，
// 注入测试导出后跑断言（生成的 CSS、真实 DOM 结构的 class 匹配、菜单开关行为）。
// 运行：node 2libra-avatar-restore.test.js（无外部依赖）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '2libra-avatar-restore.user.js'), 'utf8');

// ---- 模拟油猴环境（注入脚本前就绪） ----
const styles = []; // document.head.appendChild 捕获的 <style> 桩
globalThis.__styles = styles;
globalThis.GM_registerMenuCommand = (label, cb) => { globalThis.__menu = { label, cb }; return 1; };
globalThis.GM_unregisterMenuCommand = () => {};
globalThis.window = {};
globalThis.document = {
  documentElement: {},
  head: { appendChild: (el) => styles.push(el) },
  createElement: () => ({ textContent: '', disabled: false }),
  querySelectorAll: () => [],
};
// MutationObserver / requestAnimationFrame 仅启动路径会用到，桩掉即可
globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = () => {};

// ---- 把内部常量导出注入 IIFE 末尾 ----
const EXPORT = ';globalThis.__t={SIGNATURE,WRAP_SEL,EFFECT_CLASSES,buildCss};';
const closer = '})();';
const last = src.lastIndexOf(closer);
if (last === -1) { console.error('未找到 IIFE 结束标记'); process.exit(1); }
const injected =
  src.slice(0, last) + EXPORT + '\n' + closer + src.slice(last + closer.length);

vm.runInThisContext(injected, { filename: '2libra-avatar-restore.user.js' });
const T = globalThis.__t;
if (!T) { console.error('测试导出失败'); process.exit(1); }

// ---- 断言 ----
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('✗ ' + msg); }
}

// 真实页面上的头像容器 class（模糊 / 偏移 / 缩放 / 旋转四种样例的根节点一致），
// 内层 class 来自站点 avatar_effect（shrink/spin 挂在内层 div 上）
const SAMPLE_WRAP_CLASS = 'relative leading-none [&_img]:block [&_canvas]:block ';
const SAMPLE_INNER_CLASSES = [
  'bg-base-100 shadow-xs',                                   // 无效果的内层
  'avatar-shrink-hover bg-base-100 shadow-xs',               // shrink：悬停缩放
  'bg-base-100 shadow-xs avatar-spin-hover',                 // spin：关键帧旋转
];
const CSS = T.buildCss();

// 选择器锚点：真实样例的根节点 class 都含有标志性子串（与 [class*="…"] 语义一致）
ok(typeof T.SIGNATURE === 'string' && T.SIGNATURE.length > 0, 'SIGNATURE 应为非空字符串');
ok(SAMPLE_WRAP_CLASS.includes(T.SIGNATURE), '真实头像容器 class 应含有标志性子串');
ok(T.WRAP_SEL === `[class*="${T.SIGNATURE}"]`, 'WRAP_SEL 应为 class 属性包含匹配');

// 各层效果清理：blur / saturate / scale / rotateY / drop-shadow 都落在 filter/transform 上
for (const prop of ['filter: none !important', 'transform: none !important',
  'transition: none !important', 'will-change: auto !important',
  'backface-visibility: visible !important', 'perspective: none !important']) {
  ok(CSS.includes(prop), `应包含覆盖内联样式的 ${prop}`);
}
ok(CSS.includes(`${T.WRAP_SEL},\n${T.WRAP_SEL} div`), '清理规则应同时作用于根节点与所有内层 div');

// GIF 悬停播放机制：脚本不得触碰 canvas/img 的显隐（站点在悬停时自行切换 img 的
// display:block，静止时显示 canvas 静止帧），否则 GIF 会常驻播放或头像空白
ok(!CSS.includes('canvas'), '不应有任何针对 canvas 的规则（悬停播放依赖 canvas 静止帧）');
ok(!/display:\s*block/.test(CSS), '不应强制 img display:block（站点控制悬停时才显示 GIF）');
ok(!/display:\s*none/.test(CSS), '不应强制任何元素 display:none');
ok(!CSS.includes('opacity'), '不应改动透明度（img 渐显由站点控制）');

// 悬停效果类：spin 是关键帧动画，必须清 animation；shrink/zoom 清 transform/transition
ok(Array.isArray(T.EFFECT_CLASSES) && T.EFFECT_CLASSES.length >= 2, '应声明至少两个效果类名');
for (const cls of T.EFFECT_CLASSES) {
  ok(CSS.includes('.' + cls), `CSS 应包含效果类兜底选择器 .${cls}`);
}
ok(/animation: none !important/.test(CSS), '效果类应清 animation（avatar-spin-rotate 关键帧）');
ok(/:hover/.test(CSS) && /:active/.test(CSS), '效果类兜底应覆盖 hover/active 状态');

// sweep 用同一份类名列表拼选择器，能命中真实样例的内层 class
const sweepSelector = T.EFFECT_CLASSES.map((c) => '.' + c).join(',');
for (const inner of SAMPLE_INNER_CLASSES.slice(1)) {
  const hit = T.EFFECT_CLASSES.some((c) => inner.split(/\s+/).includes(c));
  ok(hit, `效果样例内层 class「${inner}」应被 sweep 选择器命中`);
}
ok(!SAMPLE_INNER_CLASSES[0].split(/\s+/).some((c) => T.EFFECT_CLASSES.includes(c)),
  '无效果的内层 class 不应被误伤');
ok(sweepSelector.startsWith('.') && sweepSelector.includes(','), 'sweep 选择器应为多类并集');

// 样式注入：document-start 阶段即挂载，默认启用
ok(styles.length === 1, '应注入恰好一个 <style>');
ok(styles[0].textContent === CSS, '<style> 内容应与 buildCss 生成的一致');
ok(styles[0].disabled === false, '默认应启用');

// 菜单开关：点击后禁用样式并更新文案，再点恢复
ok(globalThis.__menu && globalThis.__menu.label.includes('开启中'), '默认菜单应显示开启中');
globalThis.__menu.cb();
ok(styles[0].disabled === true, '菜单点击后应禁用样式');
ok(globalThis.__menu.label.includes('已关闭'), '菜单文案应反映关闭状态');
globalThis.__menu.cb();
ok(styles[0].disabled === false, '再次点击应恢复启用');
ok(globalThis.__menu.label.includes('开启中'), '菜单文案应恢复开启状态');

// ---- 汇总 ----
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
