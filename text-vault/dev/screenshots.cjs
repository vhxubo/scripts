/** 生成视觉验收截图:面板全貌、选区浮出按钮、暗色模式 */
const pw = require('/home/vhxubo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const SHELL = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:8642/dev/test.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await pw.chromium.launch({ executablePath: SHELL, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(400);

  const rectOf = (sel) => page.evaluate((s) => {
    const el = window.__tv.root.querySelector(s);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);
  const clickAt = async (sel) => { const r = await rectOf(sel); await page.mouse.click(r.x, r.y); };

  // 灌入多条不同长度的数据
  await page.evaluate(() => {
    const seed = [
      '轻量级、实用、专注 —— 这是可以被选中并记录的示例文本，来自 text-vault 测试页。',
      'https://github.com/tampermonkey/tampermonkey/issues/1234 需要跟进的问题链接',
      '会议纪要要点：1. Q4 目标对齐 2. 接口联调时间表 3. 灰度方案评审,这条故意写得比较长用来验证三行截断的效果到底如何,再看一眼,再多写几个字。',
      'API-KEY-SAMPLE-sk-1234567890abcdef（置顶示例）',
    ];
    const root = window.__tv.root;
    // 通过 UI 新增,走真实路径
    for (let i = 0; i < seed.length; i++) {
      // 直接调用数据层不暴露,改走 composer
    }
  });

  // 用真实 UI 逐条新增
  for (const text of [
    '轻量级、实用、专注 —— 这是可以被选中并记录的示例文本，来自 text-vault 测试页。',
    'https://github.com/tampermonkey/tampermonkey/issues/1234 需要跟进的问题链接',
    '会议纪要要点：1. Q4 目标对齐 2. 接口联调时间表 3. 灰度方案评审。这条故意写得比较长，用来验证三行截断的效果到底如何，再多写几个字凑长度。',
    'API-KEY-SAMPLE-sk-1234567890abcdef（置顶示例）',
  ]) {
    await clickAt('.fab'); await sleep(120);
    await clickAt('.act-add'); await sleep(120);
    await page.evaluate((t) => { window.__tv.root.querySelector('.composer-area').value = t; }, text);
    await clickAt('.act-composer-save'); await sleep(120);
    await clickAt('.fab'); await sleep(100); // 关面板,下次再开
  }
  // 置顶最后一条
  await clickAt('.fab'); await sleep(150);
  await page.evaluate(() => {
    const items = window.__tv.root.querySelectorAll('.item');
    items[0].querySelector('[data-act="pin"]').click();
  });
  await sleep(200);
  await page.screenshot({ path: '/tmp/tv-panel.png' });

  // 选区浮出按钮
  const p = await page.locator('#para').boundingBox();
  await page.mouse.move(p.x + 5, p.y + 20);
  await page.mouse.down();
  await page.mouse.move(p.x + 420, p.y + 20, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  await page.screenshot({ path: '/tmp/tv-snap.png' });

  // 暗色模式
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(150);
  await page.screenshot({ path: '/tmp/tv-dark.png' });

  console.log('截图完成: /tmp/tv-panel.png /tmp/tv-snap.png /tmp/tv-dark.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
