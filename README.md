# scripts

A collection of lightweight, practical tools and automation scripts developed under the guidance of **vhxubo**. These scripts solve everyday problems with minimal dependencies and focused functionality.

## 🤖 AI-Assisted Development

This project was developed with AI assistance.

## 🎯 Purpose

This repository serves as a personal toolkit for productivity and workflow automation. Each tool is designed to be:

- **Lightweight** - Minimal dependencies, fast execution
- **Practical** - Solves real-world problems
- **Focused** - Single-purpose, no feature bloat
- **Usable** - Ready to run with clear documentation

## 🛠️ Tools & Scripts

| Tool | Description | Language | Status |
| :--- | :--- | :--- | :--- |
| **[BackDimmer](./BackDimmer/)** | Background-only dimming tool for focused work. Creates a transparent overlay that stays behind all windows to reduce eye strain without blocking visibility. | AutoHotkey v2 | v1.0.0 |
| **[Boss Key](./boss-key/)** | Boss-key userscript: one hotkey to land on the right work page. Per-project domain rules, two-stage project chooser (MRU + filter), direct keys, app launching via custom protocols (ZCode, WeCom), and optional open-tab reuse. | JavaScript (Tampermonkey) | v1.4.0 |
| **[2libra Hide Read](./2libra-hide-read/)** | Userscript for 2libra.com that auto-hides already-read posts from every list (main feed, sections, hot sidebar) and grays out natively-visited (pre-install) posts. Click/visit tracking, SPA-aware sweeping, cross-tab sync, temp-show and one-click clear via Tampermonkey menu. | JavaScript (Tampermonkey) | v1.1.0 |
| **[2libra Avatar Restore](./2libra-avatar-restore/)** | Userscript for 2libra.com that restores avatars to their original look site-wide: strips blur/saturate, scale, rotateY perspective and drop-shadow effect layers via `!important` CSS overrides, disables the shrink/spin/zoom hover-effect classes, and keeps the site's native "GIF avatars animate only while hovered" mechanism untouched (canvas static frame + hover-revealed img). `document-start` injection (no flash), SPA-aware sweeping and a menu on/off toggle. | JavaScript (Tampermonkey) | v1.1.0 |
| **[Text Vault](./text-vault/)** | 文本暂存匣 userscript: capture selected text anywhere via a floating "✚ 记" button or Tampermonkey menu (clipboard fallback), store it in GM storage shared across sites, then click an entry to insert it into the focused input (React/Vue friendly) or copy to clipboard. Editing, undoable delete, pinning, search, configurable hotkey, number-key quick use, draggable FAB & panel, cross-tab sync. | JavaScript (Tampermonkey) | v1.2.0 |
| **[2libra Table Counter](./2libra-table-counter/)** | Userscript for 2libra.com that injects a live「共 N 条」row-count badge above tables only on the `/coins` page. Visible rows only (`display:none` excluded), re-synced on data/pagination/filter changes, SPA route switches and window resize, respects responsive table visibility, on/off toggle persisted via Tampermonkey menu. | JavaScript (Tampermonkey) | v1.0.2 |

---

## Getting Started

Each tool is self-contained in its own directory with dedicated documentation. Navigate to the tool's folder for:

- Usage instructions
- Configuration options
- Build/compile commands (if applicable)

## 📝 License

Licensed under the MIT License. See [LICENSE](./LICENSE) for full terms.

---

**Author**: vhxubo
