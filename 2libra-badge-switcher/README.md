# 2libra 评论金币徽章助手（2libra Badge Switcher）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): a live helper bar above every comment editor on post pages that shows the character count and the **estimated coin cost** of your next comment, then picks the cheaper of your two cost-modifying badges — switching them via the site's own `/api/badges/equip` endpoint. The **daily Pandora event takes priority over badge logic**: when 「回归起点」 locks all badges the bar stops offering switches, when 「妙笔生花」 fixes the comment cost or 「多说多写」(gold) makes comments free the badges drop out of the calculation, and 「金币升降机」 scales every displayed cost by its ±%.

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

So for this pair the break-even is 100 characters: below it the percent badge wins (10 → 7 < 8), above it the flat badge wins (30 → 21 > 8). The script does **not** hardcode that number: it recomputes the break-even from the two badges' real attributes on every keystroke, so the site's other percent badges (10% / 15% / 30%) and flat badges (8 / 10 coins) are handled the same way — and so is a badge that makes comments *more* expensive.

## ✨ Features

- **Live char count** — the bar re-renders on every keystroke in any comment editor on the page (bottom composer, reply boxes), powered by a capture-phase `input` listener + one rAF-debounced `MutationObserver`
- **Pandora first** — the active daily event (fetched from `/api/pandora/today`, refreshed on tab focus) outranks badge logic:
  - 「回归起点」`badge_drop_lock` — badges are dropped & locked until the next box: red bar with the event name and local-time deadline, no switch/unequip buttons, Alt+B explains instead of switching, and a stale switch request is intercepted
  - 「妙笔生花」`fixed_text_cost` — the comment cost is fixed at N coins (from `rolled_value`, falling back to parsing 「固定为 N 金币」 from the event text): the bar shows the flat cost and badges step aside
  - 「多说多写」`comment_min_length` — the gold variant makes comments free (「不扣除金币」 detected from the event text); every variant shows a `≥N 字` warning while your draft is too short
  - 「金币升降机」`coin_modifier_percent` — the site's `COINS_MODIFIER_IMMUNE_REASONS` exemption list does **not** cover comment/post costs, so every displayed cost (and every saving amount) is scaled by `1 ± N%`; since the scaling is uniform it never changes *which* badge is cheaper
  - 「小表情」`comment_custom_emoji_required` — the bar reminds you a custom emoji is required
  - Avatar/task/coin-rain events don't affect comment costs — badge logic runs untouched
- **Cost estimate** — shows your current badge and the coins the comment would cost, computed from the same tier table the site's frontend uses
- **Smart recommendation** — whichever of your two cost badges is cheaper for the current length; when you already wear it you get a green「✓ 当前最省」, and equal-cost pairs no longer produce a pointless「可省 0 金币」switch button
- **Dynamic warning + quick action** — the red warning is generated from the badge's actual attribute (e.g.「⚠️ 减免 10% 不如固定 8 金币」) and fires whenever the percent badge stops being the cheaper choice, not at a hardcoded 100-char threshold; the button switches to the cheaper badge, or offers「摘下」when your worn badge costs more than wearing nothing
- **Dual-equip detection** — if both cost badges end up equipped (the site allows coexistence, or an unequip call fails), the bar says so, warns that the estimate may be off, and offers to remove the redundant one instead of silently pretending only one is worn
- **Alt+B hotkey** — keeps the cheaper badge: it switches only when the other badge is actually cheaper, does nothing (with a toast) when you are already optimal, and unequips when your worn badge is worse than wearing nothing or when two cost badges are equipped at once
- **Real API integration** — badges are fetched from `/api/badges/my`, current equipment from `/api/badges/user/:uuid/equipped` (uuid = JWT `sub`), switching posts `{badge_id, equip}` to `/api/badges/equip` with the `access_token` cookie as Bearer auth — exactly what the site's own badge page does. Badge entries that only carry `badge.id` (instead of `badge_id`) are normalized, so a switch can never post `badge_id: undefined`
- **Recognition is field-exact** — badges are matched only on `attributes.comment_cost` / `attributes.comment_cost_percent`; other real-world attribute shapes sampled from the site (`float_percent`, `capybara_rate`, `coin_system_cost_percent`, …) are ignored. Users owning just one of the two badges (or neither) get a correctly degraded bar — the lone badge is still recommended whenever it beats wearing nothing
- **Cost check** — `/api/badges/equip/check-cost` is consulted before every switch; if the site would charge for it you get a confirm dialog first
- **Cross-tab aware** — re-syncs equipped state on tab focus, after every switch, and via the Tampermonkey menu (concurrent refreshes share one request)
- **Degraded mode** — not logged in, API errors, or an undecodable `access_token` cookie? The bar still shows the char count and base-tier cost, and a malformed cookie can no longer break initialization
- **Menu toggle** — Tampermonkey menu turns the helper on/off, persisted in GM storage
- **Auto-updates** — the header declares `@updateURL`/`@downloadURL` on the jsDelivr GitHub mirror, so Tampermonkey/Violentmonkey compares `@version` and installs new releases by itself. There is deliberately **no in-script updater**: it could only notify, never install, and would add `GM_xmlhttpRequest`/`@connect` permission prompts. A GitHub Actions workflow validates each release (syntax, tests, `@version` must increase) and purges the jsDelivr cache

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Install from `https://cdn.jsdelivr.net/gh/vhxubo/scripts@main/2libra-badge-switcher/2libra-badge-switcher.user.js` (fallback: the [raw GitHub URL](https://raw.githubusercontent.com/vhxubo/scripts/main/2libra-badge-switcher/2libra-badge-switcher.user.js)), or create a new userscript and paste in `2libra-badge-switcher.user.js`, then save
3. Open any post on https://2libra.com/ and scroll to the comment editor — the helper bar sits right above it

## 📖 Usage

| Action | How |
| :--- | :--- |
| See char count & cost | Type in any comment editor; the bar above it updates live |
| Switch to the cheaper badge | Click the「切换…」button on the bar, or press **Alt+B** |
| Remove an over-priced / redundant badge | Click the「摘下…」button (also reachable with **Alt+B**) |
| Refresh badge data | Tampermonkey menu → 重新拉取徽章数据 |
| Hide / show the bar | Tampermonkey menu → 徽章助手：开启中（点击关闭） |
| Update the script | Automatic: the userscript manager checks `@updateURL`; force a check from its dashboard if needed |

## 🔄 Update pipeline

On every push to `main` that touches the userscript, [`.github/workflows/2libra-badge-switcher.yml`](../.github/workflows/2libra-badge-switcher.yml) runs the syntax check and the test suite, fails if `@version` was not increased, and purges the jsDelivr cache for the file. Installed copies then pick the release up on the manager's next update check — the script itself intentionally does no update polling.

## 🧪 Testing

Pure-logic tests (cost tiers, badge classification incl. `badge.id` normalization, recommendation break-even, dynamic percent copy, equal-cost pairs, dual-equip and「摘下」decisions, bar copy for every scenario, JWT decode incl. UTF-8 usernames, equipped-list normalization, route matching, cookie reading incl. malformed encoding, plus the full Pandora suite — activity window, per-event parsing incl. `rolled_value`/text fallback/constraint overrides, every bar scenario and ±% rounding, and the update-metadata assertions — jsDelivr URL pair and no cross-origin grants) run in Node against the real script source:

```bash
node 2libra-badge-switcher.test.js
```

## ⚠️ Limitations

- The estimate covers **posting** comments; editing a comment has a different (slightly cheaper) tier and is not modeled
- Pandora effect parsing mirrors the payloads observed in the wild (`event_code` / `event_title` / `rolled_value` / `comment_constraint`); if the site ships new event codes or renames the wording, the bar falls back to plain badge logic instead of guessing
- The site enforces a badge-switch cooldown (`BADGE_CHANGE_COOLDOWN_MINUTES = 10` in its frontend constants); a cooldown rejection surfaces as a red toast from the site's error message
- The editor is detected via the site's `w-md-editor` markdown editor; if the site swaps editor libraries the selectors need updating
- Flat + percent badges are assumed not to stack — switching equips the target and unequips the other one; if the unequip call fails the bar surfaces it and offers a manual「摘下」rather than silently pretending the state changed
- If the site starts charging for badge switches, you'll see a confirm dialog (via `check-cost`); the script never spends coins silently
- The `access_token` must be a JS-readable cookie for the badge features to work; if the site makes it HttpOnly, the bar degrades to char count + base-tier cost
- Updates are performed by the userscript manager. The script only declares `@updateURL`/`@downloadURL`; whether/when a manager checks for updates (and whether auto-update is enabled at all) is user/manager policy
- `@updateURL` has no mirror fallback: it points at jsDelivr. If jsDelivr is unreachable, manager auto-update pauses until it recovers; installing the raw GitHub file manually is the fallback
- v1.2.0 shipped without any update metadata, so existing installs need **one manual reinstall** from the URLs above; from v1.4.0 on, the manager takes over. A release is only seen after it is pushed to the branch used by `@updateURL` and `@version` is increased — CI fails the build when the bump is missing
