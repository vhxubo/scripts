# 2libra 评论金币徽章助手（2libra Badge Switcher）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): a live helper bar above every comment editor on post pages that shows the character count and the **estimated coin cost** of your next comment, then picks the cheaper of your two cost-modifying badges — switching them via the site's own `/api/badges/equip` endpoint.

## 💡 Background

Posting a comment (or a post — same table) on 2libra costs coins on a length tier. The tiers below are confirmed by the site's official rules (发帖/评论分段税：超 100/1000/2000/5000 字扣 30/60/120/200) and match the site frontend's `COIN_COST.comment` exactly; editing and postscripts keep their own separate rates:

| Characters | Base cost |
| :--- | :--- |
| ≤ 100 | 10 coins |
| 101 – 1000 | 30 coins |
| 1001 – 2000 | 60 coins |
| 2001 – 5000 | 120 coins |
| > 5000 | 200 coins |

Users owning **neither** badge simply get the live char count plus the correct tier cost on the bar (e.g. 「当前：未佩戴费用徽章 · 发评约 30 金币」) — no buttons, no warnings, nothing misleading.

Two badge kinds modify that cost:

- **Fixed-cost badge** (`attributes.comment_cost`, e.g. 「前排打手」) — a flat **8 coins** no matter the length
- **Percent-off badge** (`attributes.comment_cost_percent`, e.g. 「都听我说！」) — **30% off** the base tier

So the break-even is exactly 100 characters: below it the percent badge wins (10 → 7 < 8), above it the flat badge wins (30 → 21 > 8). The script tracks this for you.

## ✨ Features

- **Live char count** — the bar re-renders on every keystroke in any comment editor on the page (bottom composer, reply boxes), powered by a capture-phase `input` listener + one rAF-debounced `MutationObserver`
- **Cost estimate** — shows your current badge and the coins the comment would cost, computed from the same tier table the site's frontend uses
- **Smart recommendation** — whichever of your two cost badges is cheaper for the current length; when you already wear it you get a green「✓ 当前最省」
- **Over-100 warning + quick switch** — typing past 100 chars while wearing the percent badge turns the count red, shows「⚠️ 超 100 字，减免 30% 不再划算」and a one-click「切换『前排打手』（8 金币）」button
- **Alt+B hotkey** — toggles between the two cost badges from anywhere on the page; if you currently wear neither, it equips the recommended one
- **Real API integration** — badges are fetched from `/api/badges/my`, current equipment from `/api/badges/user/:uuid/equipped` (uuid = JWT `sub`), switching posts `{badge_id, equip}` to `/api/badges/equip` with the `access_token` cookie as Bearer auth — exactly what the site's own badge page does
- **Recognition is field-exact** — badges are matched only on `attributes.comment_cost` / `attributes.comment_cost_percent`; other real-world attribute shapes sampled from the site (`float_percent`, `capybara_rate`, `coin_system_cost_percent`, …) are ignored. Users owning just one of the two badges (or neither) get a correctly degraded bar — the lone badge is still recommended whenever it beats wearing nothing
- **Cost check** — `/api/badges/equip/check-cost` is consulted before every switch; if the site would charge for it you get a confirm dialog first
- **Cross-tab aware** — re-syncs equipped state on tab focus, after every switch, and via the Tampermonkey menu
- **Degraded mode** — not logged in or API errors? The bar still shows the char count and base-tier cost
- **Menu toggle** — Tampermonkey menu turns the helper on/off, persisted in GM storage

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new userscript, paste in `2libra-badge-switcher.user.js`, save
3. Open any post on https://2libra.com/ and scroll to the comment editor — the helper bar sits right above it

## 📖 Usage

| Action | How |
| :--- | :--- |
| See char count & cost | Type in any comment editor; the bar above it updates live |
| Switch to the cheaper badge | Click the「切换…」button on the bar, or press **Alt+B** |
| Refresh badge data | Tampermonkey menu → 重新拉取徽章数据 |
| Hide / show the bar | Tampermonkey menu → 徽章助手：开启中（点击关闭） |

## 🧪 Testing

Pure-logic tests (cost tiers, badge classification, recommendation break-even, bar copy for every scenario, JWT decode incl. UTF-8 usernames, equipped-list normalization, route matching, cookie reading) run in Node against the real script source:

```bash
node 2libra-badge-switcher.test.js
```

## ⚠️ Limitations

- The estimate covers **posting** comments; editing a comment has a different (slightly cheaper) tier and is not modeled
- The editor is detected via the site's `w-md-editor` markdown editor; if the site swaps editor libraries the selectors need updating
- Flat + percent badges are assumed not to stack — switching equips the target and unequips the other one
- If the site starts charging for badge switches, you'll see a confirm dialog (via `check-cost`); the script never spends coins silently
