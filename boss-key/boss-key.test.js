#!/usr/bin/env node
// Boss Key 逻辑测试：直接读取同目录的 boss-key.user.js，注入测试导出后跑断言。
// 运行：node boss-key.test.js（无外部依赖）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'boss-key.user.js'), 'utf8');

// ---- 模拟油猴环境（注入脚本前就绪） ----
const store = { value: null };
globalThis.GM_getValue = (k, d) => (store.value == null ? d : store.value);
globalThis.GM_setValue = (k, v) => { store.value = v; };
globalThis.GM_registerMenuCommand = () => {};
globalThis.GM_addValueChangeListener = (k, cb) => () => {};
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
globalThis.location = {
  hostname: 'x.com', port: '', pathname: '/',
  origin: 'http://x.com', href: 'http://x.com/', protocol: 'http:',
};
function setStored(v) { store.value = v; }

// ---- 把内部函数导出注入 IIFE 末尾 ----
const EXPORT =
  ';globalThis.__t={parsePattern,ruleMatches,normalizeUrl,eventMatchesHotkey,parseCombo,' +
  'findMatch,resolveTarget,normalizeCfg,assignProjectKeys,findDirectProject,jumpableProjects,' +
  'sortMru,loadConfig,entryMatchesPattern,patternFromUrl};';
const closer = '})();';
const last = src.lastIndexOf(closer);
if (last === -1) { console.error('未找到 IIFE 结束标记'); process.exit(1); }
const injected =
  src.slice(0, last) + EXPORT + '\n' + closer + src.slice(last + closer.length);

vm.runInThisContext(injected, { filename: 'boss-key.user.js' });
const T = globalThis.__t;
if (!T) { console.error('测试导出失败'); process.exit(1); }

// ---- 断言 ----
let fail = 0;
function ok(cond, name) {
  if (!cond) { fail++; console.log('FAIL: ' + name); } else console.log('pass: ' + name);
}
function loc(host, port, p, origin) {
  return { hostname: host, port: port || '', pathname: p || '/', origin: origin || 'http://' + host };
}
function P(id, key, url) {
  return { id: id, key: key || '', name: id, url: url || 'https://' + id + '.com', rules: [] };
}

// ---- 域名匹配 ----
ok(T.ruleMatches({ pattern: 'company.com' }, loc('company.com')), '同域名命中');
ok(T.ruleMatches({ pattern: 'company.com' }, loc('jira.company.com')), '子域名命中');
ok(!T.ruleMatches({ pattern: 'company.com' }, loc('notcompany.com')), '后缀陷阱不命中');
ok(T.ruleMatches({ pattern: '192.168.1.10:8080' }, loc('192.168.1.10', '8080')), 'IP:端口精确命中');
ok(!T.ruleMatches({ pattern: '192.168.1.10:8080' }, loc('192.168.1.10', '80')), '端口不符不命中');
ok(T.ruleMatches({ pattern: '192.168.1.10' }, loc('192.168.1.10', '8080')), 'IP 不带端口=任意端口命中');
ok(T.ruleMatches({ pattern: 'example.com/admin' }, loc('example.com', '', '/admin/list')), '路径前缀命中');
ok(!T.ruleMatches({ pattern: 'example.com/admin' }, loc('example.com', '', '/administrator')), '路径段边界不误命中');
ok(T.ruleMatches({ pattern: 'https://jira.co.com/box' }, loc('jira.co.com', '', '/box/s1')), '误带协议头仍解析');
ok(!T.ruleMatches({ pattern: '' }, loc('example.com')), '空 pattern 不命中');

// ---- URL 规范化 ----
ok(T.normalizeUrl('oa.company.com/home') === 'https://oa.company.com/home', '无协议补 https');
ok(T.normalizeUrl('http://a.com') === 'http://a.com', '已有协议保留');
ok(T.normalizeUrl('zcode://open') === 'zcode://open', '自定义协议原样保留');
ok(T.normalizeUrl('wxwork://') === 'wxwork://', '空路径协议原样保留');

// ---- 快捷键 ----
ok(T.eventMatchesHotkey({ key: 'w', code: 'KeyW', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }, 'Alt+W'), 'Alt+W 命中');
ok(!T.eventMatchesHotkey({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }, 'Alt+W'), '多按 Ctrl 不命中');
ok(!T.eventMatchesHotkey({ key: 'w', code: 'KeyW', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, 'Alt+W'), '缺 Alt 不命中');
ok(T.parseCombo('Ctrl+Alt+ArrowUp').key === 'arrowup', '组合解析方向键');

// ---- v1 → v2 迁移 + 新字段 ----
const m = T.normalizeCfg({ hotkey: 'Alt+Q', defaultUrl: 'https://oa.x.com/home', rules: [{ pattern: 'a.com', url: '' }] });
ok(m.projects.length === 1 && m.projects[0].url === 'https://oa.x.com/home', 'v1 迁移为单项目');
ok(m.defaultProjectId === m.projects[0].id && m.enterTarget === 'default' && Array.isArray(m.recency), '迁移字段齐全');
const v12 = T.normalizeCfg({ projects: [], recency: ['pa', 42, 'pb', null], enterTarget: 'recent' });
ok(JSON.stringify(v12.recency) === '["pa","pb"]', 'recency 过滤非字符串');
ok(v12.enterTarget === 'recent', 'enterTarget=recent 保留');
ok(T.normalizeCfg({ projects: [], enterTarget: 'whatever' }).enterTarget === 'default', '非法 enterTarget 回退 default');
ok(T.normalizeCfg({}).hotkey === 'Alt+W', '非法快捷键回退默认');
ok(T.normalizeCfg({ projects: [], directKeys: 1 }).directKeys === true, '直达键真值归一');
const kc = T.normalizeCfg({ projects: [{ name: 'A', key: 'X' }, { name: 'B', key: 'bad-key' }] });
ok(kc.projects[0].key === 'x' && kc.projects[1].key === '', '按键小写化与非法清空');
ok(T.normalizeCfg({ projects: [], defaultProjectId: 'ghost' }).defaultProjectId === '', '悬空默认项目清空');

// ---- reuseTab / tabs 归一化 ----
const c1 = T.normalizeCfg({ projects: [], reuseTab: 1, tabs: [{ k: 'a', u: 'https://a.com/', t: '123' }, { k: 2, u: 'x' }, 'junk', { k: 'b', u: 'https://b.com/' }] });
ok(c1.reuseTab === true && c1.tabs.length === 2 && c1.tabs[0].t === 123, 'reuseTab/tabs 归一化');
ok(T.normalizeCfg({}).reuseTab === false && T.normalizeCfg({}).tabs.length === 0, 'reuseTab/tabs 默认值');

// ---- 多项目匹配 ----
const cfg = T.normalizeCfg({ projects: [
  { id: 'pa', name: 'A', key: '1', url: 'https://a.com/go', rules: [{ pattern: 'a.com/x', url: 'https://a.com/x-page' }, { pattern: 'a.com', url: '' }] },
  { id: 'pb', name: 'B', key: '2', url: 'https://b.com', rules: [{ pattern: 'b.com', url: '' }] },
], defaultProjectId: 'pb' });
ok(T.findMatch(cfg, loc('a.com', '', '/x/deep')).rule.url === 'https://a.com/x-page', '具体路径规则优先命中');
ok(T.findMatch(cfg, loc('a.com')).project.id === 'pa', '命中项目 A');
ok(T.findMatch(cfg, loc('b.com')).project.id === 'pb', '命中项目 B');
ok(T.findMatch(cfg, loc('c.com')) === null, '无命中返回 null');

// ---- resolveTarget 兜底链 ----
const pr = { id: 'p', url: 'https://p.com/base', rules: [{}] };
ok(T.resolveTarget(pr, { url: 'https://r.com' }, loc('x.com')) === 'https://r.com', '规则链接优先');
ok(T.resolveTarget(pr, { url: '' }, loc('x.com')) === 'https://p.com/base', '项目默认页次之');
ok(T.resolveTarget({ id: 'p', url: '' }, { url: '' }, loc('x.com')) === 'http://x.com', '最后回退站点首页');
ok(T.resolveTarget(pr, { url: '/rel' }, loc('x.com')) === 'http://x.com/rel', '相对路径拼接当前站点');

// ---- 可跳项目过滤 / MRU ----
ok(T.jumpableProjects(cfg).length === 2, '有 url 的项目可跳');
ok(T.jumpableProjects(T.normalizeCfg({ projects: [{ id: 'q', name: 'Q', url: '' }] })).length === 0, '无 url 项目不可跳');
const projs = [P('p1'), P('p2'), P('p3'), P('p4')];
ok(JSON.stringify(T.sortMru(projs, ['p3', 'p1']).map((p) => p.id)) === '["p3","p1","p2","p4"]', 'MRU 在前，其余按配置顺序');
ok(JSON.stringify(T.sortMru(projs, []).map((p) => p.id)) === '["p1","p2","p3","p4"]', '无 recency 保持配置顺序');
ok(JSON.stringify(T.sortMru(projs, ['ghost']).map((p) => p.id)) === '["p1","p2","p3","p4"]', '失效 recency 不影响排序');

// ---- 按键分配 ----
const ps = T.normalizeCfg({ projects: [{ id: '1', key: '', url: 'u' }, { id: '2', key: '3', url: 'u' }, { id: '3', key: '', url: 'u' }] }).projects;
ok(T.assignProjectKeys(ps) === null && ps[0].key === '1' && ps[2].key === '2', '空按键按序补齐且跳过已占用');
ok(T.assignProjectKeys([{ id: 'd1', key: '5' }, { id: 'd2', key: '5' }]) === 'dup:5', '重复按键报错');

// ---- 直达键 ----
const dcfg = T.normalizeCfg({ directKeys: true, projects: [P('x', '3'), P('y', 'w')] });
ok(T.findDirectProject(dcfg, { key: '3', code: 'Digit3', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }).id === 'x', 'Alt+3 直达');
ok(T.findDirectProject(dcfg, { key: '3', code: 'Digit3', altKey: true, ctrlKey: false, shiftKey: true, metaKey: false }) === null, '多按 Shift 不触发直达');
ok(T.findDirectProject(dcfg, { key: '9', code: 'Digit9', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }) === null, '未占用按键不触发');

// ---- 已开标签匹配（近似版复用） ----
ok(T.entryMatchesPattern('https://a.com/x/y', 'a.com/x'), '规则前缀命中（tier1）');
ok(T.entryMatchesPattern('https://jira.a.com/x', 'a.com/x'), '子域名+前缀命中（tier1）');
ok(T.entryMatchesPattern('https://a.com/other', 'a.com/x'), '同域不同路径也算（tier2）');
ok(!T.entryMatchesPattern('https://b.com/x', 'a.com/x'), '异域不命中');
ok(T.entryMatchesPattern('https://a.com/anything', 'a.com'), '无路径 pattern 同域即命中');
ok(!T.entryMatchesPattern('zcode://open', 'a.com'), '非 http(s) 登记不参与');
ok(!T.entryMatchesPattern('not a url', 'a.com'), '非法 URL 不命中');
ok(T.entryMatchesPattern('https://a.com:8443/x', 'a.com:8443/x'), '带端口精确匹配');
ok(T.patternFromUrl('https://a.com/board/x') === 'a.com/board/x', 'URL 转 pattern 含路径');
ok(T.patternFromUrl('https://a.com/') === 'a.com', 'URL 根路径只留 host');
ok(T.patternFromUrl('wxwork://') === '', '空协议地址得空 pattern');

// ---- 预置项目合并 ----
setStored(null);
const fresh = T.loadConfig();
ok(fresh.projects.map((p) => p.id).join(',') === 'preset-zcode,preset-wecom', '全新安装含 ZCode/企业微信 预置');
ok(fresh.projects[0].url === 'zcode://open' && fresh.projects[1].url === 'wxwork://', '预置协议地址正确');
setStored(JSON.stringify({ hotkey: 'Alt+Q', defaultUrl: 'https://oa.x.com/home', rules: [{ pattern: 'a.com', url: '' }] }));
const up = T.loadConfig();
ok(up.projects.length === 3 && up.projects[0].key === '' && up.projects[1].id === 'preset-zcode', 'v1 升级并入预置且迁移项目按键留空');
ok(up.presetsMerged === true, '合并标记已持久化');
ok(T.loadConfig().projects.length === 3, '第二次加载不重复合并');
setStored(JSON.stringify({ projects: [{ id: 'u1', key: '1', url: 'u', name: 'U', rules: [] }, { id: 'u2', key: '2', url: 'u', name: 'V', rules: [] }], defaultProjectId: 'u1' }));
const up3 = T.loadConfig();
ok(up3.projects.length === 4, 'v1.1 配置并入 2 个预置');
ok(up3.projects.find((p) => p.id === 'preset-zcode').key === '' && up3.projects.find((p) => p.id === 'preset-wecom').key === '', '按键被占用时预置让位留空');
ok(T.assignProjectKeys(up3.projects) === null && up3.projects.find((p) => p.id === 'preset-zcode').key === '3', '让位后自动分配无冲突');
setStored(JSON.stringify({ projects: [{ id: 'u1', key: '1', url: 'u', name: 'U', rules: [] }], defaultProjectId: 'u1', presetsMerged: true }));
ok(T.loadConfig().projects.map((p) => p.id).join(',') === 'u1', '删除的预置不复活');
setStored(JSON.stringify({ reuseTab: true, tabs: [{ k: 'a', u: 'https://a.com/', t: 1 }], projects: [{ id: 'u1', name: 'U', key: '1', url: 'https://u1.com', rules: [] }], defaultProjectId: 'u1', presetsMerged: true }));
const kept = T.loadConfig();
ok(kept.reuseTab === true && kept.tabs.length === 1 && kept.projects.length === 1, '既有 reuseTab/tabs 字段保留');

console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
