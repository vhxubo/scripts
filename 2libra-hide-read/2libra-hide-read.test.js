#!/usr/bin/env node
// 2libra 已读隐藏 逻辑测试：直接读取同目录的 2libra-hide-read.user.js，注入测试导出后跑断言。
// 运行：node 2libra-hide-read.test.js（无外部依赖）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '2libra-hide-read.user.js'), 'utf8');

// ---- 模拟油猴环境（注入脚本前就绪） ----
const store = { value: null };
globalThis.GM_getValue = (k, d) => (store.value == null ? d : store.value);
globalThis.GM_setValue = (k, v) => { store.value = v; };
globalThis.GM_registerMenuCommand = () => 1;
globalThis.GM_unregisterMenuCommand = () => {};
globalThis.GM_addValueChangeListener = (k, cb) => () => {};
globalThis.window = { addEventListener() {}, confirm: () => true, history: { pushState() {}, replaceState() {} } };
globalThis.document = {
  addEventListener() {},
  querySelectorAll: () => [],
  documentElement: {},
  createElement: () => ({}),
  head: { appendChild() {} },
};
globalThis.location = {
  href: 'https://2libra.com/',
  pathname: '/',
  origin: 'https://2libra.com',
  protocol: 'https:',
};
// MutationObserver / requestAnimationFrame 仅启动路径会用到，桩掉即可
globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = (fn) => {};
function setStored(v) { store.value = v; }

// ---- 把内部函数导出注入 IIFE 末尾 ----
const EXPORT =
  ';globalThis.__t={postPathOf,isRead,markRead,loadRecords,saveRecords,records:()=>records};';
const closer = '})();';
const last = src.lastIndexOf(closer);
if (last === -1) { console.error('未找到 IIFE 结束标记'); process.exit(1); }
const injected =
  src.slice(0, last) + EXPORT + '\n' + closer + src.slice(last + closer.length);

vm.runInThisContext(injected, { filename: '2libra-hide-read.user.js' });
const T = globalThis.__t;
if (!T) { console.error('测试导出失败'); process.exit(1); }

// ---- 断言 ----
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('✗ ' + msg); }
}

// postPathOf：归一化与过滤
ok(T.postPathOf('https://2libra.com/post/office-life/45-1PZ1') === '/post/office-life/45-1PZ1',
  '帖子路径应原样返回');
ok(T.postPathOf('https://2libra.com/post/phone/fodWvpc?commentId=abc&p=1') === '/post/phone/fodWvpc',
  '应剥掉查询串（最后回复链接）');
ok(T.postPathOf('https://2libra.com/post/office-life/45-1PZ1/') === '/post/office-life/45-1PZ1',
  '应剥掉末尾斜杠');
ok(T.postPathOf('/post/tech-rumination/V_Z0W94') === '/post/tech-rumination/V_Z0W94',
  '相对路径按当前站点解析');
ok(T.postPathOf('https://2libra.com/post/latest') === '', '聚合页 /post/latest 不算帖子');
ok(T.postPathOf('https://2libra.com/post/latest-comments') === '', '聚合页 /post/latest-comments 不算帖子');
ok(T.postPathOf('https://2libra.com/post/hot/today') === '', '聚合页 /post/hot/today 不算帖子');
ok(T.postPathOf('https://2libra.com/post/hot/recent') === '', '聚合页 /post/hot/recent 不算帖子');
ok(T.postPathOf('https://2libra.com/node/technology/tech-rumination') === '', '节点链接不算帖子');
ok(T.postPathOf('https://2libra.com/user/Daniel/about') === '', '用户链接不算帖子');
ok(T.postPathOf('https://2libra.com/') === '', '首页不算帖子');
ok(T.postPathOf('javascript:void 0') === '', '非法/脚本链接不算帖子');

// markRead / isRead：记录、去重、首次时间戳
setStored({});
T.markRead('/post/office-life/45-1PZ1');
const ts1 = T.records()['/post/office-life/45-1PZ1'];
ok(ts1 > 0, '标记已读应写入时间戳');
ok(T.isRead('/post/office-life/45-1PZ1'), 'isRead 应识别已记录路径');
T.markRead('/post/office-life/45-1PZ1');
ok(Object.keys(T.records()).length === 1, '重复标记不产生重复记录');
ok(T.records()['/post/office-life/45-1PZ1'] === ts1, '重复标记保留首次阅读时间');
T.markRead('');
T.markRead('/post/latest');
ok(Object.keys(T.records()).length === 1, '空路径与聚合页不写入记录');
ok(!T.isRead('/post/tech-rumination/V_Z0W94'), '未读路径 isRead 为假');

// loadRecords：损坏数据兜底
setStored('garbage');
ok(Object.keys(T.loadRecords()).length === 0, '非对象存储应兜底为空记录');
setStored(null);
ok(Object.keys(T.loadRecords()).length === 0, '空存储应兜底为空记录');

// saveRecords：超上限淘汰最早记录（重新注入脚本，模拟新开页面后加载既有记录）
setStored({});
const many = {};
for (let i = 0; i < 5100; i++) {
  many['/post/node/id' + i] = i + 1; // 时间戳递增，i=0 最早
}
setStored(many);
vm.runInThisContext(injected, { filename: '2libra-hide-read.user.js' });
const T2 = globalThis.__t;
T2.markRead('/post/node/brand-new');
const after = T2.records();
ok(Object.keys(after).length === 5000, '超上限后应裁剪到 5000 条');
ok(after['/post/node/brand-new'] > 0, '最新记录保留');
ok(!('/post/node/id0' in after), '最早记录应被淘汰');
ok(after['/post/node/id5099'] > 0, '较新记录保留');

// ---- 汇总 ----
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
