# Boss Key（老板键 · 工作页快速跳转）

A Tampermonkey userscript: one hotkey to always land on the right work page. Hit a configured project domain and it jumps straight to that project's link; miss and a project chooser pops up. Custom URL protocols (e.g. `zcode://`, `wxwork://`) turn it into an app launcher as well.

## ✨ Features

- **Smart jump** - Domain hits a project rule → jump directly to that rule's link (fallback chain: rule link → project default page → current site origin)
- **Two-stage chooser** - No rule hit → on-screen project picker: press the project key, click, or Enter; sorted by recently-used, filter-as-you-type, Esc cancels
- **Direct keys (opt-in)** - `Alt + <project key>` opens a project without the two-stage flow
- **Per-project rules** - Match by domain (subdomains included), `IP:port` (exact), or path prefix; rules are evaluated top-down, first hit wins
- **Quick rule add** - Menu item "add current site as a rule": prefills domain and current URL, one click to save
- **Open-tab reuse (approximate)** - Tracks open work pages (probe-verified alive); when enabled, jumps to the address an existing same-domain tab is parked on. Browsers don't let page scripts focus/close other tabs, so the old tab still needs manual cleanup
- **App launcher presets** - Ships with ZCode (`zcode://open`) and WeCom (`wxwork://`) presets, merged into existing configs once
- **Config import/export** - JSON export to clipboard, paste-to-import in the settings panel
- **Robust UI** - Settings panel and chooser live in a Shadow DOM with `adoptedStyleSheets`, safe on strict-CSP pages; runs at `document-start` so the hotkey works while pages load

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new userscript, paste in `boss-key.user.js`, save
3. Tampermonkey will ask to run on all sites (`@match *://*/*`) - accept

Default hotkey: <kbd>Alt</kbd>+<kbd>W</kbd>. First launch of a protocol preset (ZCode / WeCom) triggers a one-time browser confirm dialog.

## ⌨️ Usage

| Action | How |
| :--- | :--- |
| Smart jump | Hotkey, or Tampermonkey menu → 🚀 跳转工作页 |
| Open project chooser | Hotkey when no rule matches, or menu → 📂 选择项目 |
| Pick a project | Its key (`1`, `2`, ...), click, Enter (default/recent project), Esc to cancel |
| Add current site as rule | Menu → ➕ 把当前站点加为规则 |
| Settings | Menu → ⚙️ 老板键：设置 |

## ⚙️ Configuration

Stored via `GM_setValue` (shared across all sites, survives browser restarts). The settings panel manages:

- Trigger hotkey (record any combo) and direct-key toggle
- Enter-target: default project vs. most-recently-used
- Open-tab reuse switch (see limitations below)
- Projects: name, chooser key, default work page, domain rules
- Import/export JSON

## 🧪 Testing

Pure-logic tests (matching, migration, presets, key assignment, MRU, hotkey parsing) run in Node against the real script source:

```bash
node boss-key.test.js
```

## ⚠️ Limitations

- Page scripts cannot enumerate or focus other tabs - "reuse open tab" navigates the current tab to the other tab's address instead; close leftovers manually. A companion extension would be needed for true tab switching
- The hotkey only works while a normal web page has focus (`chrome://` pages, the new-tab page and desktop are out of reach for userscripts)
- Prefer digit keys for direct keys: on Windows, Firefox reserves `Alt`+letter for menu accelerators
