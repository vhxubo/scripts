# 2libra 评论金币徽章助手（2libra Badge Switcher）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): a live helper bar above every comment editor on post pages (including posts 2libra renders in its native `<dialog>` popup from a list page) that shows the character count and the **estimated coin cost** of your next comment, then offers the optimal cost-modifying badge(s) — fixed-cost or percent-off, including 「大平衡者」's `coin_system_cost_percent` — switching via the site's own `/api/badges/equip` endpoint. When two badges tie as optimal (e.g. 「都听我说！」 and 「大平衡者」), both are offered, even the peer you are not wearing. If you own the 「走个面」 badge, a one-click **activity +20% wear/remove toggle** sits at the far left of the same bar, deliberately independent of comment length and coin cost. The **daily Pandora event takes priority over badge logic**: comment-spending events (「妙笔生花」 fixed cost, 「多说多写」 free comments, 「金币升降机」 ±%) disable badge calculation entirely, 「多说多写」 otherwise only enforces its length floor, and 「回归起点」 locks all badges.

## 💡 Background

Posting a comment (or a post — same table) on 2libra costs coins on a length tier. The tiers below are confirmed by the site's official rules (发帖/评论分段税：超 100/1000/2000/5000 字扣 30/60/120/200) and match the site frontend's `COIN_COST.comment` exactly; editing and postscripts keep their own separate rates:

| Characters | Base cost |
| :--- | :--- |
| ≤ 100 | 10 coins |
| 101 – 1000 | 30 coins |
| 1001 – 2000 | 60 coins |
| 2001 – 5000 | 120 coins |
| > 5000 | 200 coins |

Users owning **neither** badge simply get the live char count plus the correct tier cost on the bar (e.g. 「当前：未佩戴 · 发评约 30 金币」) — no buttons, no warnings, nothing misleading.

Two badge kinds modify that cost:

- **Fixed-cost badge** (`attributes.comment_cost`, e.g. 「前排打手」) — a flat **8 coins** no matter the length
- **Percent-off badge** (`attributes.comment_cost_percent`, e.g. 「都听我说！」, or `attributes.coin_system_cost_percent`, e.g. 「大平衡者」) — **30% off** the base tier; either field counts as a comment discount

So for this pair the break-even is 100 characters: below it the percent badge wins (10 → 7 < 8), above it the flat badge wins (30 → 21 > 8). The script does **not** hardcode that number: it recomputes the break-even from the two badges' real attributes on every keystroke, so the site's other percent badges (10% / 15% / 30%) and flat badges (8 / 10 coins) are handled the same way — and so is a badge that makes comments *more* expensive.

## ✨ Features

- **Live char count** — comment input updates only its own editor's bar, with multiple inputs in one animation frame coalesced. The DOM observer scans for editors only when editors, bars, or dialog containers are added/removed, or a DOM mutation reveals a route change; unrelated page updates and the bar's own text updates are ignored. Non-comment inputs do not schedule rendering
- **走个面 quick toggle** — if you own the 「走个面」 badge (`do_me_a_favor`, `attributes.daily_active_gain_percent: 0.2`), a small button pinned to the **far left** of the bar shows `走个面 +20%` (green `✓ 走个面 +20%` once worn; hover to see the remove action); clicking it wears or removes just that badge via `/api/badges/equip`, without touching the cost badges. It is **not** part of the cost model: it never reads the comment length and never changes the coin estimate, so it stays available on short and long comments alike. If `/api/badges/my` doesn't include the badge, or you don't own it, the button is not rendered at all. The label is a single short string at every width; the button sizes to its content. A subtle divider separates activity from comment costs. While a request is pending it immediately shows `佩戴中…` / `摘下中…` and disables repeated clicks; success and failure produce a toast. Under 「回归起点」 it is dimmed and directly displays `潘多拉锁定中` with the local expiry time when available; the full event and deadline remain in its tooltip
- **Dialog-rendered posts** — when 2libra opens a post inside its native `<dialog>` modal (clicking a post on a list page keeps the URL on the list page), the bar is injected into that dialog's comment editor too. The context check is per editor and dialog identity wins over the route: any editor inside a modal is judged by the modal's id/class, so dialogs that merely *contain* an editor for another purpose (`edit-post`, `add-postscripts`, search, node picker, voting…) are excluded **even on a post-detail page**, while the post dialog (no telling id/class) is always allowed. A closed post dialog still counts as comment context, so closing and reopening it keeps the same bar in place instead of inserting a new one. A `toggle` listener re-renders when a dialog is reopened from cache
- **Compact badge toolbar** — a single **28 px** row on desktop and mobile, with small buttons. Char counts keep a stable minimum width and show `draft/min` during 「多说多写」; action buttons size to their content. When two equal-cost badges are offered, both buttons sit side by side and shrink on narrow containers (the 走个面 toggle yields space first). Narrow containers hide the secondary hint; full status and hint text remain available in the status hover title. Long button labels are ellipsized with full labels in hover titles. Colors inherit the site’s `--color-*` variables across all 35 currently defined themes and follow live theme switches. Each editor keeps its bar across wrapper updates and dialog reopening.
- **Pandora first** — the active daily event (fetched from `/api/pandora/today`, refreshed on tab focus) outranks badge logic:
  - 「回归起点」`badge_drop_lock` — badges are dropped & locked until the next box: red bar with the event name and local-time deadline, no switch buttons, and a stale switch request is intercepted
  - 「妙笔生花」`fixed_text_cost` — the comment cost is fixed at N coins (from `rolled_value`, falling back to parsing 「固定为 N 金币」 from the event text): the bar shows the flat cost and badges step aside
  - 「多说多写」`comment_min_length` — a pure length gate: the bar shows `draft/min 字` and `⚠️ 还差 N 字才能发送` until the floor is met, and **does not offer badge switches**; the gold variant also makes comments free once the floor is met
  - 「金币升降机」`coin_modifier_percent` — a comment-spending event, so **badges do not stack**: the bar shows `base × (1 ± N%)` and offers no switch buttons
  - 「小表情」`comment_custom_emoji_required` — the bar reminds you a custom emoji is required
  - Avatar/task/coin-rain events don't affect comment costs — badge logic runs untouched
- **Cost estimate** — shows your current badge and the coins the comment would cost, computed from the same tier table the site's frontend uses
- **Optimal-only actions** — it computes the cheapest badge(s) for the current length and shows only those: one button when a single badge wins, two side-by-side buttons when the top badges tie. Wearing one of two equal-cost badges still leaves the peer as a same-price replacement on the right; badges that are more expensive than the optimum are not shown. There is no unequip action — the bar only recommends/switches badges
- **Dynamic warning** — the red warning is generated from the badge's actual attribute (e.g.「⚠️ 减免 10% 不如固定 8 金币」) and fires whenever the percent badge stops being the cheaper choice, not at a hardcoded 100-char threshold; a badge that costs more than wearing nothing is flagged with a red warning (no unequip button)
- **Real API integration** — badges are fetched from `/api/badges/my`, current equipment from `/api/badges/user/:uuid/equipped` (uuid = JWT `sub`), switching posts `{badge_id, equip}` to `/api/badges/equip` with the `access_token` cookie as Bearer auth — exactly what the site's own badge page does. Badge entries that only carry `badge.id` (instead of `badge_id`) are normalized, so a switch can never post `badge_id: undefined`
- **Recognition is field-exact** — cost badges are matched on `attributes.comment_cost`, `attributes.comment_cost_percent`, or `attributes.coin_system_cost_percent`; other real-world attribute shapes sampled from the site (`float_percent`, `capybara_rate`, `daily_active_gain_percent`, …) are ignored. Every owned cost badge of each kind is kept (sorted), so 「都听我说！」 and 「大平衡者」 coexist as peers. The 「走个面」 toggle is recognized separately (badge id `do_me_a_favor`, name containing `走个面`, or `attributes.daily_active_gain_percent`) and never enters the cost recommendation. Users owning just one cost badge (or neither) get a correctly degraded bar — the lone badge is still recommended whenever it beats wearing nothing
- **Cost check** — `/api/badges/equip/check-cost` is consulted before every switch; if the site would charge for it you get a confirm dialog first
- **Low-frequency state sync** — while the page is visible and a comment editor is open, checks equipment (including 「走个面」) at most once per minute, badge attributes every 10 minutes, and Pandora every 5 minutes. Typing, focusing an editor, reopening a dialog and returning to the tab share the same cache and in-flight requests. Background pages, closed dialogs and a disabled helper pause polling. Failed queries preserve prior data and back off for 2/4/8/10 minutes. Badge changes immediately confirm equipment; the manual refresh menu bypasses caches. No page reload is needed.
- **Degraded mode** — not logged in, API errors, or an undecodable `access_token` cookie? The bar still shows the char count and base-tier cost, and a malformed cookie can no longer break initialization
- **Menu toggle** — Tampermonkey menu turns the helper on/off, persisted in GM storage
- **Auto-updates** — the header declares `@updateURL`/`@downloadURL` on the GitHub raw file, so Tampermonkey/Violentmonkey compares `@version` and installs new releases by itself. There is deliberately **no in-script updater**: it could only notify, never install, and would add `GM_xmlhttpRequest`/`@connect` permission prompts. Raw caches for only ~5 minutes, and a GitHub Actions workflow validates each release (syntax, tests, `@version` must increase). A jsDelivr branch mirror was tried but its branch cache/purge proved unreliable, so it is not used

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Install from `https://raw.githubusercontent.com/vhxubo/scripts/main/2libra-badge-switcher/2libra-badge-switcher.user.js` (the same URL is used for updates), or create a new userscript and paste in `2libra-badge-switcher.user.js`, then save
3. Open any post on https://2libra.com/ and scroll to the comment editor — the helper bar sits right above it (or click a post on a list page if 2libra opens it in a dialog; the bar sits above the editor inside the dialog)

## 📖 Usage

| Action | How |
| :--- | :--- |
| See char count & cost | Type in any comment editor; the bar above it updates live |
| Wear / remove 「走个面」 (activity +20%) | Click the「走个面 +20%」button at the **far left** of the bar. It only appears if you own the badge, and toggles that badge alone — comment length and the cost estimate are not involved |
| Switch to the cheaper badge | Click the badge button on the bar (one or two when the top badges tie) |
| Refresh badge data | Tampermonkey menu → 重新拉取徽章与潘多拉数据 |
| Hide / show the bar | Tampermonkey menu → 徽章助手：开启中（点击关闭） |
| Update the script | Automatic: the userscript manager checks `@updateURL`; force a check from its dashboard if needed |

## 🔄 Update pipeline

On every push to `main` that touches the userscript, [`.github/workflows/2libra-badge-switcher.yml`](../.github/workflows/2libra-badge-switcher.yml) runs the syntax check and the test suite, and fails if `@version` was not increased. Raw then serves the release within its ~5-minute cache, and installed copies pick it up on the manager's next update check — no purge step is needed, and the script itself intentionally does no update polling.

## 🧪 Testing

Pure-logic tests (cost tiers, badge classification incl. `badge.id` normalization, 「走个面」 detection (id/name/`daily_active_gain_percent`)/gain normalization/label and its exclusion from cost recommendation, plus optimal-badge selection (including equal-cost peers), dynamic percent copy, the no-unequip model, bar copy for every scenario, JWT decode incl. UTF-8 usernames, equipped-list normalization, route matching, dialog-context matching (post dialog vs edit/附言/search dialogs, dialog identity overriding the route on post-detail pages, closed post dialogs staying in context), the bar's layout-stability contract (nowrap, fixed 28 px height bounds, fixed-height non-shrinking buttons, ellipsized text spans, per-editor reuse instead of re-insertion), cookie reading incl. malformed encoding, plus the full Pandora suite — activity window, per-event parsing incl. `rolled_value`/text fallback/constraint overrides, every bar scenario (cost events suppress badges, 多说多写 is a length-only gate), the preview/user.js parity checks (shared model block and bar CSS), and the update-metadata assertions — raw URL pair and no cross-origin grants) run in Node against the real script source:

```bash
node 2libra-badge-switcher.test.js
```

## ⚠️ Limitations

- The estimate covers **posting** comments; editing a comment has a different (slightly cheaper) tier and is not modeled
- Pandora effect parsing mirrors the payloads observed in the wild (`event_code` / `event_title` / `rolled_value` / `comment_constraint`); if the site ships new event codes or renames the wording, the bar falls back to plain badge logic instead of guessing
- The site enforces a badge-switch cooldown (`BADGE_CHANGE_COOLDOWN_MINUTES = 10` in its frontend constants); a cooldown rejection surfaces as a red toast from the site's error message
- The 「走个面」 toggle replaces the current badge when equipping and displays the configured +20%; it does not verify the site's activity calculation. Detection uses the badge id/name first and `daily_active_gain_percent` as a fallback, so if the site ships another badge with the same attribute the first match owns the button
- The editor is detected via the site's `w-md-editor` markdown editor; if the site swaps editor libraries the selectors need updating (this also applies inside the post dialog)
- The post dialog itself is recognised by “an editor inside a `<dialog>`/`.modal`/`[role="dialog"]` that isn't a known non-comment modal” (open or closed). If the site gives the post dialog an id/class that collides with the exclusion list, or renders its comment box outside the dialog, the selector logic needs a tweak
- Only one badge can be equipped at a time, including the activity badge. The equip endpoint directly replaces the current badge; Pandora badge lock disables equipping.
- If the site starts charging for badge switches, you'll see a confirm dialog (via `check-cost`); the script never spends coins silently
- The `access_token` must be a JS-readable cookie for the badge features to work; if the site makes it HttpOnly, the bar degrades to char count + base-tier cost
- Updates are performed by the userscript manager. The script only declares `@updateURL`/`@downloadURL`; whether/when a manager checks for updates (and whether auto-update is enabled at all) is user/manager policy
- `@updateURL` has no mirror fallback: it points at GitHub raw. On networks where `raw.githubusercontent.com` is blocked, manager auto-update fails. A jsDelivr branch mirror was evaluated and rejected because its branch cache/purge is unreliable (a known upstream issue), not because of the CDN itself
- v1.2.0 shipped without any update metadata, so existing installs need **one manual reinstall** from the URLs above; from v1.4.0 on, the manager takes over. A release is only seen after it is pushed to the branch used by `@updateURL` and `@version` is increased — CI fails the build when the bump is missing

## 本地效果预览

直接用浏览器打开 [preview.html](preview.html)，无需安装依赖或启动服务。费用模型、潘多拉解析与工具栏样式由 `node build-preview.js` 从 `2libra-badge-switcher.user.js` 生成，页面只保留演示外壳；改动 user.js 后重新运行该脚本即可，测试会校验两边同步。页面集中展示「大平衡者 / 都听我说！」同价替换、最优解按钮、走个面开关、操作进度、潘多拉事件、字数阶梯和窄屏状态；支持主题切换、编辑评论、模拟失败和帖子弹窗。所有操作均使用本地模拟数据，不访问真实 API。
