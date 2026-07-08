# 换一句/重新生成技术开发文档

本文档只描述“换一句/重新生成上一条 AI 回复”的实现方案，不包含新开对话、分支剧情、多会话管理。

## 1. 功能目标

用户对 AI 刚生成的回复不满意时，可以点击“换一句”，让系统基于同一条用户消息重新生成一条新的 AI 回复。

目标效果：

- 用户不需要重新输入上一句话。
- 旧 AI 回复被新 AI 回复替换。
- 旧 AI 回复不再展示在正常聊天流里。
- 旧 AI 回复不参与下一轮上下文。
- 旧 AI 回复不进入长期记忆。
- 云端只临时生成新回复，不保存聊天正文和版本关系。

## 2. 用户入口

在最后一条 AI 回复气泡下方增加操作按钮：

```text
换一句
```

P0 只支持最后一条 AI 回复“换一句”。不要一开始支持任意历史消息重新生成，避免上下文和消息链复杂化。

按钮展示规则：

- 只在最后一条 `active assistant` 消息上展示。
- 正在发送消息时隐藏或禁用。
- 正在重新生成时禁用。
- 系统消息、用户消息不展示。

## 3. 数据模型

当前本地优先版本建议在 IndexedDB 的 `messages` 记录里增加这些字段。

```js
message = {
  id,
  conversationId,
  agentId,
  role, // user | assistant | system
  content,
  status, // active | replaced | deleted | failed
  parentId,
  variantGroupId,
  variantIndex,
  replacedBy,
  metadata,
  createdAt,
  updatedAt
}
```

字段说明：

- `status=active`：当前展示、参与上下文、可进入记忆。
- `status=replaced`：被“换一句”替换掉的旧 AI 回复。
- `status=failed`：生成失败的临时消息，默认不展示到正式上下文。
- `parentId`：AI 回复对应的上一条用户消息 ID。
- `variantGroupId`：同一条用户消息下的回复版本组。
- `variantIndex`：同一组里的版本序号，从 0 开始。
- `replacedBy`：旧回复被替换后，指向新回复 ID。

如果当前项目暂时还没有 `conversationId`，可以先用当前角色 ID 作为临时会话 ID：

```js
conversationId = `default:${agentId}`;
```

## 4. 正常发送消息时的写入规则

用户发送消息后：

```js
userMessage = {
  role: "user",
  status: "active",
  content: userInput
}
```

AI 回复成功后：

```js
assistantMessage = {
  role: "assistant",
  status: "active",
  content: reply,
  parentId: userMessage.id,
  variantGroupId: `variant:${userMessage.id}`,
  variantIndex: 0
}
```

这样后续“换一句”可以准确知道：要重新生成的是哪一条用户消息对应的 AI 回复。

## 5. 换一句流程

前端流程：

```text
1. 找到当前最后一条 active assistant 消息 oldAssistant。
2. 读取 oldAssistant.parentId 对应的 userMessage。
3. 构造上下文 history，只包含 oldAssistant 之前的 active 消息。
4. history 中必须排除 oldAssistant。
5. 调用 POST /api/relay/chat，传入 options.regenerate=true。
6. 请求成功后，把 oldAssistant.status 改为 replaced。
7. 写入新的 assistant 消息 newAssistant。
8. oldAssistant.replacedBy = newAssistant.id。
9. 重新渲染聊天流，只展示 active 消息。
```

关键点：

重新生成时，不要先删除旧回复。请求失败时用户还应该看到旧回复。

推荐事务顺序：

```text
请求中：只在 UI 上显示“重新生成中”
请求成功：旧回复 -> replaced，新回复 -> active
请求失败：旧回复保持 active
```

## 6. 上下文构造规则

重新生成时，模型输入应包含：

- 当前角色设定
- 当前用户消息之前的 active 历史消息
- 当前用户消息

模型输入不应包含：

- 被替换的旧 AI 回复
- status=replaced 的任何消息
- status=deleted 的任何消息
- status=failed 的任何消息

示例：

当前聊天流：

```text
user: 我今天有点想你
assistant: 我在，靠近一点也没关系。
user: 你会一直陪我吗
assistant: 当然，我永远不会离开你
```

用户对最后一句点“换一句”。

重新生成请求里的上下文应该是：

```text
user: 我今天有点想你
assistant: 我在，靠近一点也没关系。
user: 你会一直陪我吗
```

不能包含：

```text
assistant: 当然，我永远不会离开你
```

## 7. 中转接口

公网手机版调用云端无状态接口：

```text
POST /api/relay/chat
```

请求示例：

```json
{
  "requestId": "req_regen_001",
  "conversationId": "default:mori",
  "agent": {
    "id": "mori",
    "name": "沐里",
    "persona": "...",
    "relationship": "...",
    "systemPrompt": "..."
  },
  "message": "你会一直陪我吗",
  "history": [
    { "role": "user", "content": "我今天有点想你" },
    { "role": "assistant", "content": "我在，靠近一点也没关系。" }
  ],
  "options": {
    "regenerate": true,
    "webSearch": false,
    "privacyMode": false
  }
}
```

返回示例：

```json
{
  "ok": true,
  "requestId": "req_regen_001",
  "reply": "我会在这段对话里认真陪着你。先别想太远，现在我就在。",
  "usage": {
    "inputTokens": 908,
    "outputTokens": 56
  }
}
```

云端不保存：

- 消息正文
- history
- agent 人设
- variantGroupId
- oldAssistant
- newAssistant

这些版本关系只保存在用户手机本地。

## 8. 前端伪代码

```js
async function regenerateLastAssistant() {
  const oldAssistant = await storage.getLastActiveAssistant(activeConversationId);
  if (!oldAssistant) return;

  const userMessage = await storage.getMessage(oldAssistant.parentId);
  if (!userMessage || userMessage.role !== "user") return;

  setRegenerating(oldAssistant.id, true);

  try {
    const history = await storage.getActiveMessagesBefore({
      conversationId: activeConversationId,
      beforeMessageId: oldAssistant.id,
      limit: 20
    });

    const response = await api("/api/relay/chat", {
      method: "POST",
      body: JSON.stringify({
        requestId: createRequestId(),
        conversationId: activeConversationId,
        agent: buildAgentPayload(activeAgent),
        message: userMessage.content,
        history: history
          .filter((message) => message.id !== oldAssistant.id)
          .map(({ role, content }) => ({ role, content })),
        options: {
          regenerate: true,
          webSearch: false,
          privacyMode: false
        }
      })
    });

    await storage.replaceAssistantMessage({
      oldMessageId: oldAssistant.id,
      newMessage: {
        conversationId: oldAssistant.conversationId,
        agentId: oldAssistant.agentId,
        role: "assistant",
        content: response.reply,
        status: "active",
        parentId: oldAssistant.parentId,
        variantGroupId: oldAssistant.variantGroupId || `variant:${oldAssistant.parentId}`,
        variantIndex: Number(oldAssistant.variantIndex || 0) + 1,
        metadata: {
          regeneratedFrom: oldAssistant.id,
          usage: response.usage || null
        }
      }
    });

    await renderConversation();
  } catch (error) {
    showSystemToast(`重新生成失败：${error.message}`);
  } finally {
    setRegenerating(oldAssistant.id, false);
  }
}
```

`replaceAssistantMessage` 必须保证旧消息和新消息的状态更新是一个原子流程：

```js
async function replaceAssistantMessage({ oldMessageId, newMessage }) {
  const oldMessage = await getMessage(oldMessageId);
  const savedNewMessage = await addMessage(newMessage);

  await updateMessage(oldMessageId, {
    status: "replaced",
    replacedBy: savedNewMessage.id,
    updatedAt: new Date().toISOString()
  });

  return savedNewMessage;
}
```

如果使用原生 IndexedDB，建议把 `addMessage` 和 `updateMessage` 放在同一个 `readwrite` transaction 里。

## 9. UI 状态

重新生成中：

```text
旧回复仍展示
按钮文案变为：正在换...
按钮 disabled
输入框 disabled 或发送按钮 disabled
```

成功后：

```text
旧回复消失
新回复出现
按钮恢复为：换一句
```

失败后：

```text
旧回复保留
提示：重新生成失败，请稍后再试
按钮恢复可点击
```

## 10. 防重复与乱序

P0 简化规则：

- 重新生成过程中禁止再次点击“换一句”。
- 重新生成过程中禁止发送新消息。
- 同一时间一个 conversation 只允许一个 pending 请求。

如果需要更稳，可以记录：

```js
pendingRequest = {
  type: "regenerate",
  messageId: oldAssistant.id,
  requestId,
  startedAt
}
```

接口返回后检查：

```js
if (response.requestId !== pendingRequest.requestId) {
  return; // 丢弃过期响应
}
```

## 11. 长期记忆规则

提取长期记忆时必须过滤：

```js
message.status === "active"
```

禁止进入记忆：

- `replaced`
- `deleted`
- `failed`

如果当前项目已有自动总结/记忆提取逻辑，所有查询消息的地方都要加这个过滤条件。

## 12. 与当前服务端 SQLite 版本的兼容

如果当前仍运行本地单机版 `server.js + companion.sqlite`，也要遵循同样规则：

- `messages` 表增加 `status`
- 增加 `parent_id`
- 增加 `variant_group_id`
- 增加 `variant_index`
- 增加 `replaced_by`
- `/api/chat` 支持 `regenerate=true`
- 获取历史消息时过滤 `status='active'`
- 记忆提取时过滤 `status='active'`

但公网手机版推荐把这些状态存在手机 IndexedDB，服务端不保存。

## 13. 验收标准

必须满足：

- 最后一条 AI 回复显示“换一句”。
- 点击后可以生成一条新 AI 回复。
- 旧回复不再出现在正常聊天流。
- 刷新页面后仍显示新回复，不显示旧回复。
- 下一轮对话上下文不包含旧回复。
- 长期记忆不包含旧回复。
- 网络失败时旧回复不丢失。
- 连续快速点击不会生成多条 active AI 回复。
- 重新生成中不能同时发送新消息。
- 云端日志不记录旧回复、新回复、history、agent prompt。

## 14. 开发顺序

推荐顺序：

1. 给本地 `messages` 增加 `status/parentId/variantGroupId/variantIndex/replacedBy`。
2. 正常发送消息时写入 `parentId` 和 `variantGroupId`。
3. 聊天渲染只展示 `status=active` 消息。
4. 上下文构造只读取 `status=active` 消息。
5. 实现最后一条 AI 回复“换一句”按钮。
6. 实现重新生成请求和成功替换。
7. 实现失败恢复、防重复点击、禁用输入。
8. 检查记忆提取逻辑，过滤非 active 消息。

## 15. 一句话原则

“换一句”不是简单删除重发，而是同一条用户消息下的 AI 回复版本替换；旧版本必须保留为 `replaced`，但不能展示、不能进上下文、不能进记忆。
