/**
 * Text Vault e2e 测试 — playwright-core + headless chromium 驱动真实页面交互。
 * 运行：node dev/e2e.cjs（需先启动 dev 目录的 http.server :8642）
 */
const pw = require('/home/vhxubo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const SHELL = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:8642/dev/test.html';

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await pw.chromium.launch({ executablePath: SHELL, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(400);

  // 工具：通过测试钩子定位脚本内部元素并返回视口坐标（中心点）
  const rectOf = (sel) => page.evaluate((s) => {
    const el = window.__tv.root.querySelector(s);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, hidden: el.hidden };
  }, sel);
  const clickAt = async (sel) => {
    const r = await rectOf(sel);
    if (!r) throw new Error('元素不可见或不存在: ' + sel);
    await page.mouse.click(r.x, r.y);
  };

  const dump = () => page.evaluate(() => window.TextVault.__debug.dump());
  const clip = () => page.evaluate(() => window.TextVault.__debug.clipboard());

  console.log('== 1. 初始化 ==');
  const menus = await page.evaluate(() => window.TextVault.__debug.menus());
  ok('油猴菜单注册 3 条', menus.length === 3, menus);
  ok('悬浮球可见且显示 0', await page.evaluate(() => {
    const el = window.__tv.root.querySelector('.fab');
    return !el.hidden && el.querySelector('.num').textContent === '0';
  }));

  console.log('== 2. 选中文本 → 浮出按钮 → 记录 ==');
  const p = await page.locator('#para').boundingBox();
  await page.mouse.move(p.x + 5, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + p.width * 0.6, p.y + p.height / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(350); // selectionchange debounce 180ms
  ok('浮出按钮出现', await rectOf('.snap') !== null);
  await clickAt('.snap');
  await sleep(120);
  let entries = await dump();
  ok('条目已记录(1 条)', entries.length === 1 && entries[0].text.includes('示例文本'), entries);
  ok('浮出按钮消失', await rectOf('.snap') === null);
  ok('来源域名记录为 127.0.0.1', entries[0] && entries[0].domain === '127.0.0.1', entries[0] && entries[0].domain);

  console.log('== 3. 悬浮球 → 面板 ==');
  await clickAt('.fab');
  await sleep(150);
  ok('面板打开', await page.evaluate(() => !window.__tv.root.querySelector('.panel').hidden));
  ok('徽标显示 1', await page.evaluate(() => window.__tv.root.querySelector('.num').textContent === '1'));
  const items = await page.evaluate(() => window.__tv.root.querySelectorAll('.item').length);
  ok('列表渲染 1 条', items === 1, items);

  console.log('== 4. 聚焦 input → 点击条目写入 ==');
  await page.click('#target-input');
  await page.evaluate(() => { const el = document.getElementById('target-input'); el.value = '前:'; el.setSelectionRange(2, 2); });
  await clickAt('.item');
  await sleep(120);
  const inputVal = await page.evaluate(() => document.getElementById('target-input').value);
  ok('写入 input(含原有前缀)', inputVal.startsWith('前:') && inputVal.includes('示例文本'), inputVal);
  entries = await dump();
  ok('使用次数 +1', entries[0].count === 1, entries[0]);

  console.log('== 5. 无聚焦输入框 → 点击条目复制（全新页面状态）==');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(400);
  const p2 = await page.locator('#para').boundingBox();
  await page.mouse.move(p2.x + 5, p2.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p2.x + p2.width * 0.6, p2.y + p2.height / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(350);
  await clickAt('.snap');
  await sleep(120);
  await clickAt('.fab');
  await sleep(150);
  await clickAt('.item');
  await sleep(120);
  const clip1 = await clip();
  ok('已复制到剪贴板', typeof clip1 === 'string' && clip1.includes('示例文本'), clip1);

  console.log('== 6. textarea 光标位置插入 ==');
  let storedText = (await dump())[0].text;
  await page.evaluate(() => {
    const el = document.getElementById('target-textarea');
    el.value = 'ABCDEF';
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await clickAt('.item');
  await sleep(120);
  const taVal = await page.evaluate(() => document.getElementById('target-textarea').value);
  ok('textarea 插入位置正确(AB|CD)', taVal === 'ABC' + storedText + 'DEF', taVal);

  console.log('== 7. contenteditable 写入 ==');
  await page.click('#rich');
  await page.evaluate(() => {
    const el = document.getElementById('rich');
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges(); s.addRange(range); s.collapseToEnd();
  });
  await clickAt('.item');
  await sleep(120);
  const richText = await page.evaluate(() => document.getElementById('rich').textContent);
  ok('contenteditable 追加成功', richText.includes('示例文本'), richText);

  console.log('== 8. 新增 → 搜索 → 置顶 ==');
  await clickAt('.act-add');
  await page.evaluate(() => { const ta = window.__tv.root.querySelector('.composer-area'); ta.value = '搜索关键词唯一条目XYZ'; });
  await clickAt('.act-composer-save');
  await sleep(120);
  entries = await dump();
  ok('手动新增成功(2 条)', entries.length === 2 && entries[0].text === '搜索关键词唯一条目XYZ', entries.map((e) => e.text));
  ok('新增后 composer 收起', await page.evaluate(() => window.__tv.root.querySelector('.composer').hidden));

  await page.evaluate(() => { const i = window.__tv.root.querySelector('.search'); i.value = 'XYZ'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(80);
  const filtered = await page.evaluate(() => window.__tv.root.querySelectorAll('.item').length);
  ok('搜索过滤到 1 条', filtered === 1, filtered);
  await page.evaluate(() => { const i = window.__tv.root.querySelector('.search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(80);

  // 置顶第二条(示例文本),然后按 updatedAt 排序它应排最前
  await page.evaluate(() => {
    const items = window.__tv.root.querySelectorAll('.item');
    const target = [...items].find((n) => n.querySelector('.item-text') && n.querySelector('.item-text').textContent.includes('示例文本'));
    target.querySelector('[data-act="pin"]').click();
  });
  await sleep(100);
  const firstText = await page.evaluate(() => window.__tv.root.querySelector('.item .item-text').textContent);
  ok('置顶后排在最前', firstText.includes('示例文本'), firstText);
  ok('置顶样式生效', await page.evaluate(() => window.__tv.root.querySelector('.item').classList.contains('pinned')));

  console.log('== 9. 编辑 ==');
  await page.evaluate(() => window.__tv.root.querySelector('.item [data-act="edit"]').click());
  await sleep(100);
  ok('编辑态出现 textarea', await page.evaluate(() => !!window.__tv.root.querySelector('.edit-area')));
  await page.evaluate(() => { const ta = window.__tv.root.querySelector('.edit-area'); ta.value = '编辑后的置顶文本'; });
  await clickAt('[data-act="save-edit"]');
  await sleep(100);
  entries = await dump();
  ok('编辑保存成功', entries.some((e) => e.text === '编辑后的置顶文本'), entries.map((e) => e.text));

  console.log('== 10. 删除 + 撤销 ==');
  const beforeCount = (await dump()).length;
  await page.evaluate(() => window.__tv.root.querySelectorAll('.item')[0].querySelector('[data-act="del"]').click());
  await sleep(100);
  ok('删除后少一条', (await dump()).length === beforeCount - 1);
  ok('toast 撤销按钮可见', await page.evaluate(() => !window.__tv.root.querySelector('.toast-act').hidden));
  await clickAt('.toast-act');
  await sleep(100);
  ok('撤销后恢复', (await dump()).length === beforeCount);

  console.log('== 11. 菜单：记录剪贴板 ==');
  await page.evaluate(() => {
    getSelection().removeAllRanges();
    window.TextVault.__debug.setClipboard('来自剪贴板的菜单记录');
    window.TextVault.__debug.runMenu('➕ 记录选中文本 / 剪贴板');
  });
  await sleep(300);
  entries = await dump();
  ok('菜单记录剪贴板成功', entries.some((e) => e.text === '来自剪贴板的菜单记录'), entries.map((e) => e.text));

  console.log('== 12. 去重 ==');
  await page.evaluate(() => window.TextVault.__debug.runMenu('➕ 记录选中文本 / 剪贴板'));
  await sleep(300);
  entries = await dump();
  const dupCount = entries.filter((e) => e.text === '来自剪贴板的菜单记录').length;
  ok('重复文本不新增', dupCount === 1 && entries.length === beforeCount + 1, { dupCount, total: entries.length });

  console.log('== 12b. 剪贴板权限拒绝 → 手动粘贴兜底 ==');
  await page.evaluate(() => {
    window.__denyClipboard = true;
    window.TextVault.__debug.runMenu('➕ 记录选中文本 / 剪贴板');
  });
  await sleep(200);
  ok('弹出粘贴模态', await page.evaluate(() => !window.__tv.root.querySelector('.modal-mask').hidden));
  await page.evaluate(() => { window.__tv.root.querySelector('.modal-area').value = '手动粘贴的兜底记录'; });
  await clickAt('.act-modal-save');
  await sleep(120);
  ok('手动粘贴记录成功', (await dump()).some((e) => e.text === '手动粘贴的兜底记录'));
  await page.evaluate(() => { window.__denyClipboard = false; });

  console.log('== 13. 清空(两段确认)==');
  await clickAt('.act-clear');
  await sleep(80);
  ok('第一次点击不删除', (await dump()).length > 0);
  ok('按钮进入确认态', await page.evaluate(() => window.__tv.root.querySelector('.act-clear').classList.contains('armed')));
  await clickAt('.act-clear');
  await sleep(100);
  ok('第二次点击清空(置顶也清)', (await dump()).length === 0);
  ok('徽标归零', await page.evaluate(() => window.__tv.root.querySelector('.num').textContent === '0'));

  console.log('== 14. Esc 关闭面板 & 热键 ==');
  await page.keyboard.press('Escape');
  await sleep(80);
  ok('Esc 关闭面板', await page.evaluate(() => window.__tv.root.querySelector('.panel').hidden));
  await page.keyboard.press('Alt+Shift+V');
  await sleep(80);
  ok('Alt+Shift+V 打开面板', await page.evaluate(() => !window.__tv.root.querySelector('.panel').hidden));
  await page.keyboard.press('Alt+Shift+V');
  await sleep(80);
  ok('Alt+Shift+V 再按关闭面板', await page.evaluate(() => window.__tv.root.querySelector('.panel').hidden));

  console.log('== 15. 悬浮球拖动记忆位置 ==');
  const fr = await rectOf('.fab');
  await page.mouse.move(fr.x, fr.y);
  await page.mouse.down();
  await page.mouse.move(fr.x - 300, fr.y - 300, { steps: 10 });
  await page.mouse.up();
  await sleep(120);
  ok('拖动后位置持久化', await page.evaluate(() => {
    const pos = JSON.parse(window.TextVault.__debug.raw().textVaultFabPos || 'null');
    return pos && typeof pos.right === 'number';
  }));
  // 拖动结束不应触面板开关
  ok('拖动不触发面板开关', await page.evaluate(() => window.__tv.root.querySelector('.panel').hidden));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) {
    await page.screenshot({ path: '/tmp/text-vault-e2e-fail.png', fullPage: false });
    console.log('失败截图: /tmp/text-vault-e2e-fail.png');
  }
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('测试执行异常:', e);
  process.exit(2);
});
