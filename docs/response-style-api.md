# 回复风格调节接口

本文档给前端说明“降低模板感、增强真实感”的配置入口。前端不要直接暴露或提交 `temperature`、`top_p`、`presence_penalty`、`frequency_penalty` 等模型参数。

## 前端可提交字段

保存角色或体验设置时，在 `agent` 对象里提交：

```json
{
  "responseStyle": "balanced",
  "creativityLevel": 0.6,
  "replyLength": 0.35
}
```

字段含义：

| 字段 | 类型 | 默认值 | 用户可理解名称 |
| --- | --- | --- | --- |
| `responseStyle` | string | `balanced` | 回复方式 |
| `creativityLevel` | number, `0` 到 `1` | `0.6` | 创造性 |
| `replyLength` | number, `0` 到 `1` | `0.35` | 回复长短 |

`responseStyle` 可选值：

| 值 | 展示文案 | 说明 |
| --- | --- | --- |
| `balanced` | 自动平衡 | 系统按场景自动取稳态 |
| `vivid` | 更生动 | 更多调侃、追问和具体情绪反应 |
| `dream` | 梦向画面 | 更擅长进入场景和补画面 |
| `lover` | 撒娇恋人 | 允许轻微吃醋、黏人、逗弄 |
| `reserved` | 克制冷感 | 更短、更稳、更收敛 |
| `story` | 剧情发散 | 更强剧情推进和想象空间 |

## 默认与自定义

前端可以不提交这些字段，后端会使用默认值：

```json
{
  "responseStyle": "balanced",
  "creativityLevel": 0.6,
  "replyLength": 0.35
}
```

如果用户手动调节，前端仍然只提交上面的用户语义字段。TextAgent 会根据本轮上下文、CRAG 证据、安全等级、workflow、最近回复形态和用户偏好动态决策底层采样参数、回复长度和叙事节奏。

底层策略集中在：

```text
src/modelPolicy.js
```

业务代码不直接散落模型采样参数；ContextAgent、ReviewAgent、外貌识别和 TextAgent 都通过 `modelPolicy` 生成模型请求参数。

## 调试返回

`/api/chat` 返回的编排信息里会包含：

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
          "narrativeRhythm": {
            "mode": "dialogue_action_dialogue",
            "label": "对白-动作-对白"
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

`sampling`、`lengthProfile` 和 `narrativeRhythm` 只用于开发调试，不建议在普通用户界面展示。普通用户只需要看到“回复方式”“创造性”和“回复长短”。
