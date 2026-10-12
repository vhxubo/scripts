# 2libra 已读帖子隐藏（2libra Hide Read）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): posts you have already read are automatically hidden from every list — the main feed, section pages, and the 「今日热议 🔥」 sidebar — so new content stands out.

## ✨ Features

- **Native visited gray-out** - Posts read **before** the script was installed are grayed out via the browser's native `:visited` styling (theme-adaptive `color-mix`), the moment the page loads — no records needed
- **Auto read-tracking** - Clicking a post title (including middle-click / open-in-new-tab) or landing on a post detail page records it as read; aggregate pages like `/post/latest` and `/post/hot/*` are never miscounted
- **Whole-row hiding** - The read post's entire row is hidden (title + node badge + author + time + reply count); aggregator sidebar entries hide as complete rows too; fallback hides the title link alone if the markup changes
- **SPA-aware** - Built for the site's Next.js client-side routing: a MutationObserver re-sweeps on hydration, pagination and section switches, and `pushState`/`popstate` hooks catch soft navigations to post pages
- **React-safe** - Hides via inline `display: none` instead of `element.remove()`, so React reconciliation never hits a missing node; every sweep re-evaluates rows in case React reuses DOM nodes for different posts
- **Cross-tab sync** - Read state lives in Tampermonkey storage (`GM_setValue`); reading a post in one tab hides it in the others via `GM_addValueChangeListener`
- **Menu controls** - Temporarily show read posts (until refresh), and one-click clear of all records (with count)
- **Bounded storage** - Keeps the newest 5,000 records, evicting the oldest

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new userscript, paste in `2libra-hide-read.user.js`, save
3. Open <https://2libra.com/> — from then on, any post you open disappears from lists on your next visit

> Read tracking starts from installation: posts read before the script was installed cannot be **hidden** (browsers don't expose history to page scripts) — they are **grayed out** via native `:visited` instead. Hiding cannot rely on `:visited` either: browsers restrict it to color properties and never let page scripts probe visited state.

## 📖 Usage

| Action | How |
| :--- | :--- |
| Mark as read | Click a post title, or open the post page (auto) |
| Temporarily show read posts | Tampermonkey menu → 临时显示已读帖子（刷新后失效） |
| Clear all records | Tampermonkey menu → 已读记录 N 条 · 点击清空 |

## ⚙️ Configuration

Edit the constants at the top of the script:

- `HIDE_WHOLE_ROW` (default `true`) - set `false` to hide only the `a.title-link` anchor instead of its whole row
- `MAX_RECORDS` (default `5000`) - read-record capacity before oldest-first eviction
- `TITLE_SELECTOR` - the post-title anchor selector, if the site's markup changes

## 🧪 Testing

Pure-logic tests (URL normalization, aggregate-page filtering, dedupe, first-read timestamp, capacity eviction) run in Node against the real script source:

```bash
node 2libra-hide-read.test.js
```

## ⚠️ Limitations

- Posts read in another browser profile / device are not synced (records live in local Tampermonkey storage)
- Hiding is visual only — a hidden post still exists on the site; use the menu to reveal it
