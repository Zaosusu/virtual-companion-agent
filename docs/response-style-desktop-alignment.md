# 电脑端对齐回复方式、创造性与回复长短

这份文档给电脑端同步手机端已验证的“回复方式 / 创造性 / 回复长短”配置。电脑端需要和手机端使用同一套角色字段、同一套默认值、同一套请求体语义。

## 必须支持的字段

每个角色新增或补齐：

```js
responseStyle: "balanced",
creativityLevel: 0.6,
replyLength: 0.35
```

含义：

- `responseStyle`：回复方式
- `creativityLevel`：创造性
- `replyLength`：回复长短

客户端只提交这些语义字段，不要在用户配置或 `/api/chat` 请求里提交底层模型参数：

```js
temperature
top_p
presence_penalty
frequency_penalty
```

底层采样策略由后端 TextAgent 动态决定，策略入口集中在：

```text
src/modelPolicy.js
```

不要在电脑端、`server.js` 或各 Agent 业务文件中散落写死底层模型参数。

## responseStyle 枚举

| 值 | 展示文案 | 含义 |
| --- | --- | --- |
| `balanced` | 自动平衡 | 系统按场景自动取稳 |
| `vivid` | 更生动 | 更多调侃、追问和具体情绪反应 |
| `dream` | 梦向画面 | 更擅长进入场景和补画面 |
| `lover` | 撒娇恋人 | 允许轻微吃醋、黏人、逗弄 |
| `reserved` | 克制冷感 | 更短、更稳、更收敛 |
| `story` | 剧情发散 | 更强剧情推进和想象空间 |

非法值统一归一化为：

```js
"balanced"
```

## creativityLevel

类型：`number`

范围：

```js
0 <= creativityLevel <= 1
```

默认：

```js
0.6
```

UI 建议：

```text
创造性：range 0 - 1 step 0.05
显示为百分比，例如 60%
```

非法值统一 clamp 到 `0 - 1`。

## UI 对齐

建议放在角色配置的“体验设置”区域：

```html
回复方式：select
创造性：range 0 - 1 step 0.05
回复长短：range 0 - 1 step 0.05
```

要求：

- 默认显示 `自动平衡 / 60% / 35%`
- 滑块必须是真正可拖动的长滑轨
- 调整后自动保存角色配置
- 可以保留保存按钮，但不要要求用户必须手动保存才生效
- 普通用户界面不要展示后端 `sampling` 调试细节

## 存储迁移

如果电脑端使用 SQLite，建议新增：

```sql
response_style TEXT NOT NULL DEFAULT 'balanced'
creativity_level REAL NOT NULL DEFAULT 0.6
reply_length REAL NOT NULL DEFAULT 0.35
```

读取和保存时做归一化：

```js
function normalizeResponseStyle(value) {
  return ["balanced", "vivid", "dream", "lover", "reserved", "story"].includes(value)
    ? value
    : "balanced";
}

function normalizeCreativityLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.6;
  return Math.min(1, Math.max(0, number));
}

function normalizeReplyLength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.35;
  return Math.min(1, Math.max(0, number));
}
```

## 保存与聊天链路

电脑端应先通过角色配置保存这些字段。当前本地客户端的 `/api/chat` 会由后端读取 active agent，不要求每次聊天请求都携带完整 agent。

保存角色或体验设置时，`agent` 里需要包含：

```js
{
  id,
  responseStyle,
  creativityLevel,
  replyLength
}
```

不要包含：

```js
{
  temperature,
  top_p,
  presence_penalty,
  frequency_penalty
}
```

## 后端调试返回

后端可能返回：

```json
{
  "orchestration": {
    "agents": {
      "text_agent": {
        "responseProfile": {
          "style": "dream",
          "creativityLevel": 0.9,
          "replyLength": 0.35,
          "strategy": {
            "label": "梦向剧情"
          },
          "lengthProfile": {
            "label": "偏短",
            "target": "2-4 句"
          },
          "sampling": {
            "reason": "agent_dynamic_response_profile"
          }
        }
      }
    }
  }
}
```

电脑端可以在开发调试面板里看，不建议给普通用户展示。

## 手机端已验证结果

手机端已经验证：

- 6 个 `responseStyle` 枚举都能进入官方网关 `/api/chat`
- 本地电脑端应先保存到 active agent，再由 `/api/chat` 读取当前角色配置
- `creativityLevel` 测试值：`0 / 0.2 / 0.4 / 0.6 / 0.8 / 1`
- `replyLength` 测试值：`0 / 0.2 / 0.35 / 0.6 / 0.9 / 1`
- 非法值归一化：`bad-style + 9 + -1` -> `balanced + 1 + 0`
- UI 真实操作 `story / 0.85 / 0.35` 后：
  - 页面显示 `85%`
  - 自动保存状态为 `已保存`
  - 刷新页面后仍保持 `story / 0.85 / 0.35`
  - 发消息时后端 active agent 使用 `responseStyle: "story"`、`creativityLevel: 0.85`、`replyLength: 0.35`
- 请求体确认没有：
  - `temperature`
  - `top_p`
  - `presence_penalty`
  - `frequency_penalty`

## 电脑端测试清单

1. 老角色无字段时显示 `自动平衡 / 60% / 35%`
2. 新建角色默认保存 `balanced / 0.6 / 0.35`
3. 6 个回复方式都能保存并重新加载
4. 创造性和回复长短滑块能真实拖动
5. 滑块值自动保存，重启电脑端后仍保留
6. 发消息前 active agent 已保存 `responseStyle`、`creativityLevel` 和 `replyLength`
7. 发消息时请求体或角色配置都不包含 `temperature / top_p / presence_penalty / frequency_penalty`
8. 非法旧数据能归一化，不导致角色配置页崩溃
9. 导入手机端备份数据后，电脑端能识别这些字段
10. 电脑端导出的角色数据，手机端也能识别这些字段

## 多端兼容约定

- 字段名固定：`responseStyle`、`creativityLevel`、`replyLength`
- 枚举值固定为英文小写
- 默认值固定：`balanced / 0.6 / 0.35`
- 备份、导入、导出不能丢弃这些字段
- 云备份恢复后，电脑端和手机端都应能识别
