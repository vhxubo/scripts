// ==UserScript==
// @name         2libra 评论金币徽章助手
// @namespace    https://vhxubo.local/2libra-badge-switcher
// @version      1.6.5
// @description  在 2libra.com 帖子页评论框上方实时显示字数与预计金币消耗，识别「固定扣费」（如前排打手恒定 8 金币）与「按比例减免」（如都听我说减 30%）两类评论徽章，按徽章真实参数推荐更省的一种并给出切换按钮，Alt+B 一键切到更省的那枚（已最省时不动，戴着比不戴更贵时改为摘下）；持有「走个面」徽章时在状态栏最左侧提供活跃度 +20% 的一键佩戴/摘下入口（与评论字数、金币费用无关，不参与费用推荐）；每日潘多拉事件优先于徽章逻辑：回归起点锁定徽章时不再给切换按钮、妙笔生花固定费用/多说多写免评论费时徽章退出计费、金币升降机按 ±% 乘算费用、多说多写/小表情给出约束提示；文案与告警阈值由徽章属性与事件文案现算；帖子弹窗（列表页点击帖子时用原生 dialog 渲染）里的评论框同样注入，且状态栏采用定高响应式工具条、长文案省略显示，弹窗动画与打字都不会把正文顶得上下跳动；切换通过 /api/badges/equip 完成，切换前自动检查是否收费；内置自动更新：@updateURL/@downloadURL 指向 GitHub raw，由油猴管理器自动检查并升级（raw 仅缓存约 5 分钟，GitHub Actions 校验版本号递增）。
// @author       vhxubo
// @match        https://2libra.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @updateURL    https://raw.githubusercontent.com/vhxubo/scripts/main/2libra-badge-switcher/2libra-badge-switcher.user.js
// @downloadURL  https://raw.githubusercontent.com/vhxubo/scripts/main/2libra-badge-switcher/2libra-badge-switcher.user.js
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'twoLibraBadgeSwitcherEnabled';
  const BAR_FLAG = 'data-badge-switcher'; // 状态栏标记，用于查找与清理

  // ---------- 状态 ----------
  let enabled = loadEnabled();
  let pair = { fixed: null, percent: null }; // 两类省金币徽章（来自 /api/badges/my）
  let activityBadge = null;                  // 「走个面」活跃度徽章（仅在状态栏最左提供快捷开关）
  let equipped = new Set();                  // 当前已佩戴徽章 badge_id 集合
  let pandoraBox = null;                     // 今日潘多拉盒子（来自 /api/pandora/today 的 d.box）
  let activityPending = ''; // 走个面操作：佩戴中 / 摘下中
  let busy = false;                          // 切换请求进行中
  let menuIds = [];

  // ---------- 存取 ----------
  function loadEnabled() {
    try {
      const v = GM_getValue(STORE_KEY, true);
      return typeof v === 'boolean' ? v : true;
    } catch (e) {
      return true;
    }
  }

  function saveEnabled() {
    try {
      GM_setValue(STORE_KEY, enabled);
    } catch (e) {
      /* 忽略 */
    }
  }

  // ---------- 计费（纯函数，供测试） ----------
  // 基础扣费阶梯，镜像站点前端 COIN_COST.comment：字数越多扣越多
  function baseCost(len) {
    return len > 5000 ? 200 : len > 2000 ? 120 : len > 1000 ? 60 : len > 100 ? 30 : 10;
  }

  // 某枚徽章下发表评论的预计扣费：
  // - 固定扣费徽章（attributes.comment_cost，负数表示扣除）直接覆盖阶梯
  // - 减免徽章（attributes.comment_cost_percent 为减免比例）在阶梯上打折
  // - 其他/未佩戴不影响基础扣费
  function badgeCost(len, ub) {
    const attr = ub && ub.badge && ub.badge.attributes;
    if (!attr) return baseCost(len);
    if (typeof attr.comment_cost === 'number') return Math.abs(attr.comment_cost);
    if (typeof attr.comment_cost_percent === 'number') {
      return Math.round(baseCost(len) * (1 - attr.comment_cost_percent));
    }
    return baseCost(len);
  }

  // /api/badges/my 的条目可能用 badge_id，也可能只带 badge.id（与 equipped 接口同款差异），
  // 统一归一化成 badge_id，避免切换时发出 badge_id: undefined
  function badgeIdOf(ub) {
    if (!ub) return '';
    if (typeof ub.badge_id === 'string') return ub.badge_id;
    if (ub.badge && typeof ub.badge.id === 'string') return ub.badge.id;
    return '';
  }

  function withBadgeId(ub) {
    const id = badgeIdOf(ub);
    return id && ub.badge_id !== id ? Object.assign({}, ub, { badge_id: id }) : ub;
  }

  // 从 /api/badges/my 的列表里挑出两类评论费用徽章；同类多枚时保留更省的一枚。
  // 只认 comment_cost / comment_cost_percent 字段，站内其他 attributes
  // （float_percent、coin_system_cost_percent 等）不会被误判
  function classifyBadges(list) {
    const out = { fixed: null, percent: null };
    for (const raw of Array.isArray(list) ? list : []) {
      const ub = withBadgeId(raw);
      const attr = ub && ub.badge && ub.badge.attributes;
      if (!attr) continue;
      if (typeof attr.comment_cost === 'number') {
        if (!out.fixed || Math.abs(attr.comment_cost) < Math.abs(out.fixed.badge.attributes.comment_cost)) out.fixed = ub;
      } else if (typeof attr.comment_cost_percent === 'number') {
        if (!out.percent || attr.comment_cost_percent > out.percent.badge.attributes.comment_cost_percent) out.percent = ub;
      }
    }
    return out;
  }

  // 徽章比例的中文描述：0.3 → 「减免 30%」，-0.2 → 「增加 20%」
  function pctText(ratio) {
    const pct = Math.round(ratio * 100);
    return pct >= 0 ? `减免 ${pct}%` : `增加 ${-pct}%`;
  }

  // ---------- 「走个面」快捷开关（与评论字数无关） ----------
  // 站点徽章库：id do_me_a_favor / 名称「走个面」/ 佩戴属性 daily_active_gain_percent 0.2
  // （活跃度 +20%）。它不改变评论金币，所以不进入 classifyBadges 的费用推荐，
  // 只在状态栏最左侧提供一个独立的佩戴/摘下入口。
  const ACTIVITY_BADGE_ID = 'do_me_a_favor';
  const ACTIVITY_BADGE_NAME = '走个面';

  function isActivityBadge(badge) {
    if (!badge) return false;
    const attr = badge.attributes || {};
    if (typeof attr.daily_active_gain_percent === 'number') return true;
    const name = String(badge.name || attr.badge_name || '');
    return badge.id === ACTIVITY_BADGE_ID || name.indexOf(ACTIVITY_BADGE_NAME) !== -1;
  }

  function findActivityBadge(list) {
    for (const raw of Array.isArray(list) ? list : []) {
      const ub = withBadgeId(raw);
      if (ub && ub.badge_id && isActivityBadge(ub.badge)) return ub;
    }
    return null;
  }

  // 兼容 0.2（比例）与 20（百分数）两种下发形态；缺失时返回 null
  function activityGain(ub) {
    const attr = ub && ub.badge && ub.badge.attributes;
    const v = attr && attr.daily_active_gain_percent;
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return Math.round(v <= 1 ? v * 100 : v);
  }

  function activityName(ub) {
    const badge = ub && ub.badge;
    return (badge && (badge.name || (badge.attributes && badge.attributes.badge_name))) || ACTIVITY_BADGE_NAME;
  }

  // 按钮文案：桌面明确佩戴动作，窄屏省略动作与「活跃度」，佩戴后加 ✓
  function activityLabel(ub, worn, compact = false) {
    const gain = activityGain(ub);
    return `${worn ? '✓ ' : compact ? '' : '佩戴'}${activityName(ub)} ${gain == null ? '活跃度加成' : `${compact ? '' : '活跃度 '}+${gain}%`}`;
  }

  // ---------- 潘多拉事件（纯函数，供测试） ----------
  // 盒子是否处于「已生效且未到期」：apply_at 未到视为待生效，expire_at 已过视为结束
  function pandoraActive(box, now = Date.now()) {
    if (!box || !box.event_code) return false;
    if (box.apply_at && new Date(box.apply_at).getTime() > now) return false;
    if (box.expire_at && new Date(box.expire_at).getTime() <= now) return false;
    return true;
  }

  // 从事件载荷取数值：优先服务端下发的 rolled_value，缺失时从 event_title 文案兜底解析
  // （/api/pandora/today 的盒子字段未全量验证过，两条路径都保留）
  function pandoraNum(pay, title, re) {
    if (typeof pay.rolled_value === 'number') return pay.rolled_value;
    const m = title.match(re);
    return m ? Number(m[1]) : null;
  }

  // 解析生效中的潘多拉事件对「评论费用估算」的影响。
  // 每个盒子只携带一个事件，因此各标志互斥；未生效返回 { active: false }
  // - badge_drop_lock 回归起点：徽章全部掉落且锁定，无法佩戴 → 徽章逻辑完全让位
  // - fixed_text_cost 妙笔生花：发评费用固定为 N 金币 → 徽章不参与计费
  // - comment_min_length 多说多写：gold 档「评论不扣除金币」→ 免费发评；各档要求 ≥N 字
  // - coin_modifier_percent 金币升降机：大部分金币变动 ±N%；
  //   官方 COINS_MODIFIER_IMMUNE_REASONS 豁免清单不含发帖/评论扣费 → 费用估算需乘算
  // - comment_custom_emoji_required 小表情：评论需包含自定义表情
  function pandoraEffect(box, now = Date.now()) {
    if (!pandoraActive(box, now)) return { active: false };
    const pay = box.payload || box;
    const title = String(pay.event_title || '');
    const code = String(pay.event_code || '');
    const constraint = box.comment_constraint || pay.comment_constraint || {};
    return {
      active: true,
      code,
      name: pay.event_name || code,
      expireAt: box.expire_at || pay.expires_at || null,
      lockBadge: code === 'badge_drop_lock',
      fixedCost: code === 'fixed_text_cost' ? pandoraNum(pay, title, /固定为\s*(\d+)\s*金币/) : null,
      freeComment: /不扣除?金币/.test(title),
      modifierPct: code === 'coin_modifier_percent' ? pandoraNum(pay, title, /([+-]?\d+)\s*%/) : null,
      minLength: typeof constraint.min_length === 'number'
        ? constraint.min_length
        : (code === 'comment_min_length' ? pandoraNum(pay, title, /(\d+)\s*个字/) : null),
      needEmoji: code === 'comment_custom_emoji_required' || constraint.custom_emoji_required === true,
    };
  }

  // 本地时间 MM-DD HH:mm（潘多拉截止时间展示）
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 当前佩戴的费用徽章（最多一枚），其他类型徽章不影响费用。
  function currentCostBadge(p, eq) {
    return [p.fixed, p.percent].find((badge) => badge && eq.has(badge.badge_id)) || null;
  }

  // 推荐更省的一枚；没有相关徽章、或候选都不比不戴省时返回 null
  function recommend(len, p) {
    const cands = [p.fixed, p.percent].filter(Boolean);
    if (!cands.length) return null;
    const best = cands.reduce((a, b) => (badgeCost(len, b) < badgeCost(len, a) ? b : a));
    return badgeCost(len, best) < baseCost(len) ? best : null;
  }

  // 状态栏展示模型（纯函数）
  // - warn：需要红色提醒（当前佩戴已不划算 / 潘多拉约束未满足）
  // - target：建议切换到的徽章；unequip：建议摘下的徽章（二者互斥）
  // - pand：可选的 pandoraEffect(box) 结果；潘多拉事件优先于徽章逻辑
  function barModel(len, p, eq, pand) {
    const base = baseCost(len);
    const pe = pand && pand.active ? pand : null;
    const m = {
      count: `${len} 字`,
      status: '',
      hint: '',
      warn: false,
      target: null,
      unequip: null,
      btn: '',
    };

    // 0) 潘多拉事件接管：徽章无法佩戴 / 费用被固定或免除时，不再给任何徽章动作
    if (pe) {
      const until = pe.expireAt ? ` · ${fmtTime(pe.expireAt)} 截止` : '';
      if (pe.lockBadge) {
        m.status = `潘多拉「${pe.name}」生效中${until} · 徽章已掉落锁定`;
        m.hint = '⚠️ 下次开盒前无法佩戴徽章，按无徽章计费';
        m.warn = true;
        return m;
      }
      if (pe.freeComment) {
        m.status = `潘多拉「${pe.name}」生效中 · 发评 0 金币`;
        m.hint = pe.minLength ? `✓ 生效期间评论不扣金币（需 ≥${pe.minLength} 字）` : '✓ 生效期间评论不扣金币';
        return m;
      }
      if (typeof pe.fixedCost === 'number') {
        m.status = `潘多拉「${pe.name}」生效中 · 发评固定 ${pe.fixedCost} 金币`;
        m.hint = '潘多拉已固定费用，徽章不参与计算';
        return m;
      }
    }

    // 金币升降机：对发评扣费按 ±% 乘算（乘法同缩放不改变「哪枚更省」的判断，只影响展示数值）
    const k = pe && typeof pe.modifierPct === 'number' ? 1 + pe.modifierPct / 100 : 1;
    const scale = (n) => Math.round(n * k);

    const cur = currentCostBadge(p, eq);
    const curCost = badgeCost(len, cur);
    m.status = `当前：${cur ? cur.badge.name : '未佩戴费用徽章'} · 发评约 ${scale(curCost)} 金币`;

    const best = recommend(len, p);

    // 1) 戴着的徽章比不戴还贵：建议摘下（站点存在恒定 10 金币的固定徽章，同价则不算贵）
    if (cur && curCost > base) {
      m.unequip = cur;
      m.btn = `摘下「${cur.badge.name}」（省 ${scale(curCost - base)} 金币）`;
      m.hint = `⚠️ 当前徽章比不戴贵 ${scale(curCost - base)} 金币`;
      m.warn = true;
      return finishPandora(m, len, pe, k);
    }

    const bestCost = best ? badgeCost(len, best) : base;
    // 2) 没有更省的候选、已是最省、或同价（省 0 金币）：不给无意义的切换按钮
    if (!best || (cur && (best === cur || bestCost >= curCost))) {
      m.hint = cur ? '✓ 当前最省' : '';
      return finishPandora(m, len, pe, k);
    }

    // 3) 有更省的一枚
    m.target = best;
    m.btn = `切换「${best.badge.name}」（${scale(bestCost)} 金币）`;
    if (cur && cur === p.percent) {
      m.warn = true;
      m.hint = `⚠️ ${pctText(p.percent.badge.attributes.comment_cost_percent)} 不如固定 ${scale(bestCost)} 金币`;
    } else {
      m.hint = `可省 ${scale(curCost - bestCost)} 金币`;
    }
    return finishPandora(m, len, pe, k);
  }

  // 徽章分支收尾：叠加潘多拉的费用乘算说明与评论约束提示
  function finishPandora(m, len, pe, k) {
    if (!pe) return m;
    const tags = [];
    if (k !== 1) tags.push(`潘多拉金币变动 ${pe.modifierPct > 0 ? '+' : ''}${pe.modifierPct}% 已计入`);
    if (pe.minLength && len < pe.minLength) {
      tags.push(`潘多拉要求 ≥${pe.minLength} 字`);
      m.warn = true;
    }
    if (pe.needEmoji) tags.push('潘多拉要求包含自定义表情');
    if (tags.length) m.hint = [m.hint, tags.join(' · ')].filter(Boolean).join(' · ');
    return m;
  }

  // ---------- 工具（纯函数，供测试） ----------
  // 解码 JWT payload（只需 sub / username），失败返回 null
  function jwtDecode(token) {
    try {
      const b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  // equipped 接口兼容两种形态：[{badge_id}] 或 [{badge:{id}}]
  function normalizeEquipped(d) {
    if (!Array.isArray(d)) return [];
    return d
      .map((x) => (x && typeof x.badge_id === 'string' ? x.badge_id : x && x.badge && x.badge.id))
      .filter(Boolean);
  }

  // 帖子详情页（含扁平模式 /post-flat/...），排除聚合列表页
  function isPostDetail(pathname) {
    if (!/^\/post(?:-flat)?\/[^/]+\/[^/]+/.test(pathname)) return false;
    return !/^\/post\/(?:latest(?:-comments)?|hot)(?:\/|$)/.test(pathname);
  }

  // ---------- 注入环境（整页 / 弹窗） ----------
  // 站点有两种呈现帖子的方式：整页 /post/节点/短ID，以及列表页点击帖子后在原生 <dialog> 里弹出
  // （地址栏仍停在列表页）。所以「要不要插状态栏」得看编辑器所处的位置，只看路由会漏掉弹窗。
  // 弹窗里同样带 markdown 编辑器的还有「编辑帖子」「追加附言」「搜索」等，用 id/class 排除掉，
  // 免得在这些非评论场景里也插一条费用估算。
  const NON_COMMENT_DIALOG_RE = /(edit-post|postscript|compose|draft|search|login|register|settings|node-select|rule|redeem|vote|bet|collection|pin-manage|anonymous|pandora|sign|avatar|profile|violation)/i;

  function dialogAllowsBar(id, cls) {
    return !NON_COMMENT_DIALOG_RE.test(`${id || ''} ${cls || ''}`);
  }

  function readCookie(name) {
    try {
      const hit = document.cookie.split(/;\s*/).find((c) => c.startsWith(name + '='));
      return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
    } catch (e) {
      // cookie 里出现非法百分号编码时 decodeURIComponent 会抛错，
      // 不能让它打断初始化（否则徽章/佩戴状态永远拿不到）
      return '';
    }
  }

  // ---------- API ----------
  function errText(e) {
    return e && e.message ? e.message : String(e);
  }

  async function apiJson(path, options) {
    const token = readCookie('access_token');
    const res = await fetch(path, Object.assign({
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
    }, options));
    const data = await res.json();
    if (!res.ok || data.c !== 0) throw new Error(data.m || `HTTP ${res.status}`);
    return data.d;
  }

  // 各接口独立缓存、合并并发请求；失败保留旧数据并退避至最多 10 分钟。
  function cachedRefresh(interval, load) {
    let pending = null;
    let nextAt = 0;
    let failures = 0;
    return function (force = false) {
      if (pending) return pending;
      if (!force && Date.now() < nextAt) return Promise.resolve();
      const jwt = jwtDecode(readCookie('access_token'));
      if (!jwt || !jwt.sub) return Promise.resolve();
      pending = Promise.resolve().then(() => load(jwt)).then(() => {
        failures = 0;
        nextAt = Date.now() + interval;
      }).catch(() => {
        failures++;
        nextAt = Date.now() + Math.min(600000, 60000 * 2 ** Math.min(failures, 4));
      }).finally(() => {
        pending = null;
        requestRender();
      });
      return pending;
    };
  }

  const refreshBadges = cachedRefresh(600000, async () => {
    const my = await apiJson('/api/badges/my');
    pair = classifyBadges(my);
    activityBadge = findActivityBadge(my);
  });

  const refreshEquipped = cachedRefresh(60000, async (jwt) => {
    const eq = await apiJson(`/api/badges/user/${jwt.sub}/equipped`);
    equipped = new Set(normalizeEquipped(eq));
  });

  const refreshPandora = cachedRefresh(300000, async () => {
    const d = await apiJson('/api/pandora/today');
    pandoraBox = d && d.box ? d.box : d && d.event_code ? d : null;
  });

  function initData(force = false) {
    return Promise.all([refreshBadges(force), refreshEquipped(force), refreshPandora(force)]);
  }

  // 定时器仅在前台有打开的评论框时存在；输入/聚焦/重新打开共用缓存。
  let syncTimer = null;
  function hasOpenCommentEditor() {
    return Array.from(document.querySelectorAll(EDITOR_SELECTOR)).some((editor) =>
      inCommentContext(editor) && (!dialogOf(editor) || !!openDialogOf(editor)));
  }

  function syncCommentState() {
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = null;
    if (!enabled || document.hidden || !hasOpenCommentEditor()) return;
    // 避免旧的 GET 响应覆盖正在进行的佩戴操作。
    if (!busy) initData();
    syncTimer = setTimeout(syncCommentState, 60000);
  }

  // 佩戴单枚徽章：先查本次切换是否收费，避免静默花金币。
  // 返回 true 表示已佩戴，false 表示用户取消。
  async function equipBadge(target) {
    let need = false;
    let amount = 0;
    try {
      const ck = await apiJson('/api/badges/equip/check-cost');
      need = !!(ck && ck.needCost);
      amount = (ck && ck.costAmount) || 0;
    } catch (e) {
      /* 检查失败不阻塞切换 */
    }
    if (need && amount > 0) {
      const ok = window.confirm(`本次切换徽章需消耗 ${amount} 金币，是否继续？`);
      if (!ok) return false;
    }
    // 在真正操作前重新确认事件；锁定由站点负责移除徽章，助手不再发佩戴请求。
    await refreshPandora(true);
    const pe = pandoraEffect(pandoraBox);
    if (pe.active && pe.lockBadge) {
      throw new Error(`潘多拉「${pe.name}」生效中，无法佩戴徽章`);
    }
    await refreshEquipped(true);
    if (equipped.size === 1 && equipped.has(target.badge_id)) return true;
    // 佩戴接口会直接替换当前徽章，无需先摘下。
    await apiJson('/api/badges/equip', {
      method: 'POST',
      body: JSON.stringify({ badge_id: target.badge_id, equip: true }),
    });
    equipped = new Set([target.badge_id]);
    return true;
  }

  // 切换费用徽章：统一通过单徽章佩戴入口替换当前徽章。
  async function switchTo(target) {
    if (busy || !target) return;
    // 防御：回归起点生效期间佩戴请求必然失败，直接拦截（状态栏正常时不会走到这里）
    const pe = pandoraEffect(pandoraBox);
    if (pe.active && pe.lockBadge) {
      toast(`潘多拉「${pe.name}」生效中：下次开盒前无法佩戴徽章`, true);
      return;
    }
    busy = true;
    await refreshEquipped();
    requestRender();
    try {
      if (!(await equipBadge(target))) return;
      toast(`已切换为「${target.badge.name}」`);
    } catch (e) {
      toast(`切换失败：${errText(e)}`, true);
    } finally {
      busy = false;
      refreshEquipped(true);
    }
  }

  // 「走个面」快捷开关：只看徽章是否佩戴，与评论字数/费用推荐完全无关。
  // 佩戴时同样会替换当前徽章，最多只能佩戴一枚。
  async function toggleActivityBadge() {
    if (busy || !activityBadge) return;
    const pe = pandoraEffect(pandoraBox);
    if (pe.active && pe.lockBadge) {
      toast(`潘多拉「${pe.name}」生效中：下次开盒前无法佩戴徽章`, true);
      return;
    }
    const badge = activityBadge;
    const name = activityName(badge);
    const removing = equipped.has(badge.badge_id);
    activityPending = removing ? '摘下中…' : '佩戴中…';
    busy = true;
    requestRender();
    try {
      await refreshEquipped();
      if (removing) {
        await apiJson('/api/badges/equip', {
          method: 'POST',
          body: JSON.stringify({ badge_id: badge.badge_id, equip: false }),
        });
        equipped.delete(badge.badge_id);
        toast(`已摘下「${name}」`);
      } else {
        if (!(await equipBadge(badge))) return;
        equipped.add(badge.badge_id);
        const gain = activityGain(badge);
        toast(`已佩戴「${name}」${gain == null ? '，活跃度加成已生效' : `，活跃度 +${gain}%`}`);
      }
    } catch (e) {
      toast(`${removing ? '摘下' : '佩戴'}「${name}」失败：${errText(e)}`, true);
    } finally {
      activityPending = '';
      busy = false;
      requestRender();
      refreshEquipped(true);
    }
  }

  // 摘下徽章：当前佩戴比不戴更贵时由状态栏 / Alt+B 触发
  async function unequip(badge) {
    if (busy || !badge) return;
    busy = true;
    await refreshEquipped();
    requestRender();
    try {
      await apiJson('/api/badges/equip', {
        method: 'POST',
        body: JSON.stringify({ badge_id: badge.badge_id, equip: false }),
      });
      equipped.delete(badge.badge_id);
      toast(`已摘下「${badge.badge.name}」`);
    } catch (e) {
      toast(`摘下失败：${errText(e)}`, true);
    } finally {
      busy = false;
      refreshEquipped(true);
    }
  }

  // ---------- 状态栏 ----------
  const EDITOR_SELECTOR = '.w-md-editor';
  const INPUT_SELECTOR = '.w-md-editor-text-input, .w-md-editor-text textarea, textarea';
  // 原生 <dialog>（daisyUI 的 modal 也基于它），以及老式的 .modal.modal-open 容器
  const DIALOG_SELECTOR = 'dialog[open], .modal.modal-open, [role="dialog"]';
  // 不看开合状态的容器选择器：关掉的弹窗里编辑器仍然在 DOM 里
  const DIALOG_ANY_SELECTOR = 'dialog, .modal, [role="dialog"]';

  function openDialogOf(el) {
    return el && typeof el.closest === 'function' ? el.closest(DIALOG_SELECTOR) : null;
  }

  // 编辑器所在的弹窗，不要求当前是打开状态
  function dialogOf(el) {
    return el && typeof el.closest === 'function' ? el.closest(DIALOG_ANY_SELECTOR) : null;
  }

  // 编辑器是否处在「帖子评论」语境：详情页整页，或列表页上弹出的帖子弹窗。
  // 只要编辑器在弹窗里就按弹窗身份判断（编辑帖子、追加附言、搜索等弹窗永远排除），
  // 弹窗已关闭也仍算「评论语境」——这样关掉再打开时状态栏还在原地，不必重新插入。
  function inCommentContext(editor) {
    const dlg = dialogOf(editor);
    if (dlg) return dialogAllowsBar(dlg.id, dlg.className);
    return isPostDetail(window.location.pathname);
  }

  function editorText(editor) {
    const ta = editor.querySelector(INPUT_SELECTOR);
    return ta && ta.value ? ta.value : '';
  }

  // 每种宽度下保持定高，输入和推荐变化不会推动编辑器。
  const BAR_HEIGHT = 28;
  const BAR_BTN_HEIGHT = 22;

  function ensureBarStyles() {
    if (document.querySelector('#two-libra-badge-styles')) return;
    const style = document.createElement('style');
    style.id = 'two-libra-badge-styles';
    style.textContent = `
      [data-badge-switcher] {
        --badge-accent:var(--color-primary,#087f8c);
        --badge-soft:var(--color-base-100,#e8f5f5);
        --badge-border:var(--color-base-300,#d7e5e7);
        --badge-surface:var(--color-base-200,#f6fafb);
        --badge-ink:var(--color-base-content,#344d59);
        --badge-danger:color-mix(in oklab,var(--color-error,#dc2626) 65%,var(--badge-ink));
        --badge-success:color-mix(in oklab,var(--color-success,#15803d) 65%,var(--badge-ink));
        --badge-warning:color-mix(in oklab,var(--color-warning,#b45309) 65%,var(--badge-ink));
        --badge-activity-accent:var(--color-secondary,var(--badge-accent));
        --badge-action-ink:color-mix(in oklab,var(--badge-accent) 40%,var(--badge-ink));
        container-type:inline-size;
        color:var(--badge-ink);
        font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
      }
      [data-badge-switcher] button {
        color:var(--badge-ink); background:var(--badge-soft);
        border-color:var(--badge-border);
      }
      [data-badge-switcher] button:hover:not(:disabled) {
        background:var(--badge-border);
      }
      [data-badge-switcher] button:focus-visible {
        outline:2px solid var(--badge-accent); outline-offset:2px;
      }
      [data-badge-switcher] button:disabled { cursor:wait; opacity:.55; }
      [data-badge-switcher] .badge-count {
        color:var(--badge-ink); font-weight:600; font-size:11px;
        width:8ch; text-align:right;
        font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;
      }
      [data-badge-switcher] .badge-status { flex:1 1 auto; }
      [data-badge-switcher] .badge-hint { max-width:26%; }
      [data-badge-switcher] .badge-activity {
        width:180px;
        color:color-mix(in oklab,var(--badge-activity-accent) 40%,var(--badge-ink));
        background:var(--badge-soft);
        border-color:color-mix(in oklab,var(--badge-activity-accent) 30%,var(--badge-border));
        border-style:dashed;
      }
      [data-badge-switcher] .badge-activity[aria-pressed="true"] {
        background:color-mix(in oklab,var(--badge-activity-accent) 10%,var(--badge-soft));
        border-style:solid;
      }
      [data-badge-switcher] .badge-activity:hover:not(:disabled) {
        background:color-mix(in oklab,var(--badge-activity-accent) 16%,var(--badge-soft));
      }
      [data-badge-switcher] .badge-activity-compact { display:none; }
      [data-badge-switcher] .badge-hint:empty { display:none; }
      [data-badge-switcher] .badge-action {
        width:184px; max-width:30%;
        background:color-mix(in oklab,var(--badge-accent) 8%,var(--badge-soft));
        color:var(--badge-action-ink);
        border-color:color-mix(in oklab,var(--badge-accent) 20%,var(--badge-border));
      }
      [data-badge-switcher] .badge-action:hover:not(:disabled) {
        background:color-mix(in oklab,var(--badge-accent) 14%,var(--badge-soft));
      }
      @container (max-width:620px) {
        [data-badge-switcher] .badge-hint { display:none; }
        [data-badge-switcher] .badge-activity { width:120px; }
        [data-badge-switcher] .badge-activity-full { display:none; }
        [data-badge-switcher] .badge-activity-compact { display:inline; }
        [data-badge-switcher] button { max-width:35%; }
      }
    `;
    (document.head || document.body).appendChild(style);
  }

  function barCss() {
    return [
      'display:flex',
      'flex-wrap:nowrap',
      'align-items:center',
      'justify-content:flex-end',
      'gap:0 6px',
      'box-sizing:border-box',
      `height:${BAR_HEIGHT}px`,
      `min-height:${BAR_HEIGHT}px`,
      `max-height:${BAR_HEIGHT}px`,
      'overflow:hidden',
      'font-size:11px',
      'line-height:18px',
      'white-space:nowrap',
      'margin:0 0 4px',
      'padding:2px 0',
      'user-select:none',
    ].join(';');
  }

  // 按钮使用稳定宽度，长文案省略，避免推荐变化时挤动其他信息。
  function barBtnCss(extra) {
    return [
      'flex:0 0 auto',
      'box-sizing:border-box',
      `height:${BAR_BTN_HEIGHT}px`,
      'padding:0 6px',
      'border:1px solid',
      'border-radius:4px',
      'font-family:inherit',
      'font-size:11px',
      'font-weight:600',
      'line-height:20px',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'cursor:pointer',
      extra || '',
    ].join(';');
  }

  // 可变长文案：min-width:0 + 省略号，宽度不够时优先压缩它们而不是换行
  function barTextCss(kind) {
    return kind === 'count'
      ? 'flex:0 0 auto;font-variant-numeric:tabular-nums;'
      : 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;';
  }

  function makeBar() {
    ensureBarStyles();
    const bar = document.createElement('div');
    bar.setAttribute(BAR_FLAG, '');
    bar.style.cssText = barCss();

    // 最左侧的「走个面」快捷开关：右侧自动间距让其他内容保持右对齐，
    // 未持有该徽章时整颗按钮隐藏（不占位、不影响原有布局）
    const activityBtn = document.createElement('button');
    activityBtn.type = 'button';
    activityBtn.className = 'badge-activity';
    activityBtn.style.cssText = barBtnCss('margin-right:auto;display:none;max-width:30%');
    for (const variant of ['full', 'compact']) {
      const label = document.createElement('span');
      label.className = `badge-activity-${variant}`;
      activityBtn.appendChild(label);
    }
    activityBtn.addEventListener('click', toggleActivityBadge);
    bar.__activityBtn = activityBtn;
    bar.appendChild(activityBtn);

    const countEl = document.createElement('span');
    const statusEl = document.createElement('span');
    const hintEl = document.createElement('span');
    countEl.className = 'badge-count';
    statusEl.className = 'badge-status';
    hintEl.className = 'badge-hint';
    countEl.style.cssText = barTextCss('count');
    statusEl.style.cssText = barTextCss('text');
    hintEl.style.cssText = barTextCss('text');
    bar.__countEl = countEl;
    bar.__statusEl = statusEl;
    bar.__hintEl = hintEl;
    bar.appendChild(countEl);
    bar.appendChild(statusEl);
    bar.appendChild(hintEl);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'badge-action';
    btn.style.cssText = barBtnCss('');
    btn.addEventListener('click', () => {
      const act = bar.__action;
      if (!act) return;
      if (act.type === 'switch') switchTo(act.badge);
      else unequip(act.badge);
    });
    bar.__actionBtn = btn;
    bar.appendChild(btn);
    return bar;
  }

  // 状态栏与编辑器一一对应，归属记在 bar.__editor 上。
  // 站点重渲染时可能在两者之间插入别的节点（上传遮罩、emoji 面板…），
  // 这时不能把状态栏搬来搬去——移动节点同样是一次「删 + 插」，会带来多余的重排；
  // 只要这条状态栏还归这个编辑器用，就留在原地继续更新。
  function barFor(editor) {
    const reusable = (el) => el
      && el.hasAttribute
      && el.hasAttribute(BAR_FLAG)
      && (!el.__editor || !el.__editor.isConnected || el.__editor === editor);
    const previous = editor.previousElementSibling;
    if (reusable(previous)) {
      previous.__editor = editor;
      return previous;
    }
    const parent = editor.parentNode;
    if (!parent) return null; // 编辑器暂未挂载，等下一次渲染
    for (const child of parent.children) {
      if (reusable(child)) {
        child.__editor = editor;
        return child;
      }
    }
    const bar = makeBar();
    bar.__editor = editor;
    parent.insertBefore(bar, editor);
    return bar;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  // 只在值真正变化时写样式，避免无谓的样式重算
  function setStyle(el, prop, value) {
    if (el.style[prop] !== value) el.style[prop] = value;
  }

  // 只在文案/显隐真正变化时写 DOM，避免状态栏自身改动触发观察器循环
  function updateBar(editor, bar) {
    if (!bar) return;
    const pe = pandoraEffect(pandoraBox);
    const model = barModel(editorText(editor).length, pair, equipped, pe);
    const countEl = bar.__countEl;
    const statusEl = bar.__statusEl;
    const hintEl = bar.__hintEl;
    const btnEl = bar.__actionBtn;
    setText(countEl, model.count);
    setStyle(countEl, 'color', model.warn ? 'var(--badge-danger)' : '');
    setStyle(countEl, 'fontWeight', model.warn ? '600' : '');
    setText(statusEl, model.status);
    statusEl.title = [model.status, model.hint].filter(Boolean).join(' · ');
    const canAct = !!(model.target || model.unequip);
    // 单行省略后长文案可能被截断，把完整内容放进 title，鼠标悬停仍能看到
    const hintText = model.hint + (canAct ? ' · Alt+B 切换' : '');
    setText(hintEl, hintText);
    hintEl.title = hintText;
    setStyle(hintEl, 'color', model.warn
      ? 'var(--badge-danger)'
      : model.hint.startsWith('✓') ? 'var(--badge-success)' : model.hint ? 'var(--badge-warning)' : '');
    setStyle(hintEl, 'fontWeight', model.warn ? '600' : '');

    // 「走个面」入口：与字数、费用模型无关，只看是否持有/佩戴
    const activityBtn = bar.__activityBtn;
    if (activityBadge) {
      const worn = equipped.has(activityBadge.badge_id);
      const gain = activityGain(activityBadge);
      const locked = !!(pe.active && pe.lockBadge);
      const lockLabel = `潘多拉锁定中${pe.expireAt ? ` · 至 ${fmtTime(pe.expireAt)}` : ''}`;
      const fullLabel = activityPending || (locked ? lockLabel : activityLabel(activityBadge, worn));
      const compactLabel = activityPending || (locked ? lockLabel : activityLabel(activityBadge, worn, true));
      setText(activityBtn.children[0], fullLabel);
      setText(activityBtn.children[1], compactLabel);
      activityBtn.setAttribute('aria-busy', String(!!activityPending));
      activityBtn.setAttribute('aria-disabled', String(locked || busy));
      setStyle(activityBtn, 'display', '');
      activityBtn.setAttribute('aria-pressed', String(worn));
      setStyle(activityBtn, 'fontWeight', worn ? '600' : '');
      setStyle(activityBtn, 'opacity', locked ? '.5' : '');
      activityBtn.disabled = locked || busy;
      activityBtn.title = locked
        ? `潘多拉「${pe.name}」锁定中${pe.expireAt ? `，至 ${fmtTime(pe.expireAt)}` : '，下次开盒前无法佩戴徽章'}`
        : `${worn ? '摘下' : '佩戴'}「${activityName(activityBadge)}」${gain == null ? '' : `，活跃度 +${gain}%`}（点击${worn ? '摘下' : '佩戴'}）`;
      activityBtn.setAttribute('aria-label', `${fullLabel}，${activityBtn.title}`);
    } else {
      setStyle(activityBtn, 'display', 'none');
    }

    if (busy && !activityPending) {
      setText(btnEl, '处理中…');
      setStyle(btnEl, 'display', '');
      btnEl.disabled = true;
    } else if (canAct) {
      setText(btnEl, model.btn);
      btnEl.title = model.btn;
      setStyle(btnEl, 'display', '');
      btnEl.disabled = busy;
      bar.__action = model.target
        ? { type: 'switch', badge: model.target }
        : { type: 'unequip', badge: model.unequip };
    } else {
      setStyle(btnEl, 'display', 'none');
      bar.__action = null;
    }
  }

  function removeBars() {
    for (const el of document.querySelectorAll(`[${BAR_FLAG}]`)) el.remove();
  }

  // ---------- 渲染 ----------
  function render() {
    syncCommentState();
    if (!enabled) {
      removeBars();
      return;
    }
    const bars = document.querySelectorAll(`[${BAR_FLAG}]`);
    for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) {
      if (!inCommentContext(editor)) continue;
      updateBar(editor, barFor(editor));
    }
    // 编辑器被站点移除、或已不在评论语境时清理孤儿状态栏（比如弹窗被 React 卸载）。
    // 弹窗只是关闭、编辑器还在 DOM 里时保留状态栏：再次打开无需重新插入，
    // 弹窗内容也就不会因为状态栏「重新占位」再位移一次。
    for (const bar of bars) {
      const editor = bar.__editor;
      const detached = !editor || !editor.isConnected || editor.parentNode !== bar.parentNode;
      if (detached || !inCommentContext(editor)) bar.remove();
    }
  }

  let renderQueued = false;
  let fullRenderNeeded = false;
  const dirtyEditors = new Set();
  function requestRender(editor) {
    if (editor) dirtyEditors.add(editor);
    else fullRenderNeeded = true;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const full = fullRenderNeeded;
      fullRenderNeeded = false;
      const editors = Array.from(dirtyEditors);
      dirtyEditors.clear();
      if (full) render();
      else if (enabled) {
        for (const editor of editors) {
          if (editor.isConnected && inCommentContext(editor)) updateBar(editor, barFor(editor));
        }
      }
    });
  }

  function onInput(e) {
    if (!enabled) return;
    const editor = e.target && typeof e.target.closest === 'function'
      ? e.target.closest(EDITOR_SELECTOR) : null;
    if (editor && inCommentContext(editor)) {
      requestRender(editor);
      syncCommentState();
    }
  }

  let observedPath = window.location.pathname;
  function onMutations(records) {
    const pathChanged = observedPath !== window.location.pathname;
    observedPath = window.location.pathname;
    if (!enabled) return;
    if (pathChanged) { requestRender(); return; }
    const selector = `${EDITOR_SELECTOR}, [${BAR_FLAG}], ${DIALOG_ANY_SELECTOR}`;
    const relevant = (node) => node.nodeType === 1
      && (node.matches(selector) || node.querySelector(selector));
    for (const record of records) {
      // textContent 更新会产生 childList 记录，忽略助手自己的内部改动。
      if (record.target.closest && record.target.closest(`[${BAR_FLAG}]`)) continue;
      if (Array.from(record.addedNodes).some(relevant)
        || Array.from(record.removedNodes).some(relevant)) {
        requestRender();
        return;
      }
    }
  }

  // ---------- 快捷键 ----------
  // Alt+B：切到当前字数下更省的那一枚；已是最省则不动；
  // 戴着的徽章已经不比不戴便宜时改为摘下。
  // 潘多拉事件接管时（徽章锁定 / 费用被固定或免除）不再切徽章。
  function onHotkey(e) {
    if (!enabled) return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'b' && e.key !== 'B') return;
    e.preventDefault();
    const pe = pandoraEffect(pandoraBox);
    if (pe.active && pe.lockBadge) {
      toast(`潘多拉「${pe.name}」生效中：下次开盒前无法佩戴徽章`, true);
      return;
    }
    if (pe.active && (pe.freeComment || typeof pe.fixedCost === 'number')) {
      toast('潘多拉已固定/免除评论费用，切换徽章不影响发评扣费');
      return;
    }
    const len = activeLength();
    const cur = currentCostBadge(pair, equipped);
    const best = recommend(len, pair);

    if (cur) {
      if (best === cur) {
        toast('当前已是最省的徽章，无需切换');
        return;
      }
      if (best) {
        switchTo(best);
        return;
      }
      // 没有更省的候选：只有「戴着反而更贵」才值得摘，同价摘了也没收益
      if (badgeCost(len, cur) > baseCost(len)) {
        unequip(cur);
        return;
      }
      toast('当前已是最省的徽章，无需切换');
      return;
    }
    if (!best) {
      toast('没有可切换的费用徽章（需持有「固定扣费」或「减免」类徽章）', true);
      return;
    }
    switchTo(best);
  }

  // 取焦点所在编辑器（回复框）的字数；
  // 没有焦点时优先取弹窗里的那个（列表页弹窗看帖时页面上的编辑器可能不止一个），最后兜底第一个
  function activeLength() {
    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    const active = document.activeElement;
    for (const editor of editors) {
      if (editor.contains(active)) return editorText(editor).length;
    }
    for (const editor of editors) {
      if (openDialogOf(editor)) return editorText(editor).length;
    }
    return editors.length ? editorText(editors[0]).length : 0;
  }

  // ---------- 轻提示 ----------
  function toast(msg, isErr) {
    if (!document.body) return;
    const el = document.createElement('div');
    el.textContent = msg;
    el.setAttribute('role', isErr ? 'alert' : 'status');
    el.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:99999',
      'padding:12px 16px',
      'box-shadow:0 8px 28px #0002',
      'line-height:1.6',
      'font-family:system-ui,sans-serif',
      'border-radius:8px',
      'font-size:13px',
      isErr ? 'color:var(--color-error-content,#fff)' : 'color:var(--color-primary-content,#fff)',
      'max-width:80vw',
      isErr ? 'background:var(--color-error,#dc2626)' : 'background:var(--color-primary,#176773)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // ---------- 油猴菜单 ----------
  function registerMenus() {
    // 只支持 GM.* 的管理器（如 Greasemonkey 4）没有这个函数，不能让启动崩掉
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') {
      for (const id of menuIds) {
        try { GM_unregisterMenuCommand(id); } catch (e) { /* 忽略 */ }
      }
    }
    menuIds = [];
    menuIds.push(GM_registerMenuCommand(
      enabled ? '徽章助手：开启中（点击关闭）' : '徽章助手：已关闭（点击开启）',
      () => {
        enabled = !enabled;
        saveEnabled();
        registerMenus();
        requestRender();
        syncCommentState();
      }
    ));
    menuIds.push(GM_registerMenuCommand('重新拉取徽章与潘多拉数据', () => {
      initData(true).then(() => toast('徽章与潘多拉数据刷新完成（失败时保留旧状态）'));
    }));
  }

  // ---------- 启动 ----------
  registerMenus();
  render();
  if (enabled) initData();

  // 输入走捕获阶段的 input 事件（React 受控组件也会触发），DOM 增删走全局观察器
  document.addEventListener('input', onInput, true);
  window.addEventListener('keydown', onHotkey);

  // 原生 <dialog> 的打开/关闭不一定伴随 DOM 增删（重新打开时内容还在），
  // 弹窗里看帖时靠 toggle 事件补一次渲染
  document.addEventListener('toggle', (e) => {
    if (enabled && e.target.matches && e.target.matches(DIALOG_ANY_SELECTOR)) requestRender();
  }, true);

  new MutationObserver(onMutations).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // 回到前台也遵守同一冷却时间，不因频繁切换标签页增加请求。
  document.addEventListener('visibilitychange', syncCommentState);
  document.addEventListener('focusin', onInput, true);
})();
