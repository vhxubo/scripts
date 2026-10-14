# 2libra 头像原样恢复（2libra Avatar Restore）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): removes every decorative effect the site applies to avatars — blur, saturation, scaling, 3D rotation/perspective, drop-shadow offsets, hover shrink — and shows the original image in its plain, rounded form, site-wide.

## ✨ Features

- **Site-wide scope** - Targets the avatar component by its signature class (`[&_img]:block` Tailwind arbitrary variant, present on every avatar container: lists, sidebar, posts, profile page); regular images are untouched
- **De-blur** - Neutralizes the `filter: blur(2px) saturate(0.85)` + `transform: scale(1.04)` effect layer with `!important` overrides that beat inline styles
- **De-offset / de-rotate** - Strips `drop-shadow` filters and `perspective(...) rotateY(...)` transforms from every layer inside the component, along with `transition`, `will-change`, and `backface-visibility` leftovers
- **Show the original image** - For canvas-rendered avatars (site draws a processed copy on `<canvas>` and hides the real `<img>` with `display: none`), the canvas is hidden and the original image revealed in place
- **No hover shrink** - The `avatar-shrink-hover` class is removed on sight (MutationObserver + rAF-throttled sweep), with a CSS fallback for its unknown stylesheet rules
- **SPA-aware** - Built for the site's Next.js client-side routing: the observer catches hydration, pagination, section switches, and hover-animation class writes
- **No flash** - Injected at `document-start`, so avatars never render blurred for a frame before being restored
- **Menu toggle** - One Tampermonkey menu entry switches the whole script on/off for quick before/after comparison

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new userscript, paste in `2libra-avatar-restore.user.js`, save
3. Open <https://2libra.com/> — all avatars render as their original images

## 🧩 How it works

The site's avatar component layers effects onto fixed-size containers:

```
根容器（filter: drop-shadow 投影层）
└─ 内层 div（filter: blur+saturate 模糊层 / transform: rotateY 3D 卡片层）
   └─ 定位 div
      ├─ canvas   ← 站点把处理过的图画在这里
      └─ img      ← 原图，被置为 display: none
```

The script injects one stylesheet that, inside any `[class*="[&_img]:block"]` container: resets `filter`/`transform`/`transition`/`will-change`/`backface-visibility`/`perspective` on the root and every inner `div` (all effect layers), hides the `canvas` when a native `img` follows it, and restores the `img`. Inline styles are beaten by `!important`, so no DOM rewriting is needed for the effect layers — the only JS-side DOM change is dropping the `avatar-shrink-hover` class, which React tolerates the same way the sibling 2libra-hide-read script stays reconciliation-safe.

## 🧪 Testing

Two layers of verification:

```bash
# 纯逻辑测试：生成的 CSS、真实 class 样例匹配、菜单开关行为
node 2libra-avatar-restore.test.js

# 真实浏览器验证：reproduce.html 复刻了四种线上样例（模糊/偏移/缩放/旋转），
# 加载脚本本体后逐项断言计算样式。任意静态服务器 + 无头浏览器均可：
#   python3 -m http.server 8642
#   chrome --headless --dump-dom --virtual-time-budget=3000 http://127.0.0.1:8642/reproduce.html
```

## ⚠️ Limitations

- Purely visual: the original image still comes from the site's CDN (`r2.2libra.com`), so it loads only when the site would load it anyway
- If the site renames the signature classes (`[&_img]:block` / `avatar-shrink-hover`), update `SIGNATURE` / `SHRINK_CLASS` at the top of the script
- Browsers without `:has()` support skip only the canvas-hiding rule; the original `img` still stacks above the canvas, so avatars remain correct
