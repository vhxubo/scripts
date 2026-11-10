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
let mutationCallback;
globalThis.MutationObserver = class {
  constructor(callback) { mutationCallback = callback; }
  observe() {}
};
globalThis.requestAnimationFrame = () => {};

// ---- 把内部函数导出注入 IIFE 末尾 ----
const EXPORT =
  ';globalThis.__t={baseCost,badgeCost,classifyBadges,findActivityBadge,activityGain,activityLabel,commentDiscount,costBadges,wornCostBadges,optimalBadges,barModel,jwtDecode,normalizeEquipped,isPostDetail,dialogAllowsBar,inCommentContext,barCss,barBtnCss,barTextCss,readCookie,pandoraActive,pandoraEffect,fmtTime,cachedRefresh,syncCommentState,getPair:()=>pair};';
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
const GRAND = { badge_id: '18e085aa-a082-4421-a5f0-5cdb02921c43', badge: { name: '大平衡者', attributes: { badge_name: '大平衡者', coin_system_cost_percent: 0.3 } } };

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
eq(T.commentDiscount(GRAND), 0.3, '大平衡者 coin_system_cost_percent 计入发评减免');
eq(T.badgeCost(80, GRAND), 7, '大平衡者 30%：10×0.7 = 7');
eq(T.badgeCost(5001, GRAND), 140, '大平衡者 30%：200×0.7 = 140');
eq(T.badgeCost(80, null), 10, '未佩戴走基础阶梯');
eq(T.badgeCost(80, PLAIN), 10, '普通徽章不影响费用');

// ---- classifyBadges ----
const c1 = T.classifyBadges([PLAIN, PERCENT, FIXED, GRAND]);
eq(c1.fixed.map((b) => b.badge_id), [FIXED.badge_id], '识别固定扣费徽章');
eq(c1.percent.map((b) => b.badge_id).sort(), [PERCENT.badge_id, GRAND.badge_id].sort(), '识别都听我说与大平衡者两枚减免徽章');
const c2 = T.classifyBadges([PLAIN]);
eq(c2.fixed, [], '无费用徽章时 fixed=[]');
eq(c2.percent, [], '无费用徽章时 percent=[]');
const c3 = T.classifyBadges(null);
eq(c3.fixed, [], '非数组输入容错');

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
eq(c4.fixed, [], '非评论费用字段不误判为固定徽章');
eq(c4.percent.map((b) => b.badge_id), ['u-mashang'], 'coin_system_cost_percent 计入发评减免（马上来 5%）');
const c5 = T.classifyBadges([...REAL_OTHERS, PERCENT]);
eq(c5.percent[0].badge_id, PERCENT.badge_id, '30% 减免排在最前');
eq(c5.percent.map((b) => b.badge_id).includes('u-mashang'), true, '低比例减免仍保留在候选池');
eq(c5.fixed, [], '真实库无固定扣费徽章');

// ---- 「走个面」快捷开关：只认活跃度徽章，且绝不进入费用推荐 ----
// 站点徽章库：id do_me_a_favor / 名称「走个面」/ 佩戴属性「活跃度增加提升 20%」
// （/api/badges/my 的 attributes 采样为 daily_active_gain_percent: 0.2）
const ZOU = REAL_OTHERS.find((b) => b.badge_id === 'u-zou');
eq(T.findActivityBadge([PLAIN, FIXED, ZOU]).badge_id, 'u-zou', '识别持有的走个面徽章');
eq(T.findActivityBadge([PLAIN, FIXED]), null, '未持有走个面时返回 null');
eq(T.findActivityBadge(null), null, '非数组输入容错');
eq(T.findActivityBadge([{ badge_id: 'zou-name', badge: { name: '走个面', attributes: null } }]).badge_id, 'zou-name', 'attributes 缺失时按名称兜底');
eq(T.findActivityBadge([{ badge_id: 'zou-full', badge: { name: '2Libra 走个面儿', attributes: null } }]).badge_id, 'zou-full', '名称包含「走个面」也能识别');
eq(T.findActivityBadge([{ badge_id: 'zou-attr', badge: { name: '别的名字', attributes: { daily_active_gain_percent: 0.2 } } }]).badge_id, 'zou-attr', '活跃度属性兜底识别');
eq(T.findActivityBadge([{ badge_id: 'zou-cat', badge: { id: 'do_me_a_favor', name: '改名了', attributes: null } }]).badge_id, 'zou-cat', '按站点徽章 id 兜底识别');
const ZOU_ID_ONLY = { id: 'zou-id-only', badge: { id: 'zou-id-only', name: '走个面', attributes: { daily_active_gain_percent: 0.2 } } };
eq(T.findActivityBadge([ZOU_ID_ONLY]).badge_id, 'zou-id-only', 'badge.id 归一化为 badge_id');
eq(T.findActivityBadge([{ badge: { name: '走个面', attributes: { daily_active_gain_percent: 0.2 } } }]), null, '缺 badge_id 的条目无法佩戴，忽略');
eq(T.classifyBadges([ZOU]).fixed, [], '走个面不会被当成固定费用徽章');
eq(T.classifyBadges([ZOU]).percent, [], '走个面不会被当成减免徽章');
eq(T.activityGain(ZOU), 20, 'daily_active_gain_percent 0.2 → 20%');
eq(T.activityGain({ badge: { attributes: { daily_active_gain_percent: 20 } } }), 20, '百分数形态 20 → 20%');
eq(T.activityGain({ badge: { attributes: {} } }), null, '缺 active 属性返回 null');
eq(T.activityGain(PLAIN), null, '普通徽章没有活跃度加成');
eq(T.activityLabel(ZOU, false), '走个面 +20%', '未佩戴：只显示徽章名与加成');
eq(T.activityLabel(ZOU, true), '✓ 走个面 +20%', '佩戴时按钮加勾');
eq(T.activityLabel({ badge: { name: '走个面', attributes: null } }, false), '走个面', '属性缺失时只显示名字');
eq(/function toggleActivityBadge\(/.test(src), true, '提供走个面一键佩戴/摘下入口');
eq(/bar\.__activityBtn/.test(src), true, '状态栏持有独立的走个面按钮');
eq(/margin-right:auto/.test(src), true, '走个面入口固定在状态栏最左侧');

// ---- classifyBadges：同类多枚全部保留并按优惠力度排序 ----
const FIXED2 = { badge_id: 'fixed-2', badge: { name: '固定贵', attributes: { comment_cost: -12 } } };
const PERCENT2 = { badge_id: 'percent-2', badge: { name: '减免少', attributes: { comment_cost_percent: 0.1 } } };
const c6 = T.classifyBadges([FIXED2, FIXED, PERCENT2, PERCENT]);
eq(c6.fixed.map((b) => b.badge_id), [FIXED.badge_id, FIXED2.badge_id], '固定徽章按扣费从低到高');
eq(c6.percent.map((b) => b.badge_id), [PERCENT.badge_id, PERCENT2.badge_id], '减免徽章按减免从高到低');

// ---- classifyBadges：条目只有 badge.id 时归一化成 badge_id ----
const ID_ONLY = { id: 'id-only', badge: { id: 'id-only', name: '都听我说！', attributes: { comment_cost_percent: 0.3 } } };
const cId = T.classifyBadges([FIXED, ID_ONLY]);
eq(cId.percent[0].badge_id, 'id-only', 'badge.id 归一化为 badge_id');
eq(T.wornCostBadges(cId, new Set(['id-only']))[0].badge_id, 'id-only', '归一化后可匹配佩戴状态');
const mIdOnly = T.barModel(20, cId, new Set([FIXED.badge_id]));
eq(mIdOnly.actions[0] && mIdOnly.actions[0].badge.badge_id, 'id-only', '归一化后仍能给出切换目标');

// ---- costBadges / optimalBadges ----
const PAIR = T.classifyBadges([FIXED, PERCENT]);
eq(T.costBadges(PAIR).length, 2, '候选池包含两类徽章');
eq(T.optimalBadges(0, PAIR).map((b) => b.badge_id), [PERCENT.badge_id], '0 字最优是 30% 减免');
eq(T.optimalBadges(100, PAIR).map((b) => b.badge_id), [PERCENT.badge_id], '100 字 7 < 8');
eq(T.optimalBadges(101, PAIR).map((b) => b.badge_id), [FIXED.badge_id], '101 字最优是固定 8');
eq(T.optimalBadges(4000, PAIR).map((b) => b.badge_id), [FIXED.badge_id], '长文本最优是固定徽章');
const PAIR_F = T.classifyBadges([FIXED]);
eq(T.optimalBadges(80, PAIR_F).map((b) => b.badge_id), [FIXED.badge_id], '只有固定徽章时推荐它');
eq(T.optimalBadges(80, { fixed: [], percent: [] }), [], '两类都缺时无最优解');
eq(T.optimalBadges(80, T.classifyBadges([FIXED2])), [], '唯一候选贵于基础费用时无最优解');
const PAIR_G = T.classifyBadges([FIXED, PERCENT, GRAND]);
eq(T.optimalBadges(80, PAIR_G).length, 2, '两枚 30% 徽章同时进入最优解');

// ---- barModel：各场景文案与动作 ----
const m1 = T.barModel(85, PAIR, new Set([PERCENT.badge_id]));
eq(m1.count, '85 字', '字数展示');
eq(m1.status, '当前：都听我说！ · 发评约 7 金币', '佩戴减免时状态文案');
eq(m1.hint, '✓ 当前最省', '已是最省时提示');
eq(m1.warn, false, '短文本不告警');
eq(m1.actions, [], '已是最省且没有同价徽章时无动作');

const m2 = T.barModel(85, PAIR, new Set([FIXED.badge_id]));
eq(m2.warn, false, '短文本戴固定徽章不告警');
eq(m2.hint, '可省 1 金币', '短文本切减免可省 1 金币');
eq(m2.actions[0].label, '都听我说！ 7 金币', '切换按钮只留徽章名 + 费用');
eq(m2.actions[0].badge.badge_id, PERCENT.badge_id, '切换目标为减免徽章');

const m3 = T.barModel(120, PAIR, new Set([PERCENT.badge_id]));
eq(m3.warn, true, '超 100 字戴减免徽章触发告警');
eq(m3.hint, '⚠️ 减免 30% 不如固定 8 金币', '告警文案按徽章真实比例生成');
eq(m3.actions[0].label, '前排打手 8 金币', '快捷切换到固定徽章');

const m4 = T.barModel(120, PAIR, new Set([FIXED.badge_id]));
eq(m4.warn, false, '超 100 字戴固定徽章不告警');
eq(m4.hint, '✓ 当前最省', '固定徽章长文本最优');
eq(m4.actions, [], '最优且无同价徽章时无按钮');

const m5 = T.barModel(60, PAIR, new Set([PLAIN.badge_id]));
eq(m5.status, '当前：未佩戴 · 发评约 10 金币', '佩戴普通徽章走基础费用');
eq(m5.actions[0].label, '都听我说！ 7 金币', '推荐切到减免徽章');

const m6 = T.barModel(60, { fixed: [], percent: [] }, new Set());
eq(m6.status, '当前：未佩戴 · 发评约 10 金币', '无徽章数据时仍展示基础费用');
eq(m6.actions, [], '无徽章数据时无动作');
eq(m6.hint, '', '两枚费用徽章都缺时不误报「当前最省」');
eq(m6.warn, false, '两枚费用徽章都缺时不告警');

// ---- 同价并重：戴着 A 时 B 仍作为同价替换展示 ----
const mPeerP = T.barModel(85, PAIR_G, new Set([PERCENT.badge_id]));
eq(mPeerP.hint, '✓ 当前最省', '戴都听我说已是同价最优');
eq(mPeerP.actions.map((a) => a.label), ['大平衡者 7 金币'], '右侧仍给出同价的大平衡者');
const mPeerG = T.barModel(85, PAIR_G, new Set([GRAND.badge_id]));
eq(mPeerG.actions.map((a) => a.label), ['都听我说！ 7 金币'], '戴大平衡者时右侧给出都听我说');
const mPair = T.barModel(85, PAIR_G, new Set());
eq(mPair.actions.map((a) => a.label), ['都听我说！ 7 金币', '大平衡者 7 金币'], '未佩戴时两枚并排');

// ---- 动态文案：不再写死「减免 30%」「超 100 字」 ----
const P10 = { badge_id: 'percent-10', badge: { name: '种子用户', attributes: { comment_cost_percent: 0.1 } } };
const P15 = { badge_id: 'percent-15', badge: { name: '六边形战士', attributes: { comment_cost_percent: 0.15 } } };
const m10 = T.barModel(120, T.classifyBadges([FIXED, P10]), new Set([P10.badge_id]));
eq(m10.hint, '⚠️ 减免 10% 不如固定 8 金币', '10% 徽章按真实比例提示');
eq(m10.actions[0].label, '前排打手 8 金币', '10% 徽章切到固定徽章');
eq(m10.warn, true, '10% 徽章超长时告警');
const m15 = T.barModel(150, T.classifyBadges([FIXED, P15]), new Set([P15.badge_id]));
eq(m15.hint, '⚠️ 减免 15% 不如固定 8 金币', '15% 徽章按真实比例提示');
const m10s = T.barModel(50, T.classifyBadges([FIXED, P10]), new Set([P10.badge_id]));
eq(m10s.warn, true, '10% 徽章 50 字已不划算也告警');
eq(m10s.actions[0].badge.badge_id, FIXED.badge_id, '10% 徽章 50 字应切到固定徽章');
const P_NEG = { badge_id: 'percent-neg', badge: { name: '夜猫', attributes: { comment_cost_percent: -0.2 } } };
const mNeg = T.barModel(50, T.classifyBadges([P_NEG]), new Set([P_NEG.badge_id]));
eq(mNeg.warn, true, '戴着加价徽章要告警');
eq(mNeg.hint, '⚠️ 比不戴贵 2 金币', '加价徽章提示实际差价');
eq(mNeg.actions, [], '加价徽章不提供动作按钮');

// ---- 同价并列：另一枚作为替换展示 ----
const F7 = { badge_id: 'fixed-7', badge: { name: '固定7', attributes: { comment_cost: -7 } } };
const mTie = T.barModel(50, T.classifyBadges([F7, PERCENT]), new Set([PERCENT.badge_id]));
eq(mTie.hint, '✓ 当前最省', '同价视为已最省');
eq(mTie.actions.map((a) => a.label), ['固定7 7 金币'], '同价另一枚作为替换展示');
eq(mTie.warn, false, '同价不告警');

// ---- 比不戴更贵：只提醒，不再提供摘下 ----
const mBad = T.barModel(50, T.classifyBadges([FIXED2]), new Set([FIXED2.badge_id]));
eq(mBad.warn, true, '比不戴更贵时告警');
eq(mBad.hint, '⚠️ 比不戴贵 2 金币', '比不戴更贵的提示');
eq(mBad.actions, [], '不再提供摘下动作');
const F10 = { badge_id: 'fixed-10', badge: { name: '篝火', attributes: { comment_cost: -10 } } };
const mEq = T.barModel(50, T.classifyBadges([F10]), new Set([F10.badge_id]));
eq(mEq.hint, '✓ 当前最省', '同价徽章视为最省');
eq(mEq.actions, [], '同价徽章无动作');

// ---- 无徽章用户：官方分段税全档文案（超 100/1000/2000/5000 → 30/60/120/200） ----
const NO_BADGE = { fixed: [], percent: [] };
for (const [len, cost] of [[60, 10], [100, 10], [101, 30], [1000, 30], [1001, 60], [2001, 120], [5001, 200]]) {
  const m = T.barModel(len, NO_BADGE, new Set());
  eq(m.status, `当前：未佩戴 · 发评约 ${cost} 金币`, `无徽章 ${len} 字显示分段税 ${cost}`);
  eq(m.actions, [], `无徽章 ${len} 字无动作按钮`);
  eq(m.warn, false, `无徽章 ${len} 字不告警`);
}
const m7 = T.barModel(3000, NO_BADGE, new Set([PLAIN.badge_id]));
eq(m7.status, '当前：未佩戴 · 发评约 120 金币', '佩戴普通徽章不影响分段税');

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

// ---- 弹窗注入判定：列表页点击帖子后用原生 <dialog> 渲染正文，地址栏仍是列表页 ----
// 路由判断在这种情况下为 false，必须靠弹窗语境补上；带编辑器的其它弹窗要排除
eq(T.dialogAllowsBar('post-detail-modal-abc', 'modal'), true, '帖子弹窗允许注入');
eq(T.dialogAllowsBar('', 'modal'), true, '无 id 的弹窗不误杀（帖子正文弹窗 id 形态未固定）');
eq(T.dialogAllowsBar(undefined, undefined), true, '空属性容错');
eq(T.dialogAllowsBar('edit-post-modal', 'modal'), false, '编辑帖子弹窗不注入（编辑费率不同）');
eq(T.dialogAllowsBar('add-postscripts-modal', 'modal'), false, '追加附言弹窗不注入（附言费率不同）');
eq(T.dialogAllowsBar('search-modal', 'modal'), false, '搜索弹窗不注入');
eq(T.dialogAllowsBar('node-select-modal-_r_0_', 'modal'), false, '节点选择弹窗不注入');
eq(T.dialogAllowsBar('vote-confirm-modal', 'modal'), false, '投票确认弹窗不注入');
eq(/function inCommentContext\(/.test(src), true, '渲染按编辑器所在语境判断，不再只看路由');
eq(/addEventListener\('toggle'/.test(src), true, '原生 dialog 打开/关闭时补一次渲染');

// ---- inCommentContext：编辑器只要在弹窗里，就按弹窗身份判断，且关闭的帖子弹窗仍算评论语境 ----
// （关闭时保留状态栏，重新打开就不必再插入一次，弹窗内容也就不会二次位移）
function fakeEditor(dlg) {
  return { closest: () => dlg || null, querySelector: () => null };
}
const postDialog = { id: '', className: 'modal modal-open' };
const closedPostDialog = { id: 'post-detail-modal', className: 'modal' };
const editPostDialog = { id: 'edit-post-modal', className: 'modal' };

const savedPath = globalThis.window.location.pathname;
globalThis.window.location.pathname = '/post/ai-tools/o9VSA_1';
eq(T.inCommentContext(fakeEditor(postDialog)), true, '详情页里的帖子弹窗注入');
eq(T.inCommentContext(fakeEditor(editPostDialog)), false, '详情页里的「编辑帖子」弹窗不注入（旧实现会被路由短路）');
eq(T.inCommentContext(fakeEditor(null)), true, '详情页整页评论框注入');

globalThis.window.location.pathname = '/';
eq(T.inCommentContext(fakeEditor(postDialog)), true, '列表页打开的帖子弹窗注入');
eq(T.inCommentContext(fakeEditor(closedPostDialog)), true, '已关闭的帖子弹窗仍算评论语境，状态栏保留以便复用');
eq(T.inCommentContext(fakeEditor(editPostDialog)), false, '列表页「编辑帖子」弹窗不注入');
eq(T.inCommentContext(fakeEditor(null)), false, '列表页非弹窗编辑器不注入');
globalThis.window.location.pathname = savedPath;

// ---- 状态栏布局必须让高度恒定：文案变化只能省略，不能换行把弹窗里的正文顶下去 ----
const barCss = T.barCss();
eq(/flex-wrap:nowrap/.test(barCss), true, '状态栏单行不换行');
eq(/height:28px/.test(barCss), true, '状态栏固定高度 28px');
eq(/min-height:28px/.test(barCss) && /max-height:28px/.test(barCss), true, '状态栏上下限高度固定（不被内容撑高）');
eq(/overflow:hidden/.test(barCss) && /white-space:nowrap/.test(barCss), true, '溢出裁剪 + 不换行，高度不随文案变化');
eq(/height:22px/.test(T.barBtnCss('')), true, '按钮固定高度，不撑高状态栏');
eq(/flex:0 0 auto/.test(T.barBtnCss('')), true, '按钮不收缩，操作入口始终完整');
eq(/min-width:0/.test(T.barTextCss('text')) && /text-overflow:ellipsis/.test(T.barTextCss('text')), true, '长文案用省略号收在一行');
eq(/flex:0 0 auto/.test(T.barTextCss('count')), true, '字数不参与收缩');
// 状态栏按编辑器归属复用，不在「别家节点插进来」时反复删插
eq(/bar\.__editor = editor/.test(src), true, '状态栏记录归属的编辑器，已存在时复用');
eq(/editor\.parentNode !== bar\.parentNode/.test(src), true, '只在归属编辑器被摘走时才回收状态栏');

// ---- 预览页必须与 user.js 同步：node build-preview.js ----
const previewHtml = fs.readFileSync(path.join(__dirname, 'preview.html'), 'utf8');
const previewScript = previewHtml.slice(previewHtml.indexOf('<script>') + '<script>'.length, previewHtml.lastIndexOf('</script>'));
const between = (text, start, end) => {
  const a = text.indexOf(start);
  if (a < 0) return '';
  const lineEnd = text.indexOf('\n', a);
  const b = text.indexOf(end, lineEnd);
  if (lineEnd < 0 || b < 0) return '';
  return text.slice(lineEnd + 1, b);
};
const userLogic = src.slice(
  src.indexOf('  function baseCost'),
  src.indexOf('  // ---------- 工具（纯函数，供测试） ----------'),
);
const previewLogic = between(previewScript, '// ==== SHARED LOGIC START', '// ==== SHARED LOGIC END');
eq(previewLogic.trim() === userLogic.trim(), true, 'preview 共享逻辑与 user.js 同步（运行 node build-preview.js）');
const cssAt = src.indexOf('style.textContent = `');
const userCss = src.slice(cssAt + 'style.textContent = `'.length, src.indexOf('`;', cssAt));
const previewCss = between(previewScript, '/* ==== BAR CSS START', '/* ==== BAR CSS END');
eq(previewCss.trim() === userCss.trim(), true, 'preview 工具栏样式与 user.js 同步（运行 node build-preview.js）');
const userRender = src.slice(
  src.indexOf('  function barCss()'),
  src.indexOf('  function removeBars()'),
);
const previewRender = between(previewScript, '// ==== BAR RENDER START', '// ==== BAR RENDER END');
eq(previewRender.trim() === userRender.trim(), true, 'preview 工具栏渲染与 user.js 同步（运行 node build-preview.js）');

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
eq(mLock.actions, [], '回归起点无动作按钮');
eq(mLock.status.includes('回归起点'), true, '状态栏标注事件名');
eq(mLock.status.includes('锁定'), true, '状态栏说明徽章已锁定');
eq(mLock.status.includes('11-03 09:07'), true, '状态栏展示本地截止时间');

const PE_FIXED = fx({ event_code: 'fixed_text_cost', event_name: '妙笔生花', event_title: '发帖和评论的金币费用固定为 6 金币。', rolled_value: 6 });
const mFixed = T.barModel(5000, PAIR, new Set([FIXED.badge_id]), PE_FIXED);
eq(mFixed.status, '潘多拉「妙笔生花」生效中 · 发评固定 6 金币', '妙笔生花固定费用文案');
eq(mFixed.actions, [], '妙笔生花生效时不切徽章');
eq(mFixed.warn, false, '妙笔生花不告警');

const PE_FREE = fx({ event_code: 'comment_min_length', event_name: '多说多写', event_title: '评论回复只能输入 10 个字以上。有失有得，生效期间，评论不扣除金币。', rolled_value: 10 });
const mFree = T.barModel(50, PAIR, new Set([FIXED.badge_id]), PE_FREE);
eq(mFree.status, '潘多拉「多说多写」生效中 · 发评 0 金币', 'gold 多说多写免费发评');
eq(mFree.hint, '✓ 生效期间评论不扣金币（需 ≥10 字）', '免费发评同时提示字数约束');
eq(mFree.actions, [], '免费发评时不切徽章');

// 金币升降机：评论消费类事件优先，徽章不叠加
const PE_MOD = fx({ event_code: 'coin_modifier_percent', event_name: '金币升降机', event_title: '大部分金币变动 -17%，收益少一点，花费也少一点。', rolled_value: -17 });
const mMod0 = T.barModel(50, PAIR, new Set([FIXED.badge_id]), PE_MOD);
eq(mMod0.status, '潘多拉「金币升降机」生效中 · 11-03 09:07 截止 · 发评约 8 金币', '升降机 -17%：10×0.83 = 8.3 → 8，徽章不叠加');
eq(mMod0.hint, '徽章不叠加：发评费用按事件计算', '升降机提示徽章不叠加');
eq(mMod0.actions, [], '升降机生效时不切徽章');
const mMod3 = T.barModel(120, PAIR, new Set([PERCENT.badge_id]), PE_MOD);
eq(mMod3.status, '潘多拉「金币升降机」生效中 · 11-03 09:07 截止 · 发评约 25 金币', '升降机 -17%：30×0.83 = 24.9 → 25');
const PE_MOD_UP = fx({ event_code: 'coin_modifier_percent', event_name: '金币升降机', event_title: '大部分金币变动 +40%，收益多一点，花费也多一点。', rolled_value: 40 });
const mModUp = T.barModel(80, PAIR, new Set([PERCENT.badge_id]), PE_MOD_UP);
eq(mModUp.status, '潘多拉「金币升降机」生效中 · 11-03 09:07 截止 · 发评约 14 金币', '升降机 +40%：10×1.4 = 14');
eq(mModUp.actions, [], '升降机生效时不切徽章');

// 多说多写：只校验字数，徽章不参与
const PE_MIN = fx({ event_code: 'comment_min_length', event_name: '多说多写', event_title: '评论回复只能输入 10 个字以上。', rolled_value: 10 });
const mMin = T.barModel(5, PAIR, new Set([PERCENT.badge_id]), PE_MIN);
eq(mMin.count, '5/10 字', '多说多写显示字数/门槛');
eq(mMin.status, '潘多拉「多说多写」生效中 · 需 ≥10 字', '多说多写只标注字数门槛');
eq(mMin.hint, '⚠️ 还差 5 字才能发送（需 ≥10 字）', '未达字数给出发送门槛提示');
eq(mMin.warn, true, '字数不足告警');
eq(mMin.actions, [], '多说多写不展示徽章切换');
const mMinOk = T.barModel(50, PAIR, new Set([PERCENT.badge_id]), PE_MIN);
eq(mMinOk.hint, '✓ 已满足 10 字，可以发送', '达到字数后提示可以发送');
eq(mMinOk.actions, [], '多说多写不展示徽章切换');

const PE_EMOJI = fx({ event_code: 'comment_custom_emoji_required', event_name: '小表情', event_title: '评论需要包含至少一个自定义表情。', rolled_value: null });
const mEmoji = T.barModel(50, PAIR, new Set([PERCENT.badge_id]), PE_EMOJI);
eq(mEmoji.hint, '✓ 当前最省 · 潘多拉要求包含自定义表情', '自定义表情约束提示');
eq(mEmoji.actions, [], '小表情不改变徽章动作');

// 与事件无关的头像类事件：徽章逻辑原样
const PE_AVATAR = fx({ event_code: 'avatar_flip', event_name: '颠倒了！', event_title: '你的头像颠倒了 24 小时。', rolled_value: 1 });
const mAvatar = T.barModel(85, PAIR, new Set([PERCENT.badge_id]), PE_AVATAR);
eq(mAvatar.hint, '✓ 当前最省', '头像类事件不影响徽章提示');

// 旧调用形态（不传 pandora）不受影响
const mLegacy = T.barModel(85, PAIR, new Set([PERCENT.badge_id]));
eq(mLegacy.hint, '✓ 当前最省', '不传潘多拉参数时行为一致');

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

// ---- 性能回归：无关 DOM 不排帧、输入仅更新所属编辑器 ----
const frames = [];
globalThis.requestAnimationFrame = (callback) => { frames.push(callback); };
const irrelevantNode = { nodeType: 1, matches: () => false, querySelector: () => null };
const record = (target, addedNodes = [], removedNodes = []) => ({ target, addedNodes, removedNodes });
mutationCallback([record({}, [irrelevantNode])]);
eq(frames.length, 0, '无关页面更新不触发渲染');
mutationCallback([record({ closest: () => ({}) }, [irrelevantNode])]);
eq(frames.length, 0, '助手内部文字更新不触发渲染');
listeners['doc:input']({ target: { closest: () => null } });
eq(frames.length, 0, '搜索框等无关输入不触发渲染');
const detachedEditor = { closest: () => null, isConnected: false };
listeners['doc:input']({ target: { closest: () => detachedEditor } });
listeners['doc:input']({ target: { closest: () => detachedEditor } });
eq(frames.length, 1, '同一帧多次输入合并更新');
const originalQuery = document.querySelectorAll;
let scans = 0;
document.querySelectorAll = () => { scans++; return []; };
frames.shift()();
eq(scans, 0, '输入更新不扫描全页，已卸载编辑器安全跳过');
const editorNode = { nodeType: 1, matches: () => true };
mutationCallback([record({}, [editorNode])]);
eq(frames.length, 1, '新增编辑器触发发现流程');
frames.shift()();
eq(scans > 0, true, '结构变化仍执行全页发现');
mutationCallback([record({}, [], [editorNode])]);
eq(frames.length, 1, '移除编辑器触发清理流程');
frames.shift()();
document.querySelectorAll = originalQuery;

// ---- 异步缓存：真实调用调度器，使用可控时间和延迟响应 ----
(async () => {
  const realNow = Date.now;
  const realTimeout = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  let now = 1000000;
  Date.now = () => now;
  document.cookie = 'access_token=x.' + Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url') + '.x';
  try {
    let calls = 0;
    let finish;
    const refresh = T.cachedRefresh(60000, () => {
      calls++;
      return new Promise((resolve) => { finish = resolve; });
    });
    const first = refresh();
    eq(refresh(), first, '并发刷新复用同一个 Promise');
    await Promise.resolve();
    eq(calls, 1, '并发刷新只发送一次请求');
    finish();
    await first;
    await refresh();
    eq(calls, 1, '冷却期内不重复请求');
    now += 60000;
    const second = refresh();
    await Promise.resolve();
    eq(calls, 2, '60 秒到期后允许查询');
    finish();
    await second;
    const forced = refresh(true);
    await Promise.resolve();
    eq(calls, 3, '手动刷新绕过缓存');
    finish();
    await forced;

    let errors = 0;
    const failing = T.cachedRefresh(60000, async () => { errors++; throw new Error('offline'); });
    await failing();
    now += 60000;
    await failing();
    eq(errors, 1, '失败后至少等待两分钟');
    now += 60000;
    await failing();
    eq(errors, 2, '两分钟后重试');
    now += 239999;
    await failing();
    eq(errors, 2, '连续失败退避至四分钟');
    now++;
    await failing();
    eq(errors, 3, '四分钟到期重试');

    let timers = 0;
    globalThis.setTimeout = () => { timers++; return 1; };
    globalThis.clearTimeout = () => {};
    document.hidden = true;
    T.syncCommentState();
    eq(timers, 0, '后台不启动同步定时器');
    document.hidden = false;
    document.querySelectorAll = () => [];
    T.syncCommentState();
    eq(timers, 0, '没有评论框不启动同步定时器');
    document.querySelectorAll = () => [{ closest: () => ({}) }];
    T.syncCommentState();
    eq(timers, 1, '打开的评论弹窗启动低频定时器');
  } finally {
    Date.now = realNow;
    globalThis.setTimeout = realTimeout;
    globalThis.clearTimeout = realClear;
  }
  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

// 未佩戴且只持有固定费用徽章时，正常给出推荐。
eq(T.barModel(36, T.classifyBadges([FIXED]), new Set()).actions[0].badge.badge_id, FIXED.badge_id, '单固定费用徽章且未佩戴时不崩溃');
