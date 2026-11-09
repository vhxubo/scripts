#!/usr/bin/env node
// 2libra 评论金币徽章助手 逻辑测试：直接读取同目录的 2libra-badge-switcher.user.js，
// 注入测试导出后跑断言。运行：node 2libra-badge-switcher.test.js（无外部依赖）
'use strict';
// 固定时区：潘多拉截止时间按本地时间展示，测试断言 UTC+8 的文案
process.env.TZ = 'Asia/Shanghai';
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
  ';globalThis.__t={baseCost,badgeCost,classifyBadges,recommend,currentCostBadge,barModel,jwtDecode,normalizeEquipped,isPostDetail,readCookie,pandoraActive,pandoraEffect,fmtTime,getPair:()=>pair};';
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
// 官方分段税（无徽章）：超 100/1000/2000/5000 字扣 30/60/120/200，≤100 字扣 10；
// 发帖与评论同表，编辑/附言维持各自费率不走此表
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

// ---- classifyBadges：真实站点其他 attributes 形态不误判 ----
// 采样自站内真实用户徽章库：混沌/卡皮巴拉/捣蛋鬼/马上来/走个面等非评论费用字段
const REAL_OTHERS = [
  { badge_id: 'u-hundun', badge: { name: '混沌', attributes: { badge_name: '混沌', float_percent: 0.5 } } },
  { badge_id: 'u-capy', badge: { name: '卡皮巴拉', attributes: { badge_name: '卡皮巴拉', capybara_rate: 0.1 } } },
  { badge_id: 'u-dann', badge: { name: '捣蛋鬼', attributes: { badge_name: '捣蛋鬼', reverse_coins_rate: 0.34, reverse_large_coins_rate: 0.15 } } },
  { badge_id: 'u-mashang', badge: { name: '马上来', attributes: { badge_name: '马上来', coin_system_cost_percent: 0.05 } } },
  { badge_id: 'u-zou', badge: { name: '走个面', attributes: { daily_active_gain_percent: 0.2 } } },
  { badge_id: 'u-zhou', badge: { name: '2Libra 一周年！', attributes: null } },
];
const c4 = T.classifyBadges(REAL_OTHERS);
eq(c4.fixed, null, '非评论费用字段不误判为固定徽章');
eq(c4.percent, null, 'coin_system_cost_percent 等近似字段不误判为减免徽章');
const c5 = T.classifyBadges([...REAL_OTHERS, PERCENT]);
eq(c5.percent && c5.percent.badge_id, PERCENT.badge_id, '混杂其他徽章时仍准确识别减免徽章（真实单 percent 用户形态）');
eq(c5.fixed, null, '真实单 percent 用户 fixed=null');

// ---- classifyBadges：同类多枚保留更省的一枚 ----
const FIXED2 = { badge_id: 'fixed-2', badge: { name: '固定贵', attributes: { comment_cost: -12 } } };
const PERCENT2 = { badge_id: 'percent-2', badge: { name: '减免少', attributes: { comment_cost_percent: 0.1 } } };
const c6 = T.classifyBadges([FIXED2, FIXED, PERCENT2, PERCENT]);
eq(c6.fixed && c6.fixed.badge_id, FIXED.badge_id, '多枚固定徽章取扣费更低的');
eq(c6.percent && c6.percent.badge_id, PERCENT.badge_id, '多枚减免徽章取减免更多的');

// ---- classifyBadges：条目只有 badge.id 时归一化成 badge_id ----
// /api/badges/my 若返回 {id, badge:{id}} 形态，切换请求不能发出 badge_id: undefined
const ID_ONLY = { id: 'id-only', badge: { id: 'id-only', name: '都听我说！', attributes: { comment_cost_percent: 0.3 } } };
const cId = T.classifyBadges([FIXED, ID_ONLY]);
eq(cId.percent && cId.percent.badge_id, 'id-only', 'badge.id 归一化为 badge_id');
eq(T.currentCostBadge(cId, new Set(['id-only'])).badge_id, 'id-only', '归一化后可匹配佩戴状态');
const mIdOnly = T.barModel(20, cId, new Set([FIXED.badge_id]));
eq(mIdOnly.target && mIdOnly.target.badge_id, 'id-only', '归一化后仍能给出切换目标');

// ---- recommend：盈亏平衡点在 100 字 ----
const PAIR = { fixed: FIXED, percent: PERCENT };
eq(T.recommend(0, PAIR).badge_id, PERCENT.badge_id, '0 字推荐减免徽章');
eq(T.recommend(100, PAIR).badge_id, PERCENT.badge_id, '100 字推荐减免徽章（7 < 8）');
eq(T.recommend(101, PAIR).badge_id, FIXED.badge_id, '101 字推荐固定徽章（8 < 21）');
eq(T.recommend(4000, PAIR).badge_id, FIXED.badge_id, '长文本推荐固定徽章');
eq(T.recommend(80, { fixed: FIXED, percent: null }).badge_id, FIXED.badge_id, '只有固定徽章时推荐它');
eq(T.recommend(80, { fixed: null, percent: null }), null, '两类都缺时返回 null');
// 候选比不戴还贵时不推荐（当前站点无此数据，防御未来徽章）
eq(T.recommend(80, { fixed: FIXED2, percent: null }), null, '唯一候选贵于基础费用时不推荐');
eq(T.recommend(80, { fixed: FIXED2, percent: PERCENT }).badge_id, PERCENT.badge_id, '贵候选让位给省的');

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
eq(m3.hint, '⚠️ 减免 30% 不如固定 8 金币', '告警文案按徽章真实比例生成');
eq(m3.btn, '切换「前排打手」（8 金币）', '快捷切换到固定徽章');

const m4 = T.barModel(120, PAIR, new Set([FIXED.badge_id]));
eq(m4.warn, false, '超 100 字戴固定徽章不告警');
eq(m4.hint, '✓ 当前最省', '固定徽章长文本最优');

const m5 = T.barModel(60, PAIR, new Set([PLAIN.badge_id]));
eq(m5.status, '当前：未佩戴费用徽章 · 发评约 10 金币', '佩戴普通徽章走基础费用');
eq(m5.btn, '切换「都听我说！」（7 金币）', '推荐切到减免徽章');

const m6 = T.barModel(60, { fixed: null, percent: null }, new Set());
eq(m6.status, '当前：未佩戴费用徽章 · 发评约 10 金币', '无徽章数据时仍展示基础费用');
eq(m6.target, null, '无徽章数据时无切换目标');
eq(m6.hint, '', '两枚费用徽章都缺时不误报「当前最省」');
eq(m6.warn, false, '两枚费用徽章都缺时不告警');

// ---- 动态文案：不再写死「减免 30%」「超 100 字」 ----
// 站点真实徽章库还有 10%（种子用户）/ 15%（六边形战士）/ 30%（大平衡者）等档位
const P10 = { badge_id: 'percent-10', badge: { name: '种子用户', attributes: { comment_cost_percent: 0.1 } } };
const P15 = { badge_id: 'percent-15', badge: { name: '六边形战士', attributes: { comment_cost_percent: 0.15 } } };
const m10 = T.barModel(120, { fixed: FIXED, percent: P10 }, new Set([P10.badge_id]));
eq(m10.hint, '⚠️ 减免 10% 不如固定 8 金币', '10% 徽章按真实比例提示');
eq(m10.btn, '切换「前排打手」（8 金币）', '10% 徽章切到固定徽章');
eq(m10.warn, true, '10% 徽章超长时告警');
const m15 = T.barModel(150, { fixed: FIXED, percent: P15 }, new Set([P15.badge_id]));
eq(m15.hint, '⚠️ 减免 15% 不如固定 8 金币', '15% 徽章按真实比例提示');
// 10% 徽章 50 字时 9 > 8 已经不划算，不该只在 >100 字才提醒
const m10s = T.barModel(50, { fixed: FIXED, percent: P10 }, new Set([P10.badge_id]));
eq(m10s.warn, true, '10% 徽章 50 字已不划算也告警');
eq(m10s.target && m10s.target.badge_id, FIXED.badge_id, '10% 徽章 50 字应切到固定徽章');
// 加价徽章（comment_cost_percent 为负）不推荐、不误报最省
const P_NEG = { badge_id: 'percent-neg', badge: { name: '夜猫', attributes: { comment_cost_percent: -0.2 } } };
eq(T.recommend(50, { fixed: null, percent: P_NEG }), null, '加价徽章不推荐');
const mNeg = T.barModel(50, { fixed: null, percent: P_NEG }, new Set([P_NEG.badge_id]));
eq(mNeg.warn, true, '戴着加价徽章要告警');
eq(mNeg.target, null, '加价徽章不给切换目标');

// ---- 同价并列：不再给「可省 0 金币」的无意义按钮 ----
const F7 = { badge_id: 'fixed-7', badge: { name: '固定7', attributes: { comment_cost: -7 } } };
const mTie = T.barModel(50, { fixed: F7, percent: PERCENT }, new Set([PERCENT.badge_id]));
eq(mTie.hint, '✓ 当前最省', '同价视为已最省');
eq(mTie.target, null, '同价无切换目标');
eq(mTie.btn, '', '同价无切换按钮');
eq(mTie.warn, false, '同价不告警');

// ---- 比不戴更贵：给出「摘下」动作，而不是无路可走 ----
// 复用上面的 FIXED2（固定 12 金币），50 字基础只需 10 金币
const mBad = T.barModel(50, { fixed: FIXED2, percent: null }, new Set([FIXED2.badge_id]));
eq(mBad.unequip && mBad.unequip.badge_id, FIXED2.badge_id, '比不戴更贵时给出摘下目标');
eq(mBad.warn, true, '比不戴更贵时告警');
eq(mBad.target, null, '摘下时不给切换目标');
eq(mBad.btn, '摘下「固定贵」（省 2 金币）', '摘下按钮文案');
// 同价（站点「篝火」恒定 10 金币）不算更贵，也不建议摘下
const F10 = { badge_id: 'fixed-10', badge: { name: '篝火', attributes: { comment_cost: -10 } } };
const mEq = T.barModel(50, { fixed: F10, percent: null }, new Set([F10.badge_id]));
eq(mEq.unequip, null, '同价徽章不建议摘下');
eq(mEq.hint, '✓ 当前最省', '同价徽章视为最省');

// ---- 两枚费用徽章同时佩戴：明确提示估算不准并给出摘下动作 ----
const mDual = T.barModel(150, PAIR, new Set([FIXED.badge_id, PERCENT.badge_id]));
eq(mDual.warn, true, '两枚同戴告警');
eq(mDual.unequip && mDual.unequip.badge_id, PERCENT.badge_id, '两枚同戴摘下当次不划算的那枚');
eq(mDual.target, null, '两枚同戴不给切换目标');
eq(mDual.status.includes('同戴'), true, '状态栏标注两枚同戴');
const mDualShort = T.barModel(50, PAIR, new Set([FIXED.badge_id, PERCENT.badge_id]));
eq(mDualShort.unequip && mDualShort.unequip.badge_id, FIXED.badge_id, '短文本时摘下固定徽章');

// ---- 无徽章用户：官方分段税全档文案（超 100/1000/2000/5000 → 30/60/120/200） ----
const NO_BADGE = { fixed: null, percent: null };
for (const [len, cost] of [[60, 10], [100, 10], [101, 30], [1000, 30], [1001, 60], [2001, 120], [5001, 200]]) {
  const m = T.barModel(len, NO_BADGE, new Set());
  eq(m.status, `当前：未佩戴费用徽章 · 发评约 ${cost} 金币`, `无徽章 ${len} 字显示分段税 ${cost}`);
  eq(m.btn, '', `无徽章 ${len} 字无切换按钮`);
  eq(m.target, null, `无徽章 ${len} 字无切换目标`);
  eq(m.warn, false, `无徽章 ${len} 字不告警`);
}
// 无徽章用户佩戴着其他普通徽章：同样按分段税计算
const m7 = T.barModel(3000, NO_BADGE, new Set([PLAIN.badge_id]));
eq(m7.status, '当前：未佩戴费用徽章 · 发评约 120 金币', '佩戴普通徽章不影响分段税');

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
// 非法百分号编码不能让 decodeURIComponent 抛错打断初始化（否则徽章永远加载不出来）
globalThis.document.cookie = 'access_token=%E0%A4%A';
eq(T.readCookie('access_token'), '', '非法百分号编码返回空串而不是抛异常');
globalThis.document.cookie = '';

// ---- 潘多拉事件：pandoraActive 生效窗口 ----
// 载荷采样自 /api/pandora/today 与站点用户 pandora_info（2026-10-18 抽到「回归起点」的真实事件）
const NOW = new Date('2026-11-02T12:00:00+08:00').getTime();
const box = (over = {}) => Object.assign({
  box_instance_id: 'bi-1',
  event_code: 'badge_drop_lock',
  event_name: '回归起点',
  event_title: '当前佩戴的徽章失控掉落且下次开启潘多拉盒子前无法佩戴任何徽章（放心，你的徽章还在😁）。',
  tier_code: 'bronze',
  rarity: 'bronze',
  rolled_value: 0,
  apply_at: '2026-11-02T01:07:17.249Z',
  expire_at: '2026-11-03T01:07:17.249Z',
}, over);
eq(T.pandoraActive(box(), NOW), true, '已生效未到期 → 生效中');
eq(T.pandoraActive(null, NOW), false, '无盒子 → 未生效');
eq(T.pandoraActive({}, NOW), false, '缺 event_code → 未生效');
eq(T.pandoraActive(box({ apply_at: '2026-11-02T12:00:01+08:00' }), NOW), false, 'apply_at 未到 → 待生效');
eq(T.pandoraActive(box({ expire_at: '2026-11-02T11:59:59+08:00' }), NOW), false, 'expire_at 已过 → 已结束');
eq(T.pandoraActive(box({ apply_at: null }), NOW), true, '缺 apply_at 视为已生效');

// ---- 潘多拉事件：pandoraEffect 各事件解析 ----
const fx = (over) => T.pandoraEffect(box(over), NOW);
// 回归起点：徽章掉落锁定
const eDrop = fx();
eq(eDrop.active, true, '回归起点解析为生效');
eq(eDrop.lockBadge, true, '回归起点 → 锁徽章');
eq(eDrop.fixedCost, null, '回归起点无固定费用');
eq(eDrop.name, '回归起点', '事件名透传');
// 妙笔生花：固定费用（rolled_value 优先）
const eFixed = fx({ event_code: 'fixed_text_cost', event_name: '妙笔生花', event_title: '发帖和评论的金币费用固定为 6 金币。', rolled_value: 6 });
eq(eFixed.fixedCost, 6, '妙笔生花 rolled_value = 6');
const eFixedParse = fx({ event_code: 'fixed_text_cost', event_name: '妙笔生花', event_title: '发帖和评论的金币费用固定为 1 金币。', rolled_value: null });
eq(eFixedParse.fixedCost, 1, '妙笔生花缺 rolled_value 时从文案解析为 1');
eq(eFixedParse.freeComment, false, '妙笔生花不是免费评论');
// 金币升降机：±% 乘算
const eMod = fx({ event_code: 'coin_modifier_percent', event_name: '金币升降机', event_title: '大部分金币变动 -17%，收益少一点，花费也少一点。', rolled_value: -17 });
eq(eMod.modifierPct, -17, '金币升降机 -17%');
const eModUp = fx({ event_code: 'coin_modifier_percent', event_name: '金币升降机', event_title: '大部分金币变动 +40%，收益多一点，花费也多一点。', rolled_value: null });
eq(eModUp.modifierPct, 40, '金币升降机 +40% 从文案解析');
// 多说多写：gold 档免评论费 + 最少字数；bronze 档只有字数约束
const eMinGold = fx({ event_code: 'comment_min_length', event_name: '多说多写', event_title: '评论回复只能输入 10 个字以上。有失有得，生效期间，评论不扣除金币。', rolled_value: 10 });
eq(eMinGold.freeComment, true, '多说多写 gold 文案含「不扣除金币」→ 免费评论');
eq(eMinGold.minLength, 10, '多说多写最少 10 字（rolled_value）');
const eMinBronze = fx({ event_code: 'comment_min_length', event_name: '多说多写', event_title: '评论回复只能输入 10 个字以上。', rolled_value: 10, tier_code: 'bronze' });
eq(eMinBronze.freeComment, false, '多说多写 bronze 无免费文案');
eq(eMinBronze.minLength, 10, '多说多写 bronze 仍有 10 字约束');
// 小表情：需要自定义表情
const eEmoji = fx({ event_code: 'comment_custom_emoji_required', event_name: '小表情', event_title: '评论需要包含至少一个自定义表情。', rolled_value: null });
eq(eEmoji.needEmoji, true, '小表情 → 需要自定义表情');
// comment_constraint 形态（pandora_info 侧字段）优先于文案解析
const eCon = fx({ event_code: 'comment_min_length', comment_constraint: { min_length: 12, custom_emoji_required: true } });
eq(eCon.minLength, 12, 'comment_constraint.min_length 优先');
eq(eCon.needEmoji, true, 'comment_constraint.custom_emoji_required 生效');
// 未生效 → 全部字段收起
eq(T.pandoraEffect(box({ expire_at: '2026-11-01T00:00:00Z' }), NOW).active, false, '已过期事件不生效');
eq(T.pandoraEffect(null, NOW).active, false, '无盒子不生效');

// ---- barModel：潘多拉优先级高于徽章 ----
const PE_DROP = fx();
const mLock = T.barModel(50, PAIR, new Set([PERCENT.badge_id]), PE_DROP);
eq(mLock.warn, true, '回归起点生效时告警');
eq(mLock.target, null, '回归起点不给切换目标');
eq(mLock.unequip, null, '回归起点不给摘下目标');
eq(mLock.btn, '', '回归起点无动作按钮');
eq(mLock.status.includes('回归起点'), true, '状态栏标注事件名');
eq(mLock.status.includes('锁定'), true, '状态栏说明徽章已锁定');
eq(mLock.status.includes('11-03 09:07'), true, '状态栏展示本地截止时间');

const PE_FIXED = fx({ event_code: 'fixed_text_cost', event_name: '妙笔生花', event_title: '发帖和评论的金币费用固定为 6 金币。', rolled_value: 6 });
const mFixed = T.barModel(5000, PAIR, new Set([FIXED.badge_id]), PE_FIXED);
eq(mFixed.status, '潘多拉「妙笔生花」生效中 · 发评固定 6 金币', '妙笔生花固定费用文案');
eq(mFixed.target, null, '妙笔生花生效时不切徽章');
eq(mFixed.warn, false, '妙笔生花不告警');

const PE_FREE = fx({ event_code: 'comment_min_length', event_name: '多说多写', event_title: '评论回复只能输入 10 个字以上。有失有得，生效期间，评论不扣除金币。', rolled_value: 10 });
const mFree = T.barModel(50, PAIR, new Set([FIXED.badge_id]), PE_FREE);
eq(mFree.status, '潘多拉「多说多写」生效中 · 发评 0 金币', 'gold 多说多写免费发评');
eq(mFree.hint, '✓ 生效期间评论不扣金币（需 ≥10 字）', '免费发评同时提示字数约束');
eq(mFree.target, null, '免费发评时不切徽章');

// 金币升降机：徽章照常参与推荐，但展示金额乘算（乘法同缩放，谁更省的结论不变）
const PE_MOD = fx({ event_code: 'coin_modifier_percent', event_name: '金币升降机', event_title: '大部分金币变动 -17%，收益少一点，花费也少一点。', rolled_value: -17 });
const mMod0 = T.barModel(50, PAIR, new Set([FIXED.badge_id]), PE_MOD);
eq(mMod0.status, '当前：前排打手 · 发评约 7 金币', '金币升降机 -17%：固定 8×0.83 = 6.64 → 7');
eq(mMod0.btn, '切换「都听我说！」（6 金币）', '切换按钮金额按乘算展示：减免 7×0.83 = 5.81 → 6');
eq(mMod0.hint, '可省 1 金币 · 潘多拉金币变动 -17% 已计入', '升降机提示拼接在徽章提示后');
const mMod3 = T.barModel(120, PAIR, new Set([PERCENT.badge_id]), PE_MOD);
eq(mMod3.status, '当前：都听我说！ · 发评约 17 金币', '减免 21×0.83 = 17.43 → 17');
eq(mMod3.hint, '⚠️ 减免 30% 不如固定 7 金币 · 潘多拉金币变动 -17% 已计入', '告警文案金额同样乘算');
// +40%：减免 30% 的 7 金币 → 10
const PE_MOD_UP = fx({ event_code: 'coin_modifier_percent', event_name: '金币升降机', event_title: '大部分金币变动 +40%，收益多一点，花费也多一点。', rolled_value: 40 });
const mModUp = T.barModel(80, PAIR, new Set([PERCENT.badge_id]), PE_MOD_UP);
eq(mModUp.status, '当前：都听我说！ · 发评约 10 金币', '金币升降机 +40%：7×1.4 = 9.8 → 10');
eq(mModUp.hint, '✓ 当前最省 · 潘多拉金币变动 +40% 已计入', '最优状态也标注升降机');

// 字数/表情约束未满足 → 告警并提示（徽章逻辑照常）
const PE_MIN = fx({ event_code: 'comment_min_length', event_name: '多说多写', event_title: '评论回复只能输入 10 个字以上。', rolled_value: 10 });
const mMin = T.barModel(5, PAIR, new Set([PERCENT.badge_id]), PE_MIN);
eq(mMin.warn, true, '字数不足潘多拉约束时告警');
eq(mMin.hint, '✓ 当前最省 · 潘多拉要求 ≥10 字', '字数约束提示拼接在徽章提示后');
const PE_EMOJI = fx({ event_code: 'comment_custom_emoji_required', event_name: '小表情', event_title: '评论需要包含至少一个自定义表情。', rolled_value: null });
const mEmoji = T.barModel(50, PAIR, new Set([PERCENT.badge_id]), PE_EMOJI);
eq(mEmoji.hint, '✓ 当前最省 · 潘多拉要求包含自定义表情', '自定义表情约束提示');

// 与事件无关的头像/金币雨类事件：徽章逻辑原样，仅按需展示（无额外字段则无拼接）
const PE_AVATAR = fx({ event_code: 'avatar_flip', event_name: '颠倒了！', event_title: '你的头像颠倒了 24 小时。', rolled_value: 1 });
const mAvatar = T.barModel(85, PAIR, new Set([PERCENT.badge_id]), PE_AVATAR);
eq(mAvatar.hint, '✓ 当前最省', '头像类事件不影响徽章提示');

// 旧调用形态（不传 pandora）不受影响
const mLegacy = T.barModel(85, PAIR, new Set([PERCENT.badge_id]));
eq(mLegacy.hint, '✓ 当前最省', '不传潘多拉参数时行为与旧版一致');

// ---- fmtTime ----
eq(T.fmtTime('2026-11-03T01:07:17.249Z'), '11-03 09:07', '截止时间转本地（UTC+8）展示');
eq(T.fmtTime('not-a-date'), '', '非法时间返回空串');

// ---- 自动更新元数据：交给油猴管理器，脚本内不再自检 ----
// 管理器靠 @updateURL + @downloadURL 检查并安装新版本；raw 缓存约 5 分钟，无需 purge
const metaTag = (name) => (src.match(new RegExp('^//[ \\t]*@' + name + '[ \\t]+(\\S+)', 'm')) || [])[1];
const headerVersion = metaTag('version');
eq(/^\d+\.\d+\.\d+$/.test(headerVersion), true, '@version 为三段式版本号');
eq(metaTag('updateURL'), metaTag('downloadURL'), 'updateURL 与 downloadURL 指向同一文件');
eq(metaTag('updateURL').startsWith('https://raw.githubusercontent.com/vhxubo/scripts/main/'), true, '更新地址使用 GitHub raw');
eq(metaTag('updateURL').endsWith('/2libra-badge-switcher/2libra-badge-switcher.user.js'), true, '更新地址指向本脚本');
eq(metaTag('updateURL').includes('cdn.jsdelivr.net'), false, '不使用 jsDelivr 分支缓存（purge 不可靠）');
eq(/^\/\/[ \t]*@grant[ \t]+GM_xmlhttpRequest$/m.test(src), false, '不自检更新，不申请 GM_xmlhttpRequest');
eq(/^\/\/[ \t]*@connect[ \t]+/m.test(src), false, '不自检更新，不声明 @connect');

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
