# 技术架构与 Agent 编排

本文档是当前项目的技术架构说明，覆盖客户端、授权后端、模型通道、Agent 编排、数据存储、接口链路、测试与后续演进。

当前系统由两个主要运行系统组成：

```text
open-source-client  客户端 / 本地 Agent 运行时
license-backend     私有授权后端 / 模型中转网关
```

## 1. 总体架构

```text
用户
  -> Browser / Electron UI
    -> open-source-client 本地 Node API
      -> Agent Orchestrator
        -> routerAgent
        -> textAgent
        -> imageAgent
        -> voiceAgent
        -> memoryAgent
        -> safetyAgent
      -> 本地 SQLite
      -> 图片 / 语音工具
      -> 模型通道选择
        -> 官方授权后端 license-backend
          -> StepFun API
        -> 自部署 OpenAI-compatible / StepFun API
```

一句话分工：

```text
客户端负责体验、角色、记忆和 Agent 编排。
授权后端负责账号、授权码、额度、API Key 隔离和 StepFun 中转。
```

## 2. 仓库边界

### open-source-client

开源客户端。包含：

- 浏览器前端和 Electron 桌面壳。
- 本地 Node API 服务。
- 本地 SQLite 数据库。
- 角色配置、记忆、RAG、Agent 编排。
- 图片生成、语音合成、声音克隆等工具调用入口。
- 自部署模型配置入口。

关键路径：

```text
server.js                         本地 API 入口
public/app.js                     前端主逻辑
src/orchestrator/                 Agent 编排层
src/agent.js                      文本 Agent 核心陪伴逻辑
src/db.js                         SQLite 数据与记忆层
src/config.js                     模型模式与配置解析
src/tools/imageGeneration.js      图片工具
src/tools/speechSynthesis.js      语音工具
docs/architecture.md              本文档
```

### license-backend

私有授权后端。不要开源。包含：

- 账号注册、登录、重置密码。
- 授权码生成、绑定、禁用、恢复。
- 用户免费额度和授权码月额度统计。
- StepFun Chat / Image / TTS / Voice Clone 中转。
- 管理后台。

关键路径：

```text
license-server.js                 授权服务与管理后台
license-admin.js                  授权码 CLI 管理
data/licenses.json                当前 MVP 授权数据
data/backups/                     授权数据自动备份
```

### marketing-posters / output

物料和生成产物目录，不参与运行时架构。

## 3. 运行模式

客户端按优先级选择模型通道：

```text
官方账号 token / 授权码绑定 > 自部署 API Key > 免费体验模式
```

### 官方授权模式

普通用户默认走这个模式。

```text
客户端本地 /api/chat
  -> license-backend /api/chat
    -> StepFun /chat/completions
```

特点：

- 用户不用接触模型 API Key。
- 客户端只保存官方用户 token 或授权绑定状态。
- StepFun API Key 只存在授权后端。
- 文字、图片、语音、声音克隆统一计入授权额度。

### 自部署模式

给专业玩家保留。

启用方式：

```env
COMPANION_SELF_HOSTED=1
```

启用后，用户可配置：

```text
Base URL
Model
API Key
Image Base URL / Image Model / Image API Key
Audio Base URL / Audio Model / Audio API Key
```

特点：

- 用户自行承担模型费用。
- 客户端本地后端直接调用用户配置的 OpenAI-compatible 或 StepFun API。
- 不经过官方授权后端。

### 免费体验模式

未配置官方授权或自部署 API Key 时进入。

当前设计上分两类：

- 登录后的新用户免费额度：由授权后端按用户 token 统计。
- 公共免费体验：由 `COMPANION_PUBLIC_FREE_ACCESS=1` 控制，默认不建议生产开放。

## 4. 客户端内部架构

```text
public/app.js
  -> server.js
    -> src/orchestrator/index.js
      -> textAgent
      -> routerAgent
      -> imageAgent
      -> voiceAgent
      -> memoryAgent
      -> safetyAgent
    -> src/db.js
    -> src/tools/*
    -> license-backend 或 self-hosted provider
```

### 前端层

文件：

```text
public/app.js
public/index.html
public/styles.css
```

职责：

- 渲染聊天消息、角色列表、配置表单、记忆面板。
- 上传参考图、声音样本、人物语料。
- 调用本地 API。
- 消费后端返回的 `orchestration.outputs`。
- 根据后端计划触发 `/api/image` 和 `/api/tts`。

前端不再负责：

- 判断本轮应该输出文字、图片还是语音。
- 构造核心图片 prompt。
- 决定语音情绪演绎。

这些已经收回到后端 `src/orchestrator/`。

### 本地 API 层

文件：

```text
server.js
```

当前仍是单体入口，职责包括：

- HTTP 路由。
- 静态文件服务。
- 角色、配置、消息 API。
- 聊天回合处理。
- 图片、语音、声音克隆工具 API。
- 官方授权后端代理。
- 自部署模型调用。

后续拆分目标：

```text
routes/       HTTP 路由与参数校验
services/     chat、memory、agent、auth、media 服务
gateways/     official license、StepFun、OpenAI-compatible provider
policies/     quota、safety、rate limit
```

## 5. Agent 编排

后端统一编排入口：

```text
src/orchestrator/index.js
```

核心函数：

```js
orchestrateCompanionTurn()
```

输入：

```text
agent
character
memory
retrievedMemories
message
history
llm
modelConfig
```

输出：

```text
reply
orchestration
  version
  router
  agents
  outputs
```

### Agent 分工

| Agent | 文件 | 职责 |
| --- | --- | --- |
| routerAgent | `src/orchestrator/routerAgent.js` | 判断本轮输出 text / image / voice |
| textAgent | `src/orchestrator/textAgent.js` | 调用 `src/agent.js` 生成文本回复 |
| imageAgent | `src/orchestrator/imageAgent.js` | 根据文本 Agent 结果生成图片工具计划 |
| voiceAgent | `src/orchestrator/voiceAgent.js` | 生成语音工具计划和情绪演绎指令 |
| memoryAgent | `src/orchestrator/memoryAgent.js` | 规划记忆候选、摘要、安全提示写入 |
| safetyAgent | `src/orchestrator/safetyAgent.js` | 安全风险识别边界 |

### 输出计划示例

```json
{
  "version": "orchestrator-v1",
  "router": {
    "agent": "router_agent",
    "outputs": ["text", "image", "voice"]
  },
  "outputs": [
    {
      "type": "text",
      "agent": "text_agent",
      "text": "我在。"
    },
    {
      "type": "image",
      "agent": "image_agent",
      "prompt": "生成一张虚拟角色图片..."
    },
    {
      "type": "voice",
      "agent": "voice_agent",
      "text": "我在。",
      "context": {}
    }
  ]
}
```

## 6. 聊天链路

### 后端链路

```text
POST /api/chat
  1. 读取 message
  2. 解析当前 agent / character / modelConfig
  3. prepareChatAccess() 校验访问模式和免费额度
  4. 写入 user message
  5. retrieveMemories() 召回长期记忆
  6. orchestrateCompanionTurn()
     - textAgent 生成回复
     - routerAgent 判断输出形态
     - imageAgent / voiceAgent 生成工具计划
  7. finalizeChatTurn()
     - 写入 assistant 文本消息
     - 写入记忆候选
     - 写入 turn summary
     - 必要时写入 safety_note
     - 必要时压缩旧消息
  8. 返回 reply / orchestration / memory / quota
```

### 前端链路

```text
sendMessage()
  -> POST /api/chat
  -> render RAG / memory
  -> runFrontAgents()
     -> 渲染 text output
     -> 按 image output 调用 /api/image
     -> 按 voice output 调用 /api/tts
  -> renderAssistantOutputs()
```

## 7. 图片链路

```text
orchestration.outputs[type=image]
  -> 前端调用 POST /api/image
    -> server.js 判断官方模式或自部署模式
      -> 官方模式：license-backend /api/image
      -> 自部署模式：src/tools/imageGeneration.js
        -> /images/generations
        -> /images/edits
```

参考图存在时：

```text
character.runtime_config.referenceImage
  -> step-image-edit-2
  -> /images/edits
```

图片消息会以 assistant message 写入本地 SQLite，metadata 中保存：

```text
type=image
imageUrl
b64Json
prompt
seed
finishReason
referenceMode
imageEndpoint
```

## 8. 语音链路

```text
orchestration.outputs[type=voice]
  -> 前端调用 POST /api/tts
    -> voiceAgent 生成情绪演绎指令
    -> audioConfigFromModel()
    -> 官方模式：license-backend /api/tts
    -> 自部署模式：src/tools/speechSynthesis.js
      -> /audio/speech
```

声音优先级：

```text
agent.clonedVoiceId > agent voice preset > modelConfig.audioVoice
```

语音消息会以 assistant message 写入本地 SQLite，metadata 中保存：

```text
type=voice
audio
transcript
voiceAgent
```

## 9. 记忆与 RAG

本地数据层：

```text
src/db.js
src/rag.js
```

SQLite 表：

| 表 | 作用 |
| --- | --- |
| `meta` | schema version、活跃角色等元信息 |
| `profile` | 用户资料，例如名字、语言、时区 |
| `model_config` | 模型与授权配置 |
| `agents` | 多角色配置 |
| `messages` | 聊天消息 |
| `memories` | 长期记忆、人物语料、摘要、安全提示 |
| `memory_chunks` | 记忆切片和哈希 embedding |
| `memory_chunks_fts` | FTS5 全文检索 |

RAG 检索策略：

```text
FTS5 keyword score
+ hash embedding cosine similarity
+ importance
+ confidence
+ recency
```

当前实现是轻量本地 RAG，适合 MVP。后续如果要支持大语料、跨设备同步、多人共享角色，可以升级为：

- SQLite vector extension。
- 服务端向量库。
- Postgres + pgvector。

## 10. 授权后端架构

当前授权后端入口：

```text
license-backend/license-server.js
```

当前数据存储：

```text
license-backend/data/licenses.json
```

当前功能：

- 邮箱验证码。
- 注册、登录、重置密码。
- 用户 token。
- 授权码生成。
- 授权码绑定用户。
- 授权码禁用 / 恢复。
- 免费额度。
- 月额度。
- StepFun Chat / Image / TTS / Voice Clone 中转。
- 管理后台。
- 基础安全防护：强管理员 token、CORS 白名单、请求体大小限制、内存限流。

### 授权链路

```text
客户端保存 officialUserToken
  -> Authorization: Bearer vc_user_xxx
    -> license-backend 查找用户
      -> 如果绑定授权码，使用授权码额度
      -> 如果未绑定授权码，使用新用户免费额度
        -> 校验通过后调用 StepFun
        -> 成功后 recordUsage()
```

默认不允许直接用 `vc_live_xxx` 授权码调用模型接口。兼容旧模式时才开启：

```env
LICENSE_ALLOW_DIRECT_KEYS=1
```

### 生产升级建议

授权后端已经具备第一层上线前防护：

- `LICENSE_ADMIN_TOKEN` 必须至少 24 位，不能留空，不能使用 `dev-admin` 或示例值。
- 管理员 token 使用常量时间比较。
- `LICENSE_CORS_ORIGINS` 控制允许访问授权网关的前端来源。
- `LICENSE_REQUEST_BODY_LIMIT_BYTES` 限制请求体大小，默认 2MB。
- `LICENSE_RATE_LIMIT_*` 提供内存级基础限流。
- `/api/health` 不再暴露 StepFun baseUrl，只返回安全配置状态。
- `LICENSE_ALLOW_DIRECT_KEYS` 默认保持 `0`，不允许直接用 `vc_live_xxx` 调模型接口。

这些防护适合本地开发、小范围内测和初期部署，但还不是完整生产安全体系。JSON 文件仍只适合 MVP，不适合生产并发。建议升级为 SQLite 或 Postgres。

建议表结构：

| 表 | 作用 |
| --- | --- |
| `users` | 账号、密码 hash、token hash、状态 |
| `licenses` | 授权码 hash、套餐、额度、过期时间、状态 |
| `license_bindings` | 用户与授权码绑定关系 |
| `usage_events` | 每次成功中转的审计与计费事件 |
| `rate_limits` | IP / 用户 / 授权身份限流 |
| `admin_audit_logs` | 管理后台操作审计 |

生产加固优先级：

1. 用数据库事务记录用量，避免并发超额。
2. 将内存限流升级为 Redis / 数据库限流，支持多实例部署。
3. 管理后台从单 token 升级为登录会话。
4. 增加审计日志。
5. SMTP、StepFun API Key、管理员密钥全部只放服务端环境。

## 11. 配置项

### 客户端

文件：

```text
open-source-client/.env
```

常用配置：

```env
PORT=5177
COMPANION_HOST=127.0.0.1
COMPANION_OFFICIAL_BASE_URL=http://localhost:8787
COMPANION_OFFICIAL_MODEL=step-3.7-flash
COMPANION_FREE_DAILY_CHAT_LIMIT=10
COMPANION_COMPRESSION_WINDOW=100
COMPANION_SELF_HOSTED=0
COMPANION_PUBLIC_FREE_ACCESS=0
```

自部署模式：

```env
COMPANION_SELF_HOSTED=1
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_MODEL=step-3.7-flash
STEP_API_KEY=your-api-key
STEPFUN_IMAGE_MODEL=step-image-edit-2
STEPFUN_AUDIO_MODEL=stepaudio-2.5-tts
```

### 授权后端

文件：

```text
license-backend/.env
```

常用配置：

```env
LICENSE_PORT=8787
LICENSE_ADMIN_TOKEN=replace-with-a-long-random-secret
LICENSE_CORS_ORIGINS=http://localhost:5177,http://127.0.0.1:5177
LICENSE_REQUEST_BODY_LIMIT_BYTES=2097152
LICENSE_RATE_LIMIT_WINDOW_MS=60000
LICENSE_RATE_LIMIT_AUTH_MAX=12
LICENSE_RATE_LIMIT_API_MAX=60
LICENSE_RATE_LIMIT_ADMIN_MAX=30
LICENSE_RATE_LIMIT_GENERAL_MAX=120
LICENSE_DEFAULT_MONTHLY_LIMIT=3000
LICENSE_FREE_USER_TRIAL_LIMIT=10
LICENSE_ALLOW_DIRECT_KEYS=0
LICENSE_DB_PATH=./data/licenses.json
STEP_API_KEY=your-stepfun-api-key
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_MODEL=step-3.7-flash
STEPFUN_IMAGE_MODEL=step-image-edit-2
STEPFUN_AUDIO_MODEL=stepaudio-2.5-tts
```

## 12. API 分层

### 客户端本地 API

| API | 作用 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/bootstrap` | 初始化前端状态 |
| `POST /api/chat` | 主聊天入口 |
| `POST /api/image` | 图片工具调用 |
| `POST /api/tts` | 语音工具调用 |
| `POST /api/voice/clone` | 声音克隆 |
| `GET /api/agents` | 角色列表 |
| `POST /api/agents` | 新建/保存角色 |
| `POST /api/persona-corpus/import` | 导入人物语料 |
| `GET /api/memories/search` | 记忆搜索 |
| `POST /api/memory/reset` | 清空本地记忆 |

### 授权后端 API

| API | 作用 |
| --- | --- |
| `POST /api/auth/send-code` | 发送验证码 |
| `POST /api/auth/register` | 注册 |
| `POST /api/auth/login` | 登录 |
| `POST /api/auth/reset-password` | 重置密码 |
| `GET /api/auth/me` | 当前用户 |
| `POST /api/auth/bind-license` | 绑定授权码 |
| `POST /api/chat` | Chat 中转 |
| `POST /api/image` | Image 中转 |
| `POST /api/tts` | TTS 中转 |
| `POST /api/voice/clone` | 声音克隆中转 |
| `GET /api/admin/licenses` | 管理后台列表 |
| `POST /api/admin/licenses` | 生成授权码 |

## 13. 安全边界

必须遵守：

- 浏览器前端不保存 StepFun API Key。
- 普通用户模式下，StepFun API Key 只存在 `license-backend/.env`。
- 客户端开源仓库不能提交生产 `.env`、授权数据、管理员 token。
- 自部署 API Key 只给明确开启 `COMPANION_SELF_HOSTED=1` 的专业玩家使用。
- 授权后端必须使用强 `LICENSE_ADMIN_TOKEN`，并限制 `LICENSE_CORS_ORIGINS`。
- 授权后端入口必须保留请求体大小限制和限流策略。
- 自伤、自杀等危机表达优先进入安全回复，不触发语音娱乐化输出。
- 医疗、法律、金融等高风险话题只做信息整理和边界提醒。

## 14. 开发与测试

客户端：

```powershell
cd open-source-client
npm start
npm test
```

授权后端：

```powershell
cd license-backend
npm start
```

管理后台：

```text
http://localhost:8787/admin
```

客户端：

```text
http://localhost:5177
```

当前测试覆盖：

- Router Agent 输出规划。
- 不可用能力时不规划图片/语音。
- 危机工作流不规划语音。
- Voice Agent 情绪识别。
- RAG 中文切词和相似度。

## 15. 当前已完成的架构整理

已完成：

- 新增 `src/orchestrator/`。
- `/api/chat` 返回统一 `orchestration.outputs`。
- 前端停止核心输出路由和 prompt 构造。
- 删除旧前端 `public/routerAgent.js`。
- 新增 `npm test` 和最小测试。
- 授权后端完成第一轮安全加固：强管理员 token、CORS 白名单、body limit、内存限流。

仍待完成：

- 全仓中文乱码修复，统一 UTF-8。
- 将 `server.js` 拆分到 `routes/`、`services/`、`gateways/`、`policies/`。
- 授权后端从 JSON 文件升级 SQLite 或 Postgres，并把内存限流升级为可多实例共享的限流。
- 补授权额度、网关 mock、端到端 smoke test。
- 建立 CI。

## 16. 演进路线

### Phase 1: 编排中心化

状态：已启动。

- 后端拥有 Agent 编排权。
- 前端只消费输出计划。
- 多模态输出通过统一 `orchestration.outputs` 表达。

### Phase 2: 服务拆分

目标：

```text
server.js
  -> routes/*
  -> services/*
  -> gateways/*
  -> policies/*
```

优先拆：

1. `chatService`
2. `mediaService`
3. `authGateway`
4. `memoryService`
5. `agentService`

### Phase 3: 授权后端生产化

目标：

- JSON -> SQLite/Postgres。
- 原子用量扣减。
- 分布式请求限流。
- 管理后台登录。
- 审计日志。

### Phase 4: 产品化发布

目标：

- Electron 打包稳定。
- `.env` 模板清晰。
- 首次启动引导。
- 错误提示全部 UTF-8 正常显示。
- 普通用户与专业玩家模式明确区分。
