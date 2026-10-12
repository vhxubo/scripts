// ==UserScript==
// @name         老板键 · 工作页快速跳转
// @namespace    https://vhxubo.local/bosskey
// @version      1.4.0
// @description  一键回到工作页：命中项目规则直接跳转；未命中弹出项目二级选择（按键/回车/点击，按最近使用排序，可输入过滤）；可选 Alt+项目键 直达；可开启「优先跳到已打开的同域工作页」（探针确认活标签页后跳其停留地址）；油猴菜单可一键把当前站点加为规则；支持配置导入导出；预置 ZCode（zcode://）与企业微信（wxwork://）一键唤起。
// @author       vhxubo
// @match        *://*/*
// @match        file:///*
// @run-at       document-start
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'bossKeyConfig';
  // 出厂项目：zcode:// 与 wxwork:// 为本机已注册的协议处理器，选中即唤起对应应用
  const PRESET_PROJECTS = [
    { id: 'preset-zcode', name: 'ZCode', key: '1', url: 'zcode://open', rules: [] },
    { id: 'preset-wecom', name: '企业微信', key: '2', url: 'wxwork://', rules: [] },
  ];
  const DEFAULT_CFG = {
    hotkey: 'Alt+W',
    directKeys: false,
    enterTarget: 'default',
    reuseTab: false,
    projects: JSON.parse(JSON.stringify(PRESET_PROJECTS)),
    defaultProjectId: '',
    recency: [],
    tabs: [],
    presetsMerged: true,
  };
  const REG_MAX = 30;    // 已开工作页登记上限
  const PROBE_MS = 350;  // 标签页探针等待时长
  // 二级按键分配顺序：数字在前，字母随后
  const CHOOSER_KEY_SEQ = '1234567890qwertyuiopasdfghjklzxcvbnm';
  const CHOOSER_TIMEOUT = 10000;
  const FONT = 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif';

  // ---------- 配置读写（含 v1 迁移） ----------
  function newId() {
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function normalizeCfg(c) {
    c = c && typeof c === 'object' ? c : {};
    // v1 结构：{ hotkey, defaultUrl, rules } → 迁移为单项目
    if (!Array.isArray(c.projects)) {
      const rules = Array.isArray(c.rules)
        ? c.rules.map((r) => ({ pattern: String((r && r.pattern) || ''), url: String((r && r.url) || '') }))
        : [];
      const p = { id: newId(), name: '默认项目', key: '', url: String(c.defaultUrl || ''), rules: rules };
      c = { hotkey: c.hotkey, directKeys: false, projects: [p], defaultProjectId: p.id };
    }
    const projects = c.projects.map((p) => ({
      id: p && typeof p.id === 'string' && p.id ? p.id : newId(),
      name: String((p && p.name) || ''),
      key: /^[0-9a-z]$/i.test(String((p && p.key) || '')) ? String(p.key).toLowerCase() : '',
      url: String((p && p.url) || ''),
      rules: Array.isArray(p && p.rules)
        ? p.rules.map((r) => ({ pattern: String((r && r.pattern) || ''), url: String((r && r.url) || '') }))
        : [],
    }));
    let defId = typeof c.defaultProjectId === 'string' ? c.defaultProjectId : '';
    if (defId && !projects.some((p) => p.id === defId)) defId = '';
    const recency = Array.isArray(c.recency) ? c.recency.filter((x) => typeof x === 'string') : [];
    const tabs = Array.isArray(c.tabs)
      ? c.tabs
          .filter((e) => e && typeof e.k === 'string' && typeof e.u === 'string')
          .map((e) => ({ k: e.k, u: e.u, t: Number(e.t) || 0 }))
          .slice(0, REG_MAX)
      : [];
    return {
      hotkey: typeof c.hotkey === 'string' && c.hotkey ? c.hotkey : DEFAULT_CFG.hotkey,
      directKeys: !!c.directKeys,
      enterTarget: c.enterTarget === 'recent' ? 'recent' : 'default',
      reuseTab: !!c.reuseTab,
      projects: projects,
      defaultProjectId: defId,
      recency: recency,
      tabs: tabs,
      presetsMerged: !!c.presetsMerged,
    };
  }

  function loadConfig() {
    let raw = null;
    try {
      raw = GM_getValue(STORE_KEY, null);
    } catch (e) { /* ignore */ }
    let cfg = null;
    if (raw) {
      try {
        cfg = normalizeCfg(JSON.parse(raw));
      } catch (e) { cfg = null; }
    }
    if (!cfg) return JSON.parse(JSON.stringify(DEFAULT_CFG));
    // 老配置一次性并入出厂项目（按键撞车时出厂项目让位，留空待自动分配）；之后删除不会再回来
    if (!cfg.presetsMerged) {
      const ids = {};
      const usedKeys = {};
      cfg.projects.forEach((p) => {
        ids[p.id] = true;
        if (p.key) usedKeys[p.key] = true;
      });
      PRESET_PROJECTS.forEach((p0) => {
        if (ids[p0.id]) return;
        const p = JSON.parse(JSON.stringify(p0));
        if (p.key && usedKeys[p.key]) p.key = '';
        if (p.key) usedKeys[p.key] = true;
        cfg.projects.push(p);
      });
      cfg.presetsMerged = true;
      try {
        saveConfig(cfg);
      } catch (e) { /* 存储失败下次重试 */ }
    }
    return cfg;
  }

  function saveConfig(cfg) {
    GM_setValue(STORE_KEY, JSON.stringify(cfg));
  }

  function touchRecency(cfg, projectId) {
    try {
      cfg.recency = [projectId].concat((cfg.recency || []).filter((id) => id !== projectId)).slice(0, 20);
      saveConfig(cfg);
    } catch (e) { /* 存储异常不影响跳转 */ }
  }

  // ---------- 已开工作页登记（近似版「跳到已有标签页」） ----------
  // 油猴无法枚举/聚焦其它标签页，这里登记工作页并在跳转前用探针确认存活，
  // 命中则让当前标签页跳到对方停留的地址；旧标签页需手动关闭。
  let selfKey = null;

  function tabsOf(cfg) {
    return Array.isArray(cfg.tabs) ? cfg.tabs : [];
  }

  function patternFromUrl(u) {
    const pp = parsePattern(normalizeUrl(u));
    return pp.host + (pp.path || '');
  }

  function hostMatchesCurrent(patternStr) {
    try {
      return !!patternStr && ruleMatches({ pattern: patternStr }, location);
    } catch (e) {
      return false;
    }
  }

  // 登记的标签页地址是否与 pattern 同源：规则（含路径前缀）命中，或同域但路径不同也算
  function entryMatchesPattern(entryUrl, patternStr) {
    let u = null;
    try { u = new URL(entryUrl); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const loc = { hostname: u.hostname, port: u.port, pathname: u.pathname };
    if (ruleMatches({ pattern: patternStr }, loc)) return true;
    const p = parsePattern(patternStr);
    if (!p.path) return false; // pattern 本身不带路径，第一层已覆盖
    return ruleMatches({ pattern: p.host }, loc);
  }

  function registerSelf() {
    try {
      const cfg = loadConfig();
      const isWork =
        findMatch(cfg, location) ||
        cfg.projects.some((p) => {
          const pat = patternFromUrl(p.url);
          return pat && hostMatchesCurrent(pat);
        });
      if (!isWork) return;
      selfKey = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      cfg.tabs = [{ k: selfKey, u: location.href, t: Date.now() }].concat(tabsOf(cfg)).slice(0, REG_MAX);
      saveConfig(cfg);
    } catch (e) { /* ignore */ }
  }

  function unregisterSelf() {
    if (!selfKey) return;
    try {
      const cfg = loadConfig();
      cfg.tabs = tabsOf(cfg).filter((e) => e.k !== selfKey);
      saveConfig(cfg);
    } catch (e) { /* ignore */ }
  }

  function reregisterSelf() { // bfcache 恢复后重新登记
    if (!selfKey) {
      registerSelf();
      return;
    }
    try {
      const cfg = loadConfig();
      cfg.tabs = [{ k: selfKey, u: location.href, t: Date.now() }]
        .concat(tabsOf(cfg).filter((e) => e.k !== selfKey))
        .slice(0, REG_MAX);
      saveConfig(cfg);
    } catch (e) { /* ignore */ }
  }

  function pruneTabs(keys) {
    try {
      const cfg = loadConfig();
      const drop = {};
      keys.forEach((k) => { drop[k] = true; });
      cfg.tabs = tabsOf(cfg).filter((e) => !drop[e.k]);
      saveConfig(cfg);
    } catch (e) { /* ignore */ }
  }

  // 向登记中的候选标签页写探针，活着的会应答自己的当前地址；超时未应答视为已关闭并清理
  function probeTrackedTabs(cfg, patternStr, cb) {
    const cands = tabsOf(cfg).filter((e) => e.k !== selfKey && entryMatchesPattern(e.u, patternStr));
    if (!cands.length) {
      cb(null);
      return;
    }
    const keys = cands.map((e) => e.k);
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    let done = false;
    const un = GM_addValueChangeListener('bossKeyProbe', function (k, oldV, newV, remote) {
      if (!remote || done) return;
      let v = null;
      try { v = JSON.parse(newV); } catch (e) { return; }
      if (v && v.a === nonce) {
        done = true;
        try { un(); } catch (e) { /* ignore */ }
        cb({ u: String(v.u || ''), k: String(v.k || '') });
      }
    });
    setTimeout(function () {
      if (done) return;
      done = true;
      try { un(); } catch (e) { /* ignore */ }
      pruneTabs(keys);
      cb(null);
    }, PROBE_MS);
    GM_setValue('bossKeyProbe', JSON.stringify({ q: nonce, keys: keys }));
  }

  // 每个标签页的应答器：探测点名自己时回报当前地址
  GM_addValueChangeListener('bossKeyProbe', function (k, oldV, newV, remote) {
    if (!remote || !selfKey) return;
    let v = null;
    try { v = JSON.parse(newV); } catch (e) { return; }
    if (!v || !v.q || !Array.isArray(v.keys) || v.keys.indexOf(selfKey) === -1) return;
    GM_setValue('bossKeyProbe', JSON.stringify({ a: v.q, k: selfKey, u: location.href }));
  });

  window.addEventListener('pagehide', unregisterSelf);
  window.addEventListener('pageshow', function (e) {
    if (e && e.persisted) reregisterSelf();
  });

  // ---------- URL / 域名匹配 ----------
  function normalizeUrl(u) {
    const s = (u || '').trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
    return 'https://' + s;
  }

  // 把规则拆成 { host, path }：兼容误带协议头、结尾斜杠、"*." 通配前缀
  function parsePattern(raw) {
    let s = (raw || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    const slash = s.indexOf('/');
    let host = slash === -1 ? s : s.slice(0, slash);
    let path = slash === -1 ? '' : s.slice(slash);
    host = host.replace(/\.$/, '').replace(/^\*\./, '');
    path = path.replace(/\/+$/, '');
    return { host: host, path: path };
  }

  function ruleMatches(rule, loc) {
    const parsed = parsePattern(rule.pattern);
    if (!parsed.host) return false;
    const hostname = (loc.hostname || '').toLowerCase().replace(/\.$/, '');
    const hostWithPort = hostname + (loc.port ? ':' + loc.port : '');
    // 带端口：精确匹配 host:port；不带端口：任意端口都算命中，且子域名自动命中
    if (parsed.host.indexOf(':') !== -1) {
      if (hostWithPort !== parsed.host) return false;
    } else if (hostname !== parsed.host && !hostname.endsWith('.' + parsed.host)) {
      return false;
    }
    if (parsed.path) {
      const pn = loc.pathname || '/';
      const pp = parsed.path.endsWith('/') ? parsed.path : parsed.path + '/';
      if (!(pn === '/' + parsed.path.replace(/^\/+/, '') || pn.startsWith(pp))) return false;
    }
    return true;
  }

  // 自上而下找第一个命中的项目规则
  function findMatch(cfg, loc) {
    for (const p of cfg.projects) {
      for (const r of p.rules) {
        if (r.pattern && ruleMatches(r, loc)) return { project: p, rule: r };
      }
    }
    return null;
  }

  // 跳转目标兜底链：规则链接 → 项目默认工作页 → 当前站点首页
  function resolveTarget(project, rule, loc) {
    let u = (rule.url || '').trim();
    if (!u) u = (project.url || '').trim();
    if (!u) return loc.origin;
    if (u.startsWith('/')) return loc.origin + u; // 相对路径 = 当前站点下跳转
    return normalizeUrl(u);
  }

  function jumpableProjects(cfg) {
    return cfg.projects.filter((p) => (p.url || '').trim());
  }

  // 最近使用的排前面，其余保持配置顺序
  function sortMru(projects, recency) {
    recency = recency || [];
    const idx = (id) => {
      const i = recency.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return projects
      .map((p, i) => ({ p: p, i: i }))
      .sort((a, b) => idx(a.p.id) - idx(b.p.id) || a.i - b.i)
      .map((x) => x.p);
  }

  function sameTarget(a, b) {
    try {
      const ua = new URL(a, location.href);
      const ub = new URL(b, location.href);
      ua.hash = '';
      ub.hash = '';
      return ua.href.replace(/\/$/, '') === ub.href.replace(/\/$/, '');
    } catch (e) {
      return a === b;
    }
  }

  // ---------- 核心动作 ----------
  function navigate(target) {
    if (!target) return;
    if (sameTarget(target, location.href)) {
      toast('已经在工作页啦');
      return;
    }
    location.href = target;
  }

  // 统一跳转入口：开关开启时先探测已登记的同域工作页，命中则跳其停留地址
  function goTo(cfg, project, targetUrl, patternStr) {
    const url = (targetUrl || '').trim();
    if (!url) {
      toast('「' + (project.name || '项目') + '」未配置工作页');
      return;
    }
    // 非网页协议（zcode:// 等）没有"标签页"概念，直接唤起
    if (!/^https?:/i.test(url)) {
      touchRecency(cfg, project.id);
      navigate(url);
      return;
    }
    // 当前已在该域内：属于域内跳转，按配置就地跳
    if (hostMatchesCurrent(patternStr)) {
      touchRecency(cfg, project.id);
      navigate(url);
      return;
    }
    if (!cfg.reuseTab) {
      touchRecency(cfg, project.id);
      navigate(url);
      return;
    }
    probeTrackedTabs(cfg, patternStr, function (hit) {
      if (!hit) {
        touchRecency(cfg, project.id);
        navigate(url);
        return;
      }
      if (sameTarget(hit.u, location.href)) {
        toast('已有标签页停在同一页面，可切换过去');
        return;
      }
      touchRecency(cfg, project.id);
      toast('「' + (project.name || '项目') + '」已打开过该站，已跳到其停留页；旧标签页可手动关闭');
      navigate(hit.u);
    });
  }

  function jumpToProject(cfg, p) {
    const u = (p.url || '').trim();
    if (!u) {
      toast('「' + (p.name || '按键 ' + (p.key || '?').toUpperCase()) + '」未配置工作页');
      return;
    }
    goTo(cfg, p, normalizeUrl(u), patternFromUrl(u));
  }

  function trigger() {
    const cfg = loadConfig();
    const hit = findMatch(cfg, location);
    if (hit) {
      goTo(cfg, hit.project, resolveTarget(hit.project, hit.rule, location), hit.rule.pattern);
      return;
    }
    const jumpable = jumpableProjects(cfg);
    if (jumpable.length === 1) {
      goTo(cfg, jumpable[0], normalizeUrl(jumpable[0].url), patternFromUrl(jumpable[0].url)); // 只有一个项目时不弹层直接跳
      return;
    }
    if (!jumpable.length) {
      toast('还没有可跳转的项目，请先设置');
      openSettings();
      return;
    }
    openChooser(cfg);
  }

  // ---------- Shadow DOM 宿主（CSP 安全：adoptedStyleSheets 优先） ----------
  function mountOverlay(id, css) {
    const host = document.createElement('div');
    host.id = id;
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    let adopted = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      adopted = true;
    } catch (e) { /* 老浏览器回退内联 style */ }
    if (!adopted) {
      const st = document.createElement('style');
      st.textContent = css;
      root.appendChild(st);
    }
    const wrap = document.createElement('div');
    wrap.className = 'bk-wrap';
    root.appendChild(wrap);
    return { host: host, root: root, wrap: wrap };
  }

  // ---------- 二级选择浮层 ----------
  const CHOOSER_CSS = `
    :host{position:fixed;inset:0;z-index:2147483647;}
    .bk-wrap{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;
      padding-top:18vh;background:rgba(15,18,25,.25);box-sizing:border-box;
      font:14px/1.5 ${FONT};color:#e8eaf0;}
    .bk-chooser{width:480px;max-width:92vw;background:#1f2430;border-radius:12px;
      box-shadow:0 16px 48px rgba(0,0,0,.4);padding:14px 14px 18px;position:relative;overflow:hidden;box-sizing:border-box;}
    .bk-ctitle{font-size:13px;color:#9aa3b5;margin:0 4px 10px;}
    .bk-cfilter{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid rgba(255,255,255,.18);
      border-radius:8px;font-size:13px;outline:none;background:rgba(255,255,255,.06);color:#e8eaf0;margin-bottom:8px;}
    .bk-cfilter::placeholder{color:#6f7889;}
    .bk-cfilter:focus{border-color:#4f7cff;}
    .bk-crow{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;}
    .bk-crow:hover{background:rgba(255,255,255,.08);}
    .bk-ckey{flex:none;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;
      background:rgba(255,255,255,.12);font-size:12px;font-weight:600;}
    .bk-cname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .bk-cdef{flex:none;font-size:11px;color:#7ea2ff;border:1px solid rgba(126,162,255,.5);border-radius:5px;
      padding:0 5px;line-height:16px;}
    .bk-chost{flex:none;font-size:12px;color:#8b93a5;max-width:45%;white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;}
    .bk-cempty{font-size:12px;color:#6f7889;padding:8px 10px;display:none;}
    .bk-chint{font-size:11px;color:#6f7889;margin:10px 4px 0;}
    .bk-cbar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:#4f7cff;opacity:.8;
      transition:width ${CHOOSER_TIMEOUT}ms linear;}
  `;

  function openChooser(cfg) {
    if (document.getElementById('bk-chooser-overlay')) return;
    const jumpable = jumpableProjects(cfg);
    if (!jumpable.length) {
      toast('还没有可跳转的项目，请先设置');
      openSettings();
      return;
    }
    const rows = sortMru(jumpable, cfg.recency);
    const byKey = {};
    rows.forEach((p) => { if (p.key) byKey[p.key] = p; });

    const m = mountOverlay('bk-chooser-overlay', CHOOSER_CSS);
    m.wrap.innerHTML = `
      <div class="bk-chooser">
        <div class="bk-ctitle">选择要打开的工作台</div>
        <input class="bk-cfilter" spellcheck="false"
          placeholder="点击此处输入过滤；不聚焦时可直接按项目键">
        <div class="bk-clist"></div>
        <div class="bk-cempty">没有匹配的项目</div>
        <div class="bk-chint">回车 = ${cfg.enterTarget === 'recent' ? '最近使用' : '默认项目'} · Esc 取消 · ${Math.round(CHOOSER_TIMEOUT / 1000)} 秒自动关闭</div>
        <div class="bk-cbar"></div>
      </div>`;

    const list = m.wrap.querySelector('.bk-clist');
    const filter = m.wrap.querySelector('.bk-cfilter');
    const empty = m.wrap.querySelector('.bk-cempty');
    const rowEls = [];
    rows.forEach(function (p) {
      let host = p.url;
      try { host = new URL(normalizeUrl(p.url)).hostname; } catch (e) { /* keep raw */ }
      const row = document.createElement('div');
      row.className = 'bk-crow';
      const key = document.createElement('span');
      key.className = 'bk-ckey';
      key.textContent = p.key ? p.key.toUpperCase() : '·';
      const name = document.createElement('span');
      name.className = 'bk-cname';
      name.textContent = p.name || '未命名项目';
      row.appendChild(key);
      row.appendChild(name);
      if (p.id === cfg.defaultProjectId) {
        const d = document.createElement('span');
        d.className = 'bk-cdef';
        d.textContent = '默认';
        row.appendChild(d);
      }
      const hostSpan = document.createElement('span');
      hostSpan.className = 'bk-chost';
      hostSpan.textContent = host;
      row.appendChild(hostSpan);
      row.addEventListener('click', function () { choose(p); });
      list.appendChild(row);
      rowEls.push({ p: p, el: row });
    });

    let timer = setTimeout(close, CHOOSER_TIMEOUT);

    function close() {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      m.host.remove();
    }

    function choose(p) {
      if (!p) return;
      close();
      jumpToProject(cfg, p);
    }

    function visibleRows() {
      return rowEls.filter((x) => x.el.style.display !== 'none');
    }

    function enterPick() {
      if (filter.value.trim()) {
        const vis = visibleRows();
        return vis.length ? vis[0].p : null;
      }
      if (cfg.enterTarget === 'recent') return rows[0] || null;
      return rows.find((x) => x.id === cfg.defaultProjectId) || rows[0] || null;
    }

    function inFilter(e) {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      return path.indexOf(filter) !== -1;
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (filter.value) {
          filter.value = '';
          filter.dispatchEvent(new Event('input'));
        } else {
          close();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        choose(enterPick());
        return;
      }
      if (inFilter(e)) return; // 过滤框聚焦时，字符留给输入
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length !== 1) return;
      const p = byKey[e.key.toLowerCase()];
      if (p) {
        e.preventDefault();
        e.stopPropagation();
        choose(p);
      }
    }

    filter.addEventListener('input', function () {
      const q = filter.value.trim().toLowerCase();
      let n = 0;
      rowEls.forEach(function (x) {
        const hay = (x.p.name + ' ' + x.p.url).toLowerCase();
        const show = !q || hay.indexOf(q) !== -1;
        x.el.style.display = show ? '' : 'none';
        if (show) n++;
      });
      empty.style.display = n ? 'none' : 'block';
    });

    window.addEventListener('keydown', onKey, true);
    m.wrap.addEventListener('click', function (e) {
      if (e.target === m.wrap) close();
    });
    // 超时进度条：下一帧再归零，保证过渡动画生效
    const bar = m.wrap.querySelector('.bk-cbar');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bar.style.width = '0%'; });
    });
  }

  // ---------- 快捷键 ----------
  function parseCombo(s) {
    const st = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
    (s || '').split('+').forEach(function (p) {
      const lp = p.trim().toLowerCase();
      if (!lp) return;
      if (lp === 'ctrl' || lp === 'control') st.ctrl = true;
      else if (lp === 'alt') st.alt = true;
      else if (lp === 'shift') st.shift = true;
      else if (lp === 'meta' || lp === 'cmd' || lp === 'command') st.meta = true;
      else st.key = lp;
    });
    return st;
  }

  function comboFromEvent(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (parts.length === 0) return null;
    const k = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].indexOf(k) !== -1) return null;
    parts.push(k.length === 1 ? k.toUpperCase() : k);
    return parts.join('+');
  }

  function eventKeyMatchesChar(e, ch) {
    const k = (e.key || '').toLowerCase();
    if (k === ch) return true;
    // 兼容不同键盘布局：字母/数字再按物理键位比对一次
    const code = (e.code || '').toLowerCase();
    if (ch.length === 1 && code === 'key' + ch) return true;
    if (ch.length === 1 && code === 'digit' + ch) return true;
    return false;
  }

  function eventMatchesHotkey(e, hk) {
    const want = parseCombo(hk);
    if (!want.key) return false;
    if (e.ctrlKey !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift || e.metaKey !== want.meta) return false;
    return eventKeyMatchesChar(e, want.key);
  }

  // 直达键：Alt + 项目按键（不加其他修饰键）
  function findDirectProject(cfg, e) {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return null;
    for (const p of cfg.projects) {
      if (p.key && eventKeyMatchesChar(e, p.key)) return p;
    }
    return null;
  }

  function anyOverlayOpen() {
    return (
      document.getElementById('bk-panel-overlay') ||
      document.getElementById('bk-chooser-overlay') ||
      document.getElementById('bk-qa-overlay')
    );
  }

  window.addEventListener(
    'keydown',
    function (e) {
      if (anyOverlayOpen()) return; // 面板/浮层打开时不触发
      const cfg = loadConfig();
      if (eventMatchesHotkey(e, cfg.hotkey)) {
        e.preventDefault();
        e.stopPropagation();
        trigger();
        return;
      }
      if (cfg.directKeys) {
        const p = findDirectProject(cfg, e);
        if (p) {
          e.preventDefault();
          e.stopPropagation();
          jumpToProject(cfg, p);
        }
      }
    },
    true
  );

  // ---------- 提示 ----------
  function toast(msg) {
    const old = document.getElementById('bk-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'bk-toast';
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(20,24,33,.92);color:#fff;padding:10px 18px;border-radius:10px;' +
      'font:13px/1.5 ' + FONT + ';box-shadow:0 8px 24px rgba(0,0,0,.3);' +
      'transition:opacity .3s;pointer-events:none;';
    document.documentElement.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 1800);
    setTimeout(function () { t.remove(); }, 2200);
  }

  // ---------- 项目按键自动分配 ----------
  // 就地补齐空按键；返回 null 或错误串 'dup:x'
  function assignProjectKeys(projects) {
    const used = {};
    projects.forEach((p) => { if (p.key) used[p.key] = true; });
    projects.forEach((p) => {
      if (!p.key) {
        const k = CHOOSER_KEY_SEQ.split('').find((ch) => !used[ch]);
        if (k) {
          p.key = k;
          used[k] = true;
        }
      }
    });
    const seen = {};
    for (const p of projects) {
      if (!p.key) continue;
      if (seen[p.key]) return 'dup:' + p.key;
      seen[p.key] = true;
    }
    return null;
  }

  // ---------- 设置面板 ----------
  const BASE_CSS = `
    :host{position:fixed;inset:0;z-index:2147483647;}
    .bk-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      background:rgba(15,18,25,.45);box-sizing:border-box;font:14px/1.5 ${FONT};color:#1f2329;}
    .bk-panel{width:600px;max-width:94vw;max-height:88vh;overflow:auto;background:#fff;border-radius:12px;
      box-shadow:0 12px 40px rgba(0,0,0,.25);padding:20px 22px;box-sizing:border-box;}
    .bk-title{font-size:16px;font-weight:600;}
    .bk-label{display:block;font-size:12px;color:#6b7280;margin:14px 0 4px;}
    .bk-input{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #d0d5dd;border-radius:8px;
      font-size:13px;outline:none;background:#fff;color:#1f2329;}
    .bk-input:focus{border-color:#4f7cff;box-shadow:0 0 0 2px rgba(79,124,255,.15);}
    .bk-check{display:flex;align-items:center;gap:6px;font-size:13px;color:#1f2329;margin-top:8px;cursor:pointer;}
    .bk-card{border:1px solid #e4e7ec;border-radius:10px;padding:10px 10px 8px;margin-bottom:10px;background:#fafbfc;}
    .bk-crow1{display:flex;gap:6px;align-items:center;margin-bottom:6px;}
    .bk-name{flex:1;min-width:0;}
    .bk-key{flex:none;width:52px;text-align:center;}
    .bk-star{flex:none;display:flex;align-items:center;gap:3px;font-size:12px;color:#6b7280;cursor:pointer;
      user-select:none;}
    .bk-purl{margin-bottom:8px;}
    .bk-rl{font-size:11px;color:#98a2b3;margin:2px 0 4px;}
    .bk-row{display:flex;gap:6px;margin-bottom:6px;align-items:center;}
    .bk-row .bk-pat{flex:1;min-width:0;}
    .bk-row .bk-url{flex:1.4;min-width:0;}
    .bk-del{flex:none;width:26px;height:26px;line-height:24px;padding:0;text-align:center;border:1px solid #d0d5dd;
      border-radius:8px;background:#fff;color:#98a2b3;cursor:pointer;font-size:14px;}
    .bk-del:hover{color:#d92d20;border-color:#d92d20;}
    .bk-btn{padding:7px 14px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#1f2329;
      font-size:13px;cursor:pointer;}
    .bk-btn:hover{background:#f2f4f7;}
    .bk-btn-primary{background:#4f7cff;border-color:#4f7cff;color:#fff;}
    .bk-btn-primary:hover{background:#3d6bf5;}
    .bk-btn-ghost{width:100%;margin-top:2px;border-style:dashed;color:#4f7cff;}
    .bk-btn-sm{width:100%;padding:5px;border:1px dashed #c2c9d6;border-radius:8px;background:transparent;
      color:#4f7cff;font-size:12px;cursor:pointer;}
    .bk-hint{font-size:12px;color:#98a2b3;margin-top:12px;line-height:1.8;}
    .bk-hint b{color:#6b7280;font-weight:600;}
    .bk-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}
    .bk-ioBtns{display:flex;gap:8px;margin-top:12px;}
    .bk-io{width:100%;height:120px;margin-top:8px;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:8px;
      font:12px/1.5 ui-monospace,Consolas,monospace;padding:8px;color:#1f2329;background:#fff;resize:vertical;}
    .bk-qa{width:520px;}
    .bk-qa-cur{font-size:12px;color:#98a2b3;margin-top:8px;word-break:break-all;}
    .bk-prow{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid #e4e7ec;border-radius:8px;
      margin-bottom:6px;cursor:pointer;background:#fff;}
    .bk-prow:hover{background:#f2f6ff;border-color:#b9ccff;}
    .bk-prow .bk-ckey{background:#eef2ff;color:#4f7cff;}
    .bk-pname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .bk-phost{flex:none;font-size:12px;color:#98a2b3;max-width:45%;white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;}
  `;

  function openSettings() {
    if (document.getElementById('bk-panel-overlay')) return;
    const cfg = loadConfig();
    const m = mountOverlay('bk-panel-overlay', BASE_CSS);
    m.wrap.innerHTML = `
      <div class="bk-panel">
        <div class="bk-title">老板键设置</div>
        <label class="bk-label">触发快捷键（点击输入框后直接按键）</label>
        <input id="bk-hotkey" class="bk-input" readonly>
        <label class="bk-check"><input type="checkbox" id="bk-direct"> 启用直达键：Alt + 项目按键，直接打开对应项目</label>
        <label class="bk-check"><input type="checkbox" id="bk-enterrecent"> 选择浮层按回车时跳「最近使用的项目」（否则跳「默认项目」）</label>
        <label class="bk-check"><input type="checkbox" id="bk-reuse"> 优先跳到已打开的同域工作页（跳到它最后停留的地址；旧标签页需手动关闭）</label>
        <label class="bk-label">项目（二级选择列表，浮层会按最近使用动态排序）</label>
        <div id="bk-projects"></div>
        <button id="bk-addproj" class="bk-btn bk-btn-ghost" type="button">＋ 添加项目</button>
        <div class="bk-ioBtns">
          <button id="bk-export" class="bk-btn" type="button">导出配置</button>
          <button id="bk-import" class="bk-btn" type="button">导入配置</button>
        </div>
        <textarea id="bk-io" class="bk-io" style="display:none" spellcheck="false"></textarea>
        <div class="bk-hint">
          <b>两段式：</b>按快捷键后，若当前域名未命中任何规则，弹出项目选择：按项目按键或点击跳转，回车按上方选项跳默认/最近，Esc 取消；只有一个项目时不弹层直接跳。<br>
          <b>匹配：</b>域名规则命中时老板键直接跳转（company.com 含子域名；IP 带端口需精确；带路径 = 前缀匹配）。规则「跳转到」留空 = 该项目默认工作页，再留空 = 当前站点首页。
        </div>
        <div class="bk-actions">
          <button id="bk-cancel" class="bk-btn" type="button">取消</button>
          <button id="bk-save" class="bk-btn bk-btn-primary" type="button">保存</button>
        </div>
      </div>`;

    const wrap = m.wrap;
    const hotkeyInput = wrap.querySelector('#bk-hotkey');
    const directInput = wrap.querySelector('#bk-direct');
    const enterInput = wrap.querySelector('#bk-enterrecent');
    const reuseInput = wrap.querySelector('#bk-reuse');
    const projectsBox = wrap.querySelector('#bk-projects');
    const io = wrap.querySelector('#bk-io');

    function addRuleRow(box, pattern, url) {
      const row = document.createElement('div');
      row.className = 'bk-row';
      const pat = document.createElement('input');
      pat.className = 'bk-input bk-pat';
      pat.placeholder = 'jira.company.com 或 192.168.1.10:8080';
      pat.value = pattern || '';
      const urlInput = document.createElement('input');
      urlInput.className = 'bk-input bk-url';
      urlInput.placeholder = '跳转链接，留空 = 项目默认页';
      urlInput.value = url || '';
      const del = document.createElement('button');
      del.className = 'bk-del';
      del.type = 'button';
      del.textContent = '×';
      del.title = '删除这条规则';
      del.addEventListener('click', function () { row.remove(); });
      row.appendChild(pat);
      row.appendChild(urlInput);
      row.appendChild(del);
      box.appendChild(row);
    }

    function addCard(proj, isDefault) {
      const card = document.createElement('div');
      card.className = 'bk-card';
      card.dataset.id = proj.id || newId();

      const row1 = document.createElement('div');
      row1.className = 'bk-crow1';
      const name = document.createElement('input');
      name.className = 'bk-input bk-name';
      name.placeholder = '项目名，如 JIRA 控制台';
      name.value = proj.name || '';
      const key = document.createElement('input');
      key.className = 'bk-input bk-key';
      key.placeholder = '按键';
      key.maxLength = 1;
      key.title = '二级选择时按这个键跳转，留空自动分配';
      key.value = proj.key || '';
      const star = document.createElement('label');
      star.className = 'bk-star';
      star.title = '设为默认项目（选择列表中回车即跳）';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'bk-def';
      radio.checked = !!isDefault;
      star.appendChild(radio);
      star.appendChild(document.createTextNode('默认'));
      const del = document.createElement('button');
      del.className = 'bk-del';
      del.type = 'button';
      del.textContent = '×';
      del.title = '删除项目';
      del.addEventListener('click', function () { card.remove(); });
      row1.appendChild(name);
      row1.appendChild(key);
      row1.appendChild(star);
      row1.appendChild(del);

      const url = document.createElement('input');
      url.className = 'bk-input bk-purl';
      url.placeholder = '默认工作页，如 https://jira.company.com/board（规则留空时兜底）';
      url.value = proj.url || '';

      const rl = document.createElement('div');
      rl.className = 'bk-rl';
      rl.textContent = '域名匹配规则（可选：命中时老板键直接跳转）';

      const rulesBox = document.createElement('div');
      (proj.rules || []).forEach(function (r) { addRuleRow(rulesBox, r.pattern, r.url); });

      const addRule = document.createElement('button');
      addRule.className = 'bk-btn-sm';
      addRule.type = 'button';
      addRule.textContent = '＋ 添加规则';
      addRule.addEventListener('click', function () {
        addRuleRow(rulesBox, '', '');
        const pats = rulesBox.querySelectorAll('.bk-pat');
        pats[pats.length - 1].focus();
      });

      card.appendChild(row1);
      card.appendChild(url);
      card.appendChild(rl);
      card.appendChild(rulesBox);
      card.appendChild(addRule);
      projectsBox.appendChild(card);
    }

    function renderIntoPanel(d) {
      hotkeyInput.value = d.hotkey;
      directInput.checked = !!d.directKeys;
      enterInput.checked = d.enterTarget === 'recent';
      reuseInput.checked = !!d.reuseTab;
      projectsBox.innerHTML = '';
      if (d.projects.length) {
        d.projects.forEach(function (p, i) {
          addCard(p, p.id === d.defaultProjectId || (!d.defaultProjectId && i === 0));
        });
      } else {
        addCard({ id: newId(), name: '', key: '', url: '', rules: [] }, true);
      }
    }

    renderIntoPanel(cfg);

    wrap.querySelector('#bk-addproj').addEventListener('click', function () {
      const cards = projectsBox.querySelectorAll('.bk-card');
      addCard({ id: newId(), name: '', key: '', url: '', rules: [] }, cards.length === 0);
      const names = projectsBox.querySelectorAll('.bk-name');
      names[names.length - 1].focus();
    });

    // 快捷键录制
    hotkeyInput.addEventListener('keydown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        hotkeyInput.value = cfg.hotkey;
        hotkeyInput.blur();
        return;
      }
      const combo = comboFromEvent(e);
      if (combo) {
        hotkeyInput.value = combo;
        hotkeyInput.blur();
      }
    }, true);

    // 收集面板草稿；quiet=true 时不弹错、不中断（供导出用）
    function collectDraft(quiet) {
      const projects = [];
      const cards = projectsBox.querySelectorAll('.bk-card');
      for (let ci = 0; ci < cards.length; ci++) {
        const card = cards[ci];
        const name = card.querySelector('.bk-name').value.trim();
        const label = name || '第 ' + (ci + 1) + ' 个项目';
        const url = card.querySelector('.bk-purl').value.trim();
        let key = card.querySelector('.bk-key').value.trim().toLowerCase();
        if (key && !/^[0-9a-z]$/.test(key)) {
          if (!quiet) {
            toast('「' + label + '」的按键只能是数字或字母');
            return { ok: false };
          }
          key = '';
        }
        const rules = [];
        const rows = card.querySelectorAll('.bk-row');
        for (let i = 0; i < rows.length; i++) {
          const pat = rows[i].querySelector('.bk-pat').value.trim();
          const rurl = rows[i].querySelector('.bk-url').value.trim();
          if (!pat && !rurl) continue; // 整行为空，忽略
          if (!pat) {
            if (!quiet) {
              toast('「' + label + '」第 ' + (i + 1) + ' 条规则缺少域名 / IP');
              return { ok: false };
            }
            continue;
          }
          rules.push({ pattern: pat, url: rurl });
        }
        if (!name && !url && !rules.length) continue; // 整卡为空，忽略
        projects.push({ id: card.dataset.id, name: name, key: key, url: url, rules: rules });
      }

      const dupErr = assignProjectKeys(projects);
      if (dupErr) {
        if (!quiet) {
          toast('项目按键 “' + dupErr.slice(4).toUpperCase() + '” 重复，请修改');
          return { ok: false };
        }
        const seen = {};
        projects.forEach((p) => {
          if (!p.key) return;
          if (seen[p.key]) p.key = '';
          else seen[p.key] = true;
        });
      }

      if (!quiet && directInput.checked) {
        const hk = parseCombo(hotkeyInput.value.trim() || cfg.hotkey).key;
        const clash = projects.find((p) => p.key && p.key === hk);
        if (clash) {
          toast('「' + (clash.name || '某个项目') + '」按键与主快捷键相同，直达键会失效，请修改');
          return { ok: false };
        }
      }

      let defId = '';
      projectsBox.querySelectorAll('input[name="bk-def"]').forEach(function (r) {
        if (r.checked) {
          const card = r.closest('.bk-card');
          if (card && projects.some((p) => p.id === card.dataset.id)) defId = card.dataset.id;
        }
      });
      if (!defId && projects.length) defId = projects[0].id;

      return {
        ok: true,
        draft: {
          hotkey: hotkeyInput.value.trim() || cfg.hotkey,
          directKeys: directInput.checked,
          enterTarget: enterInput.checked ? 'recent' : 'default',
          reuseTab: reuseInput.checked,
          projects: projects,
          defaultProjectId: defId,
          recency: cfg.recency || [],
          presetsMerged: cfg.presetsMerged,
        },
      };
    }

    function close() { m.host.remove(); }

    wrap.querySelector('#bk-cancel').addEventListener('click', close);
    m.wrap.addEventListener('click', function (e) {
      if (e.target === m.wrap) close();
    });

    wrap.querySelector('#bk-save').addEventListener('click', function () {
      const r = collectDraft(false);
      if (!r.ok) return;
      saveConfig(r.draft);
      close();
      toast('已保存：' + r.draft.projects.length + ' 个项目，快捷键 ' + r.draft.hotkey);
    });

    wrap.querySelector('#bk-export').addEventListener('click', function () {
      const r = collectDraft(true);
      io.value = JSON.stringify(r.draft, null, 2);
      io.style.display = '';
      io.focus();
      io.select();
      const fallback = function () { toast('配置已生成在文本框，请手动复制'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(io.value).then(function () {
          toast('配置已复制到剪贴板');
        }, fallback);
      } else {
        fallback();
      }
    });

    wrap.querySelector('#bk-import').addEventListener('click', function () {
      if (io.style.display === 'none' || !io.value.trim()) {
        io.style.display = '';
        io.value = '';
        io.placeholder = '粘贴导出的 JSON，然后再点一次「导入配置」';
        io.focus();
        toast('请粘贴 JSON 后再点一次「导入配置」');
        return;
      }
      let raw = null;
      try { raw = JSON.parse(io.value); } catch (e) { raw = null; }
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) {
        toast('导入失败：不是有效的老板键配置');
        return;
      }
      renderIntoPanel(normalizeCfg(raw));
      io.style.display = 'none';
      io.value = '';
      toast('已导入到表单，请检查后点「保存」');
    });

    setTimeout(function () {
      const first = projectsBox.querySelector('.bk-name');
      if (first) first.focus();
    }, 50);
  }

  // ---------- 快捷添加规则 ----------
  function defaultPattern() {
    return (
      location.hostname +
      (location.port && ['80', '443'].indexOf(location.port) === -1 ? ':' + location.port : '')
    );
  }

  function stripTrailingSlash(p) {
    p = p || '/';
    return p.length > 1 ? p.replace(/\/+$/, '') : '';
  }

  function openQuickAdd() {
    if (document.getElementById('bk-qa-overlay')) return;
    let cfg = loadConfig();
    let pickedId = null;
    const m = mountOverlay('bk-qa-overlay', BASE_CSS);
    m.wrap.innerHTML = `
      <div class="bk-panel bk-qa">
        <div class="bk-title">把当前站点加为规则</div>
        <div class="bk-qa-cur"></div>
        <div class="bk-qa-body"></div>
        <div class="bk-actions bk-qa-actions"></div>
      </div>`;
    const wrap = m.wrap;
    wrap.querySelector('.bk-qa-cur').textContent = '当前页面：' + location.href;
    const body = wrap.querySelector('.bk-qa-body');
    const actions = wrap.querySelector('.bk-qa-actions');

    function mkBtn(text, cls, fn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', fn);
      return b;
    }

    function close() { m.host.remove(); }

    function renderPick() {
      body.innerHTML = '';
      actions.innerHTML = '';
      actions.appendChild(mkBtn('取消', 'bk-btn', close));
      const lab = document.createElement('div');
      lab.className = 'bk-rl';
      lab.textContent = cfg.projects.length
        ? '选择加入哪个项目：'
        : '还没有项目，保存时将自动创建「默认项目」：';
      body.appendChild(lab);
      if (cfg.projects.length) {
        cfg.projects.forEach(function (p) {
          let host = p.url;
          try { host = new URL(normalizeUrl(p.url)).hostname; } catch (e) { /* keep raw */ }
          const row = document.createElement('div');
          row.className = 'bk-prow';
          const key = document.createElement('span');
          key.className = 'bk-ckey';
          key.style.cssText =
            'flex:none;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;font-size:12px;font-weight:600;';
          key.textContent = p.key ? p.key.toUpperCase() : '·';
          const name = document.createElement('span');
          name.className = 'bk-pname';
          name.textContent = p.name || '未命名项目';
          const hostSpan = document.createElement('span');
          hostSpan.className = 'bk-phost';
          hostSpan.textContent = host;
          row.appendChild(key);
          row.appendChild(name);
          row.appendChild(hostSpan);
          row.addEventListener('click', function () {
            pickedId = p.id;
            renderForm();
          });
          body.appendChild(row);
        });
      } else {
        const row = document.createElement('div');
        row.className = 'bk-prow';
        row.textContent = '默认项目（自动创建）';
        row.addEventListener('click', function () {
          pickedId = null;
          renderForm();
        });
        body.appendChild(row);
      }
    }

    function renderForm() {
      body.innerHTML = '';
      actions.innerHTML = '';
      const proj = pickedId ? cfg.projects.find((p) => p.id === pickedId) : null;

      const info = document.createElement('div');
      info.className = 'bk-rl';
      info.textContent = '加入项目：' + (proj ? proj.name || '未命名项目' : '默认项目（自动创建）');

      const lab1 = document.createElement('label');
      lab1.className = 'bk-label';
      lab1.textContent = '匹配域名 / IP（可带路径前缀）';
      const pat = document.createElement('input');
      pat.className = 'bk-input';
      pat.value = defaultPattern();

      const pathChk = document.createElement('label');
      pathChk.className = 'bk-check';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      pathChk.appendChild(chk);
      pathChk.appendChild(
        document.createTextNode('仅匹配当前路径前缀（' + stripTrailingSlash(location.pathname) + '）')
      );
      chk.addEventListener('change', function () {
        pat.value = chk.checked
          ? defaultPattern() + stripTrailingSlash(location.pathname)
          : defaultPattern();
      });

      const lab2 = document.createElement('label');
      lab2.className = 'bk-label';
      lab2.textContent = '命中后跳转到（默认当前页面）';
      const url = document.createElement('input');
      url.className = 'bk-input';
      url.value = location.href;

      body.appendChild(info);
      body.appendChild(lab1);
      body.appendChild(pat);
      body.appendChild(pathChk);
      body.appendChild(lab2);
      body.appendChild(url);

      actions.appendChild(mkBtn('返回', 'bk-btn', renderPick));
      actions.appendChild(
        mkBtn('保存规则', 'bk-btn bk-btn-primary', function () {
          const pattern = pat.value.trim();
          if (!pattern) {
            toast('匹配域名不能为空');
            return;
          }
          const c = loadConfig(); // 用最新配置，避免面板同时被改时覆盖
          let projects = c.projects.slice();
          let target = pickedId ? projects.find((p) => p.id === pickedId) : null;
          if (!target) {
            target = { id: newId(), name: '默认项目', key: '1', url: '', rules: [] };
            projects.push(target);
          }
          const want = parsePattern(pattern);
          const existing = target.rules.find(function (r) {
            const rp = parsePattern(r.pattern);
            return rp.host === want.host && (rp.path || '') === (want.path || '');
          });
          if (existing) {
            existing.url = url.value.trim();
          } else {
            target.rules.push({ pattern: pattern, url: url.value.trim() });
          }
          const next = {
            hotkey: c.hotkey,
            directKeys: c.directKeys,
            enterTarget: c.enterTarget,
            reuseTab: c.reuseTab,
            projects: projects,
            defaultProjectId: c.defaultProjectId || target.id,
            recency: c.recency || [],
            presetsMerged: c.presetsMerged,
          };
          saveConfig(next);
          close();
          toast(
            existing
              ? '已更新「' + (target.name || '项目') + '」的同域名规则'
              : '已添加规则到「' + (target.name || '项目') + '」'
          );
        })
      );
      setTimeout(function () { pat.focus(); }, 30);
    }

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) close();
    });
    window.addEventListener(
      'keydown',
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
          window.removeEventListener('keydown', onKey, true);
        }
      },
      true
    );
    renderPick();
  }

  // ---------- 油猴菜单入口 ----------
  GM_registerMenuCommand('🚀 老板键：跳转工作页（' + loadConfig().hotkey + '）', trigger);
  GM_registerMenuCommand('📂 老板键：选择项目', function () { openChooser(loadConfig()); });
  GM_registerMenuCommand('➕ 老板键：把当前站点加为规则', openQuickAdd);
  GM_registerMenuCommand('⚙️ 老板键：设置', openSettings);
})();
