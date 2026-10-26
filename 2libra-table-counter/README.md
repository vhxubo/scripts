# 2libra 表格条数统计（2libra Table Counter）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): every `table` component on the `/coins` page gets a live「共 N 条」row-count badge rendered just above it, and the number re-syncs the moment the table data changes.

## ✨ Features

- **Coins page only** - Only `/coins` (including a trailing slash, query or hash) shows counts; leaving the page removes the badges. The site-wide `@match` supports SPA navigation into the coins page
- **Counts every table** - Sweeps the whole page for `table` elements with a `tbody` and injects a right-aligned badge (`共 N 条`) directly in front of each one — no site classes depended on, inline styles only
- **Live sync** - A single `MutationObserver` on `document.documentElement` (`childList` + `class`/`hidden` attribute changes, rAF-debounced) re-counts on every data change: async loads, pagination, filtering, re-renders and SPA route switches all update the total immediately
- **Visible rows only** - Rows hidden via CSS (`display: none`) are excluded from the count, so the number always reflects what's actually shown
- **Hidden-table aware** - When a table is toggled away (e.g. the site's responsive `hidden` swap between table and card views) its badge hides too, and comes back with the table
- **Responsive visibility** - Uses computed styles so `hidden md:table` tables still show their counts on desktop; refreshes on window resize and resource load
- **SPA-safe** - New tables appearing after client-side navigation are picked up automatically; badges detached by re-renders are re-attached on the next sweep; DOM is written only when the count/visibility actually changed, so the observer never loops on its own output
- **Menu toggle** - Tampermonkey menu turns the badges on/off, persisted in GM storage across pages
- **Zero dependencies** - No `@require`, no external requests

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new userscript, paste in `2libra-table-counter.user.js`, save
3. Open https://2libra.com/coins — the「共 N 条」badge appears above it and follows every data change

When upgrading, replace the installed userscript with the latest version and refresh the page.

## 📖 Usage

| Action | How |
| :--- | :--- |
| See a table's row count | Look at the badge right above the table — updates live |
| Hide / show all badges | Tampermonkey menu → 表格条数统计：开启中（点击关闭）/ 已关闭（点击开启） |

## 🧪 Testing

Pure-logic tests (multi-`tbody` counting, hidden-row filtering, hidden-table detection, badge text/visibility writes, insert-once idempotence, on/off persistence) run in Node against the real script source:

```bash
node 2libra-table-counter.test.js
```

## ⚠️ Limitations

- The badge counts rows currently rendered in the DOM — for paginated tables it shows the current page's row count, not the server-side total (the site doesn't expose that in the markup)
- Tables rendered inside iframes are not covered (`@noframes`)
