# 2libra 潘多拉事件全景（线上代码分析 + 社区数据合并）

> 分析时间：2026-11-02 · 站点版本 5.4.9（Next.js App Router，build 2026-10-29）
> 结论先行：**事件池（名称/文案/权重）在服务端，前端代码里没有全量表**；但「线上代码 + 社区统计贴 + 登录态通知接口」三方合并，目前能确认 **23 种事件码**。想拿到真正意义上的「全部」，唯一完备途径是持续采集 `GET /api/notifications/list?page=N&type=pandora`（需登录态），见文末方案。

## 一、线上代码里能挖到什么

站点是 Next.js App Router，所有业务 chunk 公开可下载（`/_next/static/chunks/*.js`，immutable 缓存）。逐个 grep 后：

### 1. API 面（模块 40300，chunk `3824-4e354ec68b7510a6.js`）

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| `getPandoraToday` | `GET /api/pandora/today` | 今日盒子状态：`{ box, can_open, has_box, active_extended }` |
| `openPandoraBox` | `POST /api/pandora/open` | 开盒（覆盖当前事件） |
| `rerollPandoraBox` | `POST /api/pandora/reroll` | 质变（`box_instance_id`），有 `reroll_deadline_at / reroll_used / reroll_limit / force_purple_reroll` |
| `extendPandoraBox` | `POST /api/pandora/extend` | 延期（`box_instance_id`） |

盒子对象字段（客户端渲染逻辑反推）：`box_instance_id / event_code / event_name / event_title / tier_code / rarity / apply_at / expire_at / reroll_*`；通知侧载荷另有 `rolled_value / message`。用户对象内嵌 `pandora_info`：`active / box_status("applied") / event_code / event_title / expire_at / avatar_effect / avatar_skew_angle / comment_constraint{ min_length, custom_emoji_required }`。

### 2. 客户端常量（模块 34605，同 chunk）

```js
PANDORA_EXTEND_EXCLUDED_EVENT_CODES = [
  "coin_gain_flat","coin_lose_flat","coin_gain_reduce_percent","capybara_badge",
  "chaos_badge","hot_and_cold_badge","comment_custom_emoji_required",
  "comment_min_length","reward_pool_never_win","badge_drop_lock",
]                                   // 不可延期的事件（即官方承认的 10 种事件码）
PANDORA_EXTEND_HOURS = 24           // 延期一次 +24h
PANDORA_EXTEND_COST_BY_RARITY = { bronze:100, silver:200, gold:500, purple:800 }
PANDORA_EXTEND_COST_GROWTH_RATE = 1.5
PANDORA_FORCE_PURPLE_DATES = ["2026-08-26"]
BADGE_CHANGE_COOLDOWN_MINUTES = 10  // 徽章切换冷却
COINS_MODIFIER_IMMUNE_REASONS = [ "system","pandora","bet_invalid_penalty", … ]
// ⚠️ 免疫清单不含 post/comment 扣费 → 「金币升降机」会按 ±% 作用在发帖/评论费用上
HOT_AND_COLD_BADGE_CODE = "hot_and_cold"  // 名称「忽冷忽热」
```

### 3. 渲染逻辑给出的效果分类

- `comment_constraint`：`min_length`（多说多写）、`custom_emoji_required`（小表情）
- `avatar_effect`：`gif_animate / skew / transparent / mosaic / shrink / flip / none`（aura 在别处渲染）
- 头像效果可被他人「忽略潘多拉（24 小时）」（`pandora_ignore_users`）

## 二、事件全表（三方合并，23 种）

社区统计来自收集贴 [【💰】潘多拉事件收集贴](https://2libra.com/post/forum-function/nRdljKG)（截至 2026-11-01，共 155 次记录的分布）。

| 事件 | event_code | 已见稀有度 | 值域/均值 | 对本脚本的意义 | 来源 |
| --- | --- | --- | --- | --- | --- |
| 金币雨 | `coin_gain_flat` | 全档 | 50~756 / 212 | 无（一次性收益） | 社区+代码 |
| 金币升降机 | `coin_modifier_percent` | 全档 | -30~+40 / +15 | **评论费用 ×(1±N%)** | 社区+代码 |
| 妙笔生花 | `fixed_text_cost` | 全档 | 1~6 / 4 | **发评费用固定 N，徽章出局** | 社区 |
| 金币池！ | `reward_pool_gain_multiple` | purple | 2~4 倍 | 无 | 社区 |
| 金币回收计划 X | `coin_lose_flat` | 全档 | 101~491 / 168 | 无（一次性支出） | 社区+代码 |
| 回归起点 | `badge_drop_lock` | bronze | — | **徽章掉落锁定，禁止切换** | 社区+代码 |
| 多说多写 | `comment_min_length` | bronze/gold | 10 字 | **gold：评论免费；各档 ≥10 字约束** | 社区+代码 |
| 动起来！ | `avatar_gif_animate` | purple | — | 无 | 社区 |
| 缝缝补补 | `makeup_discount` | silver | 34~54 / 41 | 无（补签折扣） | 社区 |
| 颠倒了！ | `avatar_flip` | gold | — | 无 | 社区 |
| 小表情 | `comment_custom_emoji_required` | bronze | — | **评论须含自定义表情** | 社区+代码 |
| 模模糊糊 | `avatar_mosaic` | gold | — | 无 | 社区 |
| 透明了！ | `avatar_transparent` | gold | — | 无 | 社区 |
| ✨闪闪光环 | `avatar_aura` | purple | — | 无 | 社区 |
| 偏斜 | `avatar_skew` | purple | — | 无（含 `avatar_skew_angle`） | 社区旧表 |
| 缩小灯 | `avatar_shrink` | purple | 60% | 无 | 社区 |
| 无缘金币池 | `reward_pool_never_win` | silver | — | 无 | 社区+代码 |
| 关键输出 | `task_post_two_replies` | bronze/silver | 144~299 / 222 | 无（任务类） | 社区 |
| 招募行动 | `task_invite_register` | bronze | 1396 | 无（任务类） | 社区 |
| 混沌 | `chaos_badge` | purple | — | 赠「混沌」徽章（float_percent 属性） | 社区+代码 |
| 卡皮巴拉 | `capybara_badge` | purple | — | 赠「卡皮巴拉」徽章（capybara_rate 属性） | 社区+代码 |
| 金币收益减免 | `coin_gain_reduce_percent` | ? | — | 只影响收益不影响支出，对本脚本估算无影响 | **仅代码** |
| 忽冷忽热 | `hot_and_cold_badge` | ? | — | 赠「忽冷忽热」徽章（`HOT_AND_COLD_BADGE_CODE`） | **仅代码** |

> `coin_gain_reduce_percent` 与 `hot_and_cold_badge` 只出现在前端常量里，社区贴还没人抽到过（或抽到未上报）——这正是「代码分析补社区空缺」的价值；反过来社区里 15 种事件代码里没有，说明**两边都不完备，合并才有全景**。

## 三、如何持续获取「全部」事件

1. **前端 chunk 巡检（无需登录，分钟级）**：`GET /` 或任一帖子页 → 提取 `/_next/static/chunks/*.js` 清单 → 下载 → grep `PANDORA_EXTEND_EXCLUDED_EVENT_CODES` 与 `event_code` 字符串。站点发版（构建 hash 变化）时重跑。本目录的抓取脚本产物在 `/tmp/2libra-analysis/chunks/`。
2. **通知接口采集（需登录态，唯一完备途径）**：`GET /api/notifications/list?page=N&type=pandora`，Bearer `access_token` cookie。这是 dex（`~/dev/2libra-dex/pandora.json`）现有的数据来源；事件池若更新新事件，抽到的人会出现在这里。
3. **社区统计贴**：收集贴正文含去重表 + 统计表（Next.js flight 数据在帖子 HTML 里，`self.__next_f.push` 可程序化解析，本文的统计表就是这么提取的）。
4. （不推荐）猜测端点：`/api/pandora/events` 之类均为 404，事件池定义不下发客户端。

## 四、与徽章助手的联动（v1.2.0 已实现）

优先级：**潘多拉 > 徽章**。`badge_drop_lock` 锁定时禁用切换并按无徽章计费；`fixed_text_cost` / gold `comment_min_length` 时徽章退出计费；`coin_modifier_percent` 对所有展示金额乘算；`comment_min_length` / `comment_custom_emoji_required` 给出约束提示。事件状态来自 `/api/pandora/today`，标签页重新可见时刷新。
