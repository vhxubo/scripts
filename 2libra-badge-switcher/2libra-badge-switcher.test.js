#!/usr/bin/env node
// 2libra 评论金币徽章助手 逻辑测试：直接读取同目录的 2libra-badge-switcher.user.js，
// 注入测试导出后跑断言。运行：node 2libra-badge-switcher.test.js（无外部依赖）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '2libra-badge-switcher.user.js'), 'utf8');

// ---- 模拟油猴环境（注入脚本前就绪） ----
const store = { value: null };
globalThis.GM_getValue = (k, d) => (store.value == null ? d : store.value);
globalThis.GM_setValue = (k, v) => { store.value = v; };
globalThis.GM_registerMenuCommand = () => 1;
globalThis.GM_unregisterMenuCommand = () => {};
const listeners = {};
globalThis.window = {
  location: { pathname: '/post/node/abc' },
  addEventListener(type, callback) { listeners[type] = callback; },
  confirm: () => false,
};
globalThis.document = {
  cookie: '',
  body: null,
  activeElement: null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: { cssText: '' },
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
  }),
  addEventListener(type, callback) { listeners['doc:' + type] = callback; },
};
globalThis.documentElement = globalThis.document.documentElement = {};
globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = () => {};

// ---- 把内部函数导出注入 IIFE 末尾 ----
const EXPORT =
  ';globalThis.__t={baseCost,badgeCost,classifyBadges,recommend,currentCostBadge,barModel,jwtDecode,normalizeEquipped,isPostDetail,readCookie,getPair:()=>pair};';
const closer = '})();';
const last = src.lastIndexOf(closer);
if (last === -1) { console.error('未找到 IIFE 结束标记'); process.exit(1); }
const injected =
  src.slice(0, last) + EXPORT + '\n' + closer + src.slice(last + closer.length);

vm.runInThisContext(injected, { filename: '2libra-badge-switcher.user.js' });
const T = globalThis.__t;
if (!T) { console.error('测试导出失败'); process.exit(1); }

// ---- 测试数据：仿 /api/badges/my 返回的用户徽章（user_badge 形态） ----
const FIXED = { badge_id: 'f30d62e0-f1a7-4bf5-a064-a9ad5a8b394c', badge: { name: '前排打手', attributes: { badge_name: '前排打手', comment_cost: -8 } } };
const PERCENT = { badge_id: 'b0509602-6b04-4d50-ba54-30f5206cf64e', badge: { name: '都听我说！', attributes: { badge_name: '都听我说！', comment_cost_percent: 0.3 } } };
const PLAIN = { badge_id: '130922be-e886-4fef-b830-63501e2f1596', badge: { name: '观月', attributes: null } };

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; } else { failed++; console.error(`✗ ${label}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`); }
}

// ---- baseCost 阶梯边界 ----
eq(T.baseCost(0), 10, 'baseCost(0) = 10');
eq(T.baseCost(100), 10, 'baseCost(100) = 10（含 100）');
eq(T.baseCost(101), 30, 'baseCost(101) = 30');
eq(T.baseCost(1000), 30, 'baseCost(1000) = 30');
eq(T.baseCost(1001), 60, 'baseCost(1001) = 60');
eq(T.baseCost(2000), 60, 'baseCost(2000) = 60');
eq(T.baseCost(2001), 120, 'baseCost(2001) = 120');
eq(T.baseCost(5000), 120, 'baseCost(5000) = 120');
eq(T.baseCost(5001), 200, 'baseCost(5001) = 200');

// ---- badgeCost：固定徽章覆盖阶梯，减免徽章打折 ----
eq(T.badgeCost(20, FIXED), 8, '固定徽章恒为 8');
eq(T.badgeCost(2000, FIXED), 8, '固定徽章超长仍为 8');
eq(T.badgeCost(80, PERCENT), 7, '减免 30%：10×0.7 = 7');
eq(T.badgeCost(150, PERCENT), 21, '减免 30%：30×0.7 = 21');
eq(T.badgeCost(1001, PERCENT), 42, '减免 30%：60×0.7 = 42');
eq(T.badgeCost(2001, PERCENT), 84, '减免 30%：120×0.7 = 84');
eq(T.badgeCost(5001, PERCENT), 140, '减免 30%：200×0.7 = 140');
eq(T.badgeCost(80, null), 10, '未佩戴走基础阶梯');
eq(T.badgeCost(80, PLAIN), 10, '普通徽章不影响费用');

// ---- classifyBadges ----
const c1 = T.classifyBadges([PLAIN, PERCENT, FIXED]);
eq(c1.fixed && c1.fixed.badge_id, FIXED.badge_id, '识别固定扣费徽章');
eq(c1.percent && c1.percent.badge_id, PERCENT.badge_id, '识别减免徽章');
const c2 = T.classifyBadges([PLAIN]);
eq(c2.fixed, null, '无费用徽章时 fixed=null');
eq(c2.percent, null, '无费用徽章时 percent=null');
const c3 = T.classifyBadges(null);
eq(c3.fixed, null, '非数组输入容错');

// ---- recommend：盈亏平衡点在 100 字 ----
const PAIR = { fixed: FIXED, percent: PERCENT };
eq(T.recommend(0, PAIR).badge_id, PERCENT.badge_id, '0 字推荐减免徽章');
eq(T.recommend(100, PAIR).badge_id, PERCENT.badge_id, '100 字推荐减免徽章（7 < 8）');
eq(T.recommend(101, PAIR).badge_id, FIXED.badge_id, '101 字推荐固定徽章（8 < 21）');
eq(T.recommend(4000, PAIR).badge_id, FIXED.badge_id, '长文本推荐固定徽章');
eq(T.recommend(80, { fixed: FIXED, percent: null }).badge_id, FIXED.badge_id, '只有固定徽章时推荐它');
eq(T.recommend(80, { fixed: null, percent: null }), null, '两类都缺时返回 null');

// ---- currentCostBadge ----
eq(T.currentCostBadge(PAIR, new Set([FIXED.badge_id])).badge_id, FIXED.badge_id, '当前佩戴固定徽章');
eq(T.currentCostBadge(PAIR, new Set(['other'])), null, '佩戴其他徽章时为 null');

// ---- barModel：各场景文案与告警 ----
const m1 = T.barModel(85, PAIR, new Set([PERCENT.badge_id]));
eq(m1.count, '85 字', '字数展示');
eq(m1.status, '当前：都听我说！ · 发评约 7 金币', '佩戴减免时状态文案');
eq(m1.hint, '✓ 当前最省', '已是最省时提示');
eq(m1.warn, false, '短文本不告警');
eq(m1.target, null, '已是最省时无切换目标');

const m2 = T.barModel(85, PAIR, new Set([FIXED.badge_id]));
eq(m2.warn, false, '短文本戴固定徽章不告警');
eq(m2.hint, '可省 1 金币', '短文本切减免可省 1 金币');
eq(m2.btn, '切换「都听我说！」（7 金币）', '切换按钮文案');
eq(m2.target && m2.target.badge_id, PERCENT.badge_id, '切换目标为减免徽章');

const m3 = T.barModel(120, PAIR, new Set([PERCENT.badge_id]));
eq(m3.warn, true, '超 100 字戴减免徽章触发告警');
eq(m3.hint, '⚠️ 超 100 字，减免 30% 不再划算', '告警文案');
eq(m3.btn, '切换「前排打手」（8 金币）', '快捷切换到固定徽章');

const m4 = T.barModel(120, PAIR, new Set([FIXED.badge_id]));
eq(m4.warn, false, '超 100 字戴固定徽章不告警');
eq(m4.hint, '✓ 当前最省', '固定徽章长文本最优');

const m5 = T.barModel(60, PAIR, new Set([PLAIN.badge_id]));
eq(m5.status, '当前：无费用徽章 · 发评约 10 金币', '佩戴普通徽章走基础费用');
eq(m5.btn, '切换「都听我说！」（7 金币）', '推荐切到减免徽章');

const m6 = T.barModel(60, { fixed: null, percent: null }, new Set());
eq(m6.status, '当前：无费用徽章 · 发评约 10 金币', '无徽章数据时仍展示基础费用');
eq(m6.target, null, '无徽章数据时无切换目标');
eq(m6.hint, '', '两枚费用徽章都缺时不误报「当前最省」');
eq(m6.warn, false, '两枚费用徽章都缺时不告警');

// ---- jwtDecode ----
const jwt = 'aaa.' +
  'eyJzdWIiOiJlOWRjZTk5YS0xNjBjLTQwYWItOTQwNC1kZGE0ODNkMTNmZDMiLCJ1c2VybmFtZSI6InZoeHVibyIsImlhdCI6MTc5MzIzNzUxNywiZXhwIjoxNzk4NDIxNTE3fQ' +
  '.bbb';
eq(T.jwtDecode(jwt).sub, 'e9dce99a-160c-40ab-9404-dda483d13fd3', 'JWT 解出 sub');
eq(T.jwtDecode(jwt).username, 'vhxubo', 'JWT 解出 username');
const jwtCn = 'x.' +
  'eyJzdWIiOiJhYmMtMTIzIiwidXNlcm5hbWUiOiLkuK3mlofnlKjmiLcifQ' +
  '.y';
eq(T.jwtDecode(jwtCn).username, '中文用户', 'JWT 中文用户名（UTF-8）');
eq(T.jwtDecode('not-a-jwt'), null, '非法 JWT 返回 null');
eq(T.jwtDecode(''), null, '空 token 返回 null');

// ---- normalizeEquipped ----
eq(T.normalizeEquipped([{ badge_id: 'a' }, { badge_id: 'b' }]), ['a', 'b'], 'badge_id 形态');
eq(T.normalizeEquipped([{ badge: { id: 'c' } }]), ['c'], 'badge.id 形态');
eq(T.normalizeEquipped(null), [], 'null 容错');
eq(T.normalizeEquipped([null, { badge_id: 'd' }]), ['d'], '脏数据过滤');

// ---- isPostDetail ----
eq(T.isPostDetail('/post/ai-tools/o9VSA_1'), true, '帖子详情页');
eq(T.isPostDetail('/post-flat/ai-tools/o9VSA_1'), true, '扁平模式详情页');
eq(T.isPostDetail('/post/latest'), false, '聚合列表页 latest');
eq(T.isPostDetail('/post/hot/today'), false, '聚合列表页 hot');
eq(T.isPostDetail('/coins'), false, '金币页');
eq(T.isPostDetail('/create'), false, '发帖页');

// ---- readCookie ----
globalThis.document.cookie = 'a=1; access_token=TOK; refresh_token=R';
eq(T.readCookie('access_token'), 'TOK', '读取 access_token');
globalThis.document.cookie = '';
eq(T.readCookie('access_token'), '', '无 cookie 时返回空串');

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
