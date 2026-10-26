#!/usr/bin/env node
// 2libra 表格条数统计 逻辑测试：直接读取同目录的 2libra-table-counter.user.js，注入测试导出后跑断言。
// 运行：node 2libra-table-counter.test.js（无外部依赖）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '2libra-table-counter.user.js'), 'utf8');

// ---- 模拟油猴环境（注入脚本前就绪） ----
const store = { value: null };
globalThis.GM_getValue = (k, d) => (store.value == null ? d : store.value);
globalThis.GM_setValue = (k, v) => { store.value = v; };
globalThis.GM_registerMenuCommand = () => 1;
globalThis.GM_unregisterMenuCommand = () => {};
const listeners = {};
globalThis.window = { location: { pathname: '/coins' }, addEventListener(type, callback) { listeners[type] = callback; } };
globalThis.document = {
  querySelectorAll: () => [],
  createElement: () => ({
    setAttribute() {},
    hasAttribute: () => true, // makeBadge 产出的都是徽标
    style: { cssText: '', display: 'none' },
    textContent: '',
  }),
};
globalThis.documentElement = globalThis.document.documentElement = {};
globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = () => {};
// getComputedStyle：fake 节点用 __display 表达自身 display，缺省视为可见行
globalThis.getComputedStyle = (el) => ({ display: el.__display === undefined ? 'table-row' : el.__display });

// ---- 把内部函数导出注入 IIFE 末尾 ----
const EXPORT =
  ';globalThis.__t={sweep,visibleRowCount,isTableHidden,formatCount,loadEnabled,setEnabled,updateBadge,badgeFor,isEnabled:()=>enabled};';
const closer = '})();';
const last = src.lastIndexOf(closer);
if (last === -1) { console.error('未找到 IIFE 结束标记'); process.exit(1); }
const injected =
  src.slice(0, last) + EXPORT + '\n' + closer + src.slice(last + closer.length);

vm.runInThisContext(injected, { filename: '2libra-table-counter.user.js' });
const T = globalThis.__t;
if (!T) { console.error('测试导出失败'); process.exit(1); }

// ---- fake DOM 节点 ----
// row 传入 display（undefined=可见）；table 支持 tbody 多段、hidden 类、自身 display
function row(display) { return { __display: display }; }
function tbody(rows) { return { rows }; }
function fakeTable({ tbodies = [], cls = '', display } = {}) {
  return {
    __display: display,
    classList: { contains: (c) => cls.split(/\s+/).filter(Boolean).includes(c) },
    tBodies: tbodies,
    previousElementSibling: null,
    parentNode: null,
  };
}
function fakeParent() {
  return { calls: 0, insertBefore(el, ref) { this.calls++; this.inserted = el; this.ref = ref; } };
}

// ---- 断言 ----
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('✗ ' + msg); }
}

// formatCount
ok(T.formatCount(21) === '共 21 条', '21 行应格式化为「共 21 条」');
ok(T.formatCount(0) === '共 0 条', '空表应格式化为「共 0 条」');
ok(T.formatCount(1) === '共 1 条', '单行应格式化为「共 1 条」');

// visibleRowCount：多 tbody 求和、跳过 display:none 行
ok(T.visibleRowCount(fakeTable({ tbodies: [tbody([row(), row(), row()])] })) === 3, '三个可见行计 3');
ok(T.visibleRowCount(fakeTable({ tbodies: [tbody([row(), row('none'), row()])] })) === 2, 'display:none 行不计入');
ok(T.visibleRowCount(fakeTable({ tbodies: [tbody([row()]), tbody([row(), row()])] })) === 3, '多个 tbody 行数求和');
ok(T.visibleRowCount(fakeTable({ tbodies: [tbody([])] })) === 0, '空 tbody 计 0');
ok(T.visibleRowCount(fakeTable({ tbodies: [] })) === 0, '无 tbody 计 0');
ok(T.visibleRowCount(fakeTable({ tbodies: [tbody([row('none'), row('none')])] })) === 0, '全部行隐藏计 0');

// isTableHidden：hidden 类与计算样式双判定
ok(T.isTableHidden(fakeTable({ cls: 'table table-zebra table-sm hidden', display: 'none' })), 'hidden 实际生效时应判隐藏');
ok(!T.isTableHidden(fakeTable({ cls: 'hidden md:table', display: 'table' })), '响应式覆盖 hidden 后表格应显示');
ok(typeof listeners.resize === 'function', '窗口变化时应刷新统计');
ok(typeof listeners.load === 'function', '样式等资源加载后应刷新统计');
ok(T.isTableHidden(fakeTable({ display: 'none' })), '计算样式 display:none 应判隐藏');
ok(!T.isTableHidden(fakeTable({ cls: 'table table-zebra', display: 'block' })), '正常表格不判隐藏');
ok(!T.isTableHidden(fakeTable({ display: 'table' })), 'display:table 不判隐藏');

// loadEnabled：默认开启、损坏数据兜底
ok(T.loadEnabled() === true, '空存储默认开启');
setStored('garbage');
ok(T.loadEnabled() === true, '非布尔存储兜底为开启');
setStored(false);
ok(T.loadEnabled() === false, '读到持久化的关闭状态');
setStored(null);

// updateBadge：文案与显隐写入，且只在变化时写 DOM
setStored(null);
vm.runInThisContext(injected, { filename: '2libra-table-counter.user.js' });
const T2 = globalThis.__t;
const table = fakeTable({ tbodies: [tbody([row(), row(), row('none')])] });
table.parentNode = fakeParent();
T2.updateBadge(table);
const badge = table.parentNode.inserted;
ok(!!badge, '首章更新应插入徽标');
ok(badge.textContent === '共 2 条', '徽标文案应为可见行数（3 行中 1 行隐藏）');
ok(badge.style.display === '', '表格可见且开关开启时徽标显示');
ok(table.parentNode.ref === table, '徽标应插在表格正前方');

// 再次更新：数据变化 → 总数同步变化；无变化 → 不重复插
table.previousElementSibling = badge;
table.tBodies[0].rows.push(row(), row());
T2.updateBadge(table);
ok(badge.textContent === '共 4 条', '新增 2 行后总数应同步为 4');
ok(table.parentNode.calls === 1, '徽标已存在时不应重复插入');

// 表格隐藏（示例中的 hidden 类）→ 徽标同步隐藏；再显示 → 恢复
table.classList = { contains: (c) => c === 'hidden' };
table.__display = 'none';
T2.updateBadge(table);
ok(badge.style.display === 'none', '表格隐藏时徽标应隐藏');
table.classList = { contains: () => false };
table.__display = 'table';
T2.updateBadge(table);
ok(badge.style.display === '', '表格恢复显示时徽标应恢复');

// 相邻表格不能越过前一个表格，复用它的徽标。
const secondTable = fakeTable({ tbodies: [tbody([row()])] });
secondTable.previousElementSibling = table;
table.hasAttribute = () => false;
secondTable.parentNode = fakeParent();
T2.updateBadge(secondTable);
ok(secondTable.parentNode.calls === 1, '相邻的第二张表格应插入独立徽标');
ok(secondTable.parentNode.inserted.textContent === '共 1 条', '第二张表格独立计数');
ok(badge.textContent === '共 4 条', '第二张表格不能覆盖第一张的统计');

// 开关关闭 → 徽标隐藏并持久化；重新注入脚本后仍读到关闭状态
T2.setEnabled(false);
T2.updateBadge(table);
ok(badge.style.display === 'none', '开关关闭时徽标应隐藏');
ok(store.value === false, '开关状态应写入存储');
vm.runInThisContext(injected, { filename: '2libra-table-counter.user.js' });
const T3 = globalThis.__t;
ok(T3.isEnabled() === false, '新页面加载应读到关闭状态');
T3.setEnabled(true);
ok(store.value === true, '重新开启应写回存储');

// 表格未挂载（parentNode 为空）→ 跳过不报错
const detached = fakeTable({ tbodies: [tbody([row()])] });
T3.updateBadge(detached);
ok(true, '未挂载表格不应抛错');

// SPA 路由切换：仅金币页统计，离开时清除。
const scopedTable = fakeTable({ tbodies: [tbody([row()])] });
scopedTable.parentNode = fakeParent();
let removed = 0;
document.querySelectorAll = (selector) => selector === 'table'
  ? [scopedTable] : [{ remove() { removed++; } }];
for (const pathname of ['/', '/coins/history', '/coins-other']) {
  window.location.pathname = pathname;
  T3.sweep();
}
ok(scopedTable.parentNode.calls === 0, '其他页面及相似路径不应创建统计');
ok(removed === 3, '离开金币页面应移除统计');
for (const pathname of ['/coins', '/coins/']) {
  window.location.pathname = pathname;
  T3.sweep();
}
ok(scopedTable.parentNode.calls === 2, '进入金币页面及尾斜杠路径应统计');

function setStored(v) { store.value = v; }

// ---- 汇总 ----
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
