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
| **[Text Vault](./text-vault/)** | 文本暂存匣 userscript: capture selected text anywhere via a floating "✚ 记" button or Tampermonkey menu (clipboard fallback), store it in GM storage shared across sites, then click an entry to insert it into the focused input (React/Vue friendly) or copy to clipboard. Editing, undoable delete, pinning, search, configurable hotkey, number-key quick use, draggable FAB & panel, cross-tab sync. | JavaScript (Tampermonkey) | v1.2.1 |
| **[2libra Badge Switcher](./2libra-badge-switcher/)** | Userscript for 2libra.com post pages: a live helper bar above every comment editor (including posts opened in the site's native `<dialog>` popup from a list page) showing char count and estimated coin cost, recommending the cheaper cost badge from the badges' real attributes (any fixed-cost / percent-off pair, break-even computed per length). Red warning + one-click switch when the worn badge stops being cheaper, one-click「摘下」when it costs more than wearing nothing, dual-equip detection, Alt+B that only ever moves to the cheaper option, switching via `/api/badges/equip` with a pre-switch cost check, Pandora-event-aware estimates, and manager-driven auto-updates through GitHub raw (`@updateURL`/`@downloadURL`, CI version-bump check). | JavaScript (Tampermonkey) | v1.5.0 |

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
