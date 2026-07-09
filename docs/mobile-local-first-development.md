# 手机端本地优先方案

本文档面向开发人员，说明公开客户端在移动端场景下的本地优先方案：用户可以访问同一套 H5/PWA 前端，但角色、人设、聊天记录、图片和长期记忆默认保存在用户自己的设备中；服务端只承担模型、搜索、授权和额度校验等必要中转职责。

## 1. 架构目标

移动端采用本地优先架构：

- 所有用户访问同一个 H5/PWA 页面。
- 角色、人设、聊天记录、背景图、参考图、长期记忆保存在用户手机本地。
- 云端只做临时中转：模型请求、联网搜索、授权/额度校验。
- 云端不落库聊天正文、不落库图片、不落库角色设定、不打印敏感日志。
- 本地 SQLite 适用于单机运行和桌面版；多人公网部署应使用无状态 relay 与独立的授权/额度数据层。

## 2. 运行模式边界

公开客户端支持两类运行模式：

```text
本地单机/桌面模式
  -> local Node API
  -> local SQLite
  -> 用户配置的模型服务
```

```text
移动端公网模式
  -> H5/PWA + IndexedDB
  -> 无状态 relay
  -> 授权/额度服务
  -> 模型供应商或自部署模型服务
```

多人公网部署不应把用户聊天、角色和图片写入同一个服务端 SQLite。服务端只保存授权、额度、审计和必要运行指标，不保存聊天正文、完整 prompt、角色设定或图片原文。

## 3. 推荐目录规划

移动端本地优先能力可以按以下目录组织：

```text
public/
  app.js
  storage.js              # IndexedDB 封装
  mobile.js               # 可选：手机端交互/抽屉逻辑
  pwa/
    manifest.json         # PWA 配置
    service-worker.js     # 静态资源缓存

server.js                 # 本地单机/桌面入口
server-relay.js           # 公网无状态 relay 入口，可独立部署
src/
  orchestrator/           # Agent 编排
  modelPolicy.js          # 模型请求策略抽象
  relay/
    chatRelay.js          # 模型中转
    searchRelay.js        # 联网搜索中转
    quota.js              # 额度/限流
```

不要在公网模式里复用 `CompanionStore` 保存用户聊天状态。

## 4. 前端本地存储设计

使用 IndexedDB。不要把聊天记录、图片、角色设定放进服务端。

推荐库：

- 原生 IndexedDB 可用，但代码较繁琐。
- 推荐使用 `idb` 或自写轻量封装。

数据库名：

```text
companion-local
```

对象仓库：

```text
agents
messages
memories
settings
assets
```

推荐结构：

```js
agent = {
  id,
  name,
  avatar,
  tagline,
  persona,
  appearance,
  voiceStyle,
  relationship,
  openingMessage,
  systemPrompt,
  visualContext,
  prompts,
  boundaries,
  safetyRules,
  referenceImageAssetId,
  chatBackgroundAssetId,
  chatBackgroundOpacity,
  chatBackgroundBlur,
  createdAt,
  updatedAt
}
```

```js
message = {
  id,
  conversationId,
  agentId,
  role, // user | assistant | system
  content,
  metadata,
  createdAt
}
```

```js
asset = {
  id,
  type, // chat_background | reference_image | voice_sample
  mime,
  name,
  blob,
  createdAt
}
```

图片建议用 `Blob` 存 IndexedDB，不建议长期用 base64。base64 会增大体积并拖慢读取。

## 5. 前端启动流程

当前流程：

```text
页面加载 -> GET /api/bootstrap -> 服务端返回角色/消息/记忆
```

公网手机端应改为：

```text
页面加载
  -> 初始化 IndexedDB
  -> 读取 settings.activeAgentId
  -> 读取 agents
  -> 如果没有角色，写入默认角色
  -> 读取当前角色最近 messages
  -> 渲染聊天页面
```

不得在公网手机端依赖 `/api/bootstrap` 返回用户私密数据。

## 6. 发送消息流程

客户端负责保存聊天记录。

流程：

```text
1. 用户输入消息
2. 前端生成 requestId
3. 前端先把 user message 写入 IndexedDB
4. 前端从 IndexedDB 取最近 N 条上下文
5. 前端调用 POST /api/relay/chat
6. 服务端临时转发给大模型
7. 服务端返回 assistant reply
8. 前端把 assistant message 写入 IndexedDB
9. 前端渲染回复
```

请求示例：

```json
{
  "requestId": "req_abc123",
  "conversationId": "conv_agent_mori",
  "agent": {
    "id": "mori",
    "name": "沐里",
    "persona": "...",
    "relationship": "...",
    "systemPrompt": "..."
  },
  "message": "今天有点想你",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "options": {
    "webSearch": false,
    "privacyMode": false
  }
}
```

返回示例：

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "reply": "我在。今天靠近一点也没关系。",
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 88
  }
}
```

## 7. 背景图实现

背景图只存在用户手机，不上传云端。

前端流程：

```text
1. 用户点击“聊天背景”
2. input[type=file] 从手机相册选择图片
3. 前端压缩图片，建议最长边 1600px
4. Blob 写入 IndexedDB assets
5. agent.chatBackgroundAssetId 指向该 asset
6. 渲染聊天区背景
```

CSS 建议：

```css
.chat-panel {
  position: relative;
  background: var(--panel);
}

.chat-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--chat-bg-image);
  background-size: cover;
  background-position: center;
  filter: blur(var(--chat-bg-blur, 0px));
  opacity: var(--chat-bg-opacity, 0.18);
  pointer-events: none;
}

.topbar,
.quick-actions,
.messages,
.composer {
  position: relative;
  z-index: 1;
}
```

渲染时：

```js
const url = URL.createObjectURL(asset.blob);
chatPanel.style.setProperty("--chat-bg-image", `url("${url}")`);
chatPanel.style.setProperty("--chat-bg-opacity", agent.chatBackgroundOpacity ?? 0.18);
chatPanel.style.setProperty("--chat-bg-blur", `${agent.chatBackgroundBlur ?? 0}px`);
```

切换背景时要 `URL.revokeObjectURL(oldUrl)`。

## 8. 手机端布局

手机端不要沿用三栏布局。改为聊天主屏 + 抽屉：

```text
顶部栏
  左侧：角色列表按钮
  中间：当前角色名
  右侧：设置按钮

主体
  消息列表

底部
  输入框 + 发送按钮

抽屉
  左抽屉：角色列表
  右抽屉：角色配置、背景图、联网开关、导入导出
```

关键 CSS：

```css
@media (max-width: 720px) {
  body {
    overflow: hidden;
  }

  .app-shell {
    width: 100vw;
    height: 100dvh;
    margin: 0;
    display: block;
  }

  .chat-panel {
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .messages {
    padding: 14px 12px;
    padding-bottom: 92px;
  }

  .composer {
    position: sticky;
    bottom: 0;
    grid-template-columns: minmax(0, 1fr) 72px;
    padding: 10px;
    background: rgba(255, 253, 250, 0.94);
    backdrop-filter: blur(12px);
  }

  .left-rail,
  .side-panel {
    position: fixed;
    top: 0;
    bottom: 0;
    z-index: 20;
    width: min(86vw, 360px);
    height: 100dvh;
    transition: transform 0.2s ease;
  }
}
```

注意使用 `100dvh`，避免手机浏览器地址栏导致高度计算错误。

## 9. 云端中转服务

公网后端只做无状态中转和必要的账号/额度管理。

推荐接口：

```text
GET  /api/health
POST /api/relay/chat
POST /api/relay/search
POST /api/license/check
POST /api/auth/login
POST /api/auth/logout
```

不要提供这些公网用户数据接口：

```text
GET    /api/bootstrap       # 公网模式不要返回服务端角色/消息
POST   /api/config          # 公网模式不要保存用户角色配置
GET    /api/messages        # 公网模式不要从服务端读聊天
DELETE /api/messages/:id    # 公网模式不要删服务端聊天
POST   /api/messages/clear  # 公网模式不要操作服务端聊天
```

如需兼容本地版，用环境变量分模式：

```text
COMPANION_MODE=local     # 当前 SQLite 单机模式
COMPANION_MODE=relay     # 公网无状态中转模式
```

## 10. 并发处理

### 10.1 页面并发

所有用户共用同一份静态页面没有问题。HTML/CSS/JS 是只读静态资源，可由 CDN 缓存。

### 10.2 用户数据隔离

隔离发生在浏览器：

```text
用户 A 手机 IndexedDB != 用户 B 手机 IndexedDB
```

只要云端不保存用户状态，就不会因为多人共用页面而串号。

### 10.3 同一用户连发消息

客户端处理：

- 每条消息带 `requestId`
- 发送中禁用按钮，或建立本地队列
- 同一个 `conversationId` 内按顺序追加回复
- 如果请求失败，消息标记为 `failed`，允许重试

### 10.4 多用户同时请求

服务端处理：

- 中转服务保持无状态
- 每个请求独立转发给模型
- 使用 Redis 做 IP/账号/设备级限流
- Node.js 服务可多实例横向扩容
- 不使用全局 `active_agent_id`

### 10.5 额度扣减并发

额度必须在服务端保存，但只保存额度数据，不保存聊天正文。

推荐使用 Redis 原子操作或数据库事务：

```text
quota:{userId}:{date}
```

扣减逻辑：

```text
1. 校验用户 token/license
2. Redis INCR 使用次数
3. 超出额度则拒绝请求
4. 未超出则继续调用模型
```

如果要按成功请求扣费，可以先预占额度，请求失败后回滚或补偿。

## 11. 日志与隐私要求

中转服务禁止记录：

- 用户消息正文
- 完整 prompt
- 角色人设
- 图片 base64/Blob
- 聊天历史
- 搜索原文的长期日志

可以记录：

- requestId
- userId 或匿名 deviceId 的哈希
- 时间
- 接口名
- 状态码
- 耗时
- token 用量
- 错误类型

示例：

```js
console.info("[relay.chat]", {
  requestId,
  userHash,
  status: "ok",
  elapsedMs,
  inputTokens,
  outputTokens
});
```

不要：

```js
console.log(body);
console.log(messages);
console.log(prompt);
```

## 12. 开发步骤

第一阶段：最小公网手机版

1. 新增 `public/storage.js`，实现 IndexedDB 的 agents/messages/assets/settings。
2. 改造 `public/app.js`，启动时从本地 IndexedDB 读取数据。
3. 新增默认角色初始化逻辑。
4. 改造聊天发送逻辑，调用 `/api/relay/chat`，回复后写入 IndexedDB。
5. 新增聊天背景图本地上传、压缩、保存、渲染。
6. 改造手机端 CSS：聊天主屏、左右抽屉、底部输入框。
7. 新增 `server-relay.js` 或 `COMPANION_MODE=relay`。
8. 确保 relay 模式不使用 `CompanionStore` 保存用户私密数据。

第二阶段：体验补齐

1. PWA manifest 和 service worker。
2. 用户手动导出/导入备份包。
3. 隐私模式：不发送长期记忆，不发送多轮历史。
4. 联网搜索开关。
5. 背景图暗度、模糊度、恢复默认。

第三阶段：商业化与稳定性

1. 登录/授权码。
2. Redis 限流和额度。
3. 多实例部署。
4. 基础风控。
5. 异常监控，但不采集正文。

## 13. 验收标准

公网手机端验收：

- 两台手机同时打开同一个网址，角色和聊天记录互不影响。
- 刷新页面后，本机聊天记录仍在。
- 关闭浏览器再打开，本机背景图仍在。
- 服务端数据库里没有聊天正文、背景图、参考图、人设。
- 服务端日志里没有用户消息正文和 prompt。
- 连续快速点击发送不会乱序或重复扣额度。
- 100 个用户同时请求时，不出现共享 `active_agent_id` 或串聊天。
- 手机浏览器地址栏收起/展开时，输入框不被遮挡。

## 14. 一句话实现原则

公网版本不是“把当前 server.js 放到云上”，而是“静态页面共享，本地 IndexedDB 保存用户数据，云端 relay 只处理一次性请求”。
