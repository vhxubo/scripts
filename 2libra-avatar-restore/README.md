# 2libra 头像原样恢复（2libra Avatar Restore）

A Tampermonkey userscript for [2libra.com](https://2libra.com/): removes every decorative effect the site applies to avatars — blur, saturation, scaling, 3D rotation/perspective, drop-shadow offsets, hover shrink/spin/zoom — while **keeping the site's native "GIF avatars animate only while hovered" behavior**, site-wide.

## ✨ Features

- **Site-wide scope** - Targets the avatar component by its signature class (`[&_img]:block` Tailwind arbitrary variant, present on every avatar container: lists, sidebar, posts, profile page); regular images are untouched
- **De-blur** - Neutralizes the `filter: blur(2px) saturate(0.85)` + `transform: scale(1.04)` effect layer with `!important` overrides that beat inline styles
- **De-offset / de-rotate** - Strips `drop-shadow` filters and `perspective(...) rotateY(...)` transforms from every layer inside the component, along with `transition`, `will-change`, and `backface-visibility` leftovers
- **Hover effects off** - The `avatar-shrink-hover` / `avatar-spin-hover` / `avatar-zoom-hover` effect classes (mapped from the site's `avatar_effect` field) are stripped on sight and neutralized in CSS; `animation: none` kills the `avatar-spin-rotate` keyframes that transform resets can't stop
- **GIF hover-play preserved** - The site's own animation mechanism is left fully intact: at rest the avatar shows the static frame drawn on `<canvas>`, and on hover the site itself reveals the animated GIF `<img>` (`display: none` ↔ `block`). The script never touches `canvas`/`img` visibility, `display`, or `opacity` — animated avatars stay "static until hovered" exactly as designed
- **SPA-aware** - Built for the site's Next.js client-side routing: the observer catches hydration, pagination, section switches, and hover-animation class writes
- **No flash** - Injected at `document-start`, so avatars never render blurred for a frame before being restored
- **Menu toggle** - One Tampermonkey menu entry switches the whole script on/off for quick before/after comparison

## 🚀 Getting Started

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new userscript, paste in `2libra-avatar-restore.user.js`, save
3. Open <https://2libra.com/> — all avatars render without effects; GIF avatars animate only while hovered

## 🧩 How it works

The site's avatar component layers effects onto fixed-size containers:

```
根容器（filter: drop-shadow 投影层 / aura 光环类名）
└─ 效果 div（filter: blur+saturate、scale、rotateY、skew，或
   avatar-shrink-hover / avatar-spin-hover / avatar-zoom-hover 类名）
   └─ 定位 div（onMouseEnter / onMouseLeave）
      ├─ canvas   ← 站点画的静止帧，静止时显示
      └─ img      ← GIF 原图，悬停时站点设为 display:block 播放，移开藏回
```

The script injects one stylesheet that, inside any `[class*="[&_img]:block"]` container, resets `filter`/`transform`/`transition`/`will-change`/`backface-visibility`/`perspective` on the root and every inner `div` (all effect layers). Inline styles are beaten by `!important`, so no DOM rewriting is needed for the effect layers; the only JS-side DOM change is dropping the three hover-effect classes (rAF-throttled MutationObserver sweep), with a CSS fallback covering their stylesheet rules.

Visibility is deliberately untouched: the site's React code toggles the GIF `<img>` between `display: none` and `display: block` on hover, so any `display`/`opacity` override would either force GIFs to play constantly or blank the avatar. v1.0.0 did exactly that (hid the canvas, forced the img visible) and was corrected in v1.1.0.

## 🧪 Testing

Two layers of verification:

```bash
# 纯逻辑测试：生成的 CSS、真实 class 样例匹配、悬停播放不被破坏、菜单开关行为
node 2libra-avatar-restore.test.js

# 真实浏览器验证：reproduce.html 复刻了线上样例（模糊/偏移/缩放/旋转/关键帧旋转）
# 并复刻站点的 spin/shrink 样式表规则，加载脚本本体后逐项断言计算样式。
# 任意静态服务器 + 无头浏览器均可：
#   python3 -m http.server 8642
#   chrome --headless --dump-dom --virtual-time-budget=3000 http://127.0.0.1:8642/reproduce.html
```

## ⚠️ Limitations

- Purely visual: avatar images still come from the site's CDN (`r2.2libra.com`)
- Aura glow rings (`avatar_effect: aura-*`) are decorative additions the image itself; they are left as-is — say the word if they should go too
- If the site renames the signature classes (`[&_img]:block`, `avatar-*-hover`), update `SIGNATURE` / `EFFECT_CLASSES` at the top of the script
- The GIF hover-play behavior follows the site's own toggle (pandora 设置里的 auto_play_gif_avatar)：开启自动播放时站点常驻播放，脚本同样不干预
