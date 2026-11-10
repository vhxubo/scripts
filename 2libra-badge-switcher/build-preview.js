#!/usr/bin/env node
// 从 2libra-badge-switcher.user.js 重新生成 preview.html 的共享逻辑段。
// 运行：node build-preview.js
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const userPath = path.join(dir, '2libra-badge-switcher.user.js');
const htmlPath = path.join(dir, 'preview.html');
const user = fs.readFileSync(userPath, 'utf8');
let html = fs.readFileSync(htmlPath, 'utf8');

const blockStart = user.indexOf('  function baseCost');
const blockEnd = user.indexOf('  // ---------- 工具（纯函数，供测试） ----------');
if (blockStart < 0 || blockEnd < 0) throw new Error('userscript 中找不到共享逻辑段');
const block = user.slice(blockStart, blockEnd).trimEnd() + '\n';

const startMarker = '  // ==== SHARED LOGIC START （由 2libra-badge-switcher.user.js 生成） ====\n';
const endMarker = '  // ==== SHARED LOGIC END ====\n';
const a = html.indexOf(startMarker);
const b = html.indexOf(endMarker);
if (a < 0 || b < 0 || b < a) throw new Error('preview.html 中找不到共享逻辑标记');

html = html.slice(0, a + startMarker.length) + block + html.slice(b);

// 工具栏样式也由 userscript 生成，避免预览与正式版视觉漂移
const cssStart = user.indexOf('style.textContent = `');
const cssEnd = user.indexOf('`;', cssStart);
if (cssStart < 0 || cssEnd < 0) throw new Error('userscript 中找不到工具栏样式');
const css = user.slice(cssStart + 'style.textContent = `'.length, cssEnd).replace(/^\n/, '').replace(/\s+$/, '\n');
const cssStartMarker = '      /* ==== BAR CSS START （由 2libra-badge-switcher.user.js 生成） ==== */\n';
const cssEndMarker = '      /* ==== BAR CSS END ==== */\n';
const c0 = html.indexOf(cssStartMarker);
const c1 = html.indexOf(cssEndMarker);
if (c0 < 0 || c1 < 0 || c1 < c0) throw new Error('preview.html 中找不到样式标记');
html = html.slice(0, c0 + cssStartMarker.length) + css + html.slice(c1);

// 工具栏渲染函数也由 userscript 生成：预览只保留演示外壳
const renderStart = user.indexOf('  function barCss()');
const renderEnd = user.indexOf('  function removeBars()');
if (renderStart < 0 || renderEnd < 0) throw new Error('userscript 中找不到工具栏渲染段');
const render = user.slice(renderStart, renderEnd).trimEnd() + '\n';
const renderStartMarker = '  // ==== BAR RENDER START （由 2libra-badge-switcher.user.js 生成） ====\n';
const renderEndMarker = '  // ==== BAR RENDER END ====\n';
const r0 = html.indexOf(renderStartMarker);
const r1 = html.indexOf(renderEndMarker);
if (r0 < 0 || r1 < 0 || r1 < r0) throw new Error('preview.html 中找不到渲染标记');
html = html.slice(0, r0 + renderStartMarker.length) + render + html.slice(r1);

const version = (user.match(/^\/\/\s*@version\s+(\S+)/m) || [])[1];
if (version) {
  html = html.replace(/(2LIBRA \/ BADGE SWITCHER \/ v)[\d.]+/, `$1${version}`);
}

fs.writeFileSync(htmlPath, html);
console.log(`preview.html 已按 user.js ${version || ''} 重新生成`);
