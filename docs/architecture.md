# 技术架构与 Agent 编排

本文档说明开源客户端的技术架构，覆盖浏览器前端、Electron 桌面壳、本地 Node API、Agent 编排、本地 SQLite、模型通道、测试与演进路线。

如果希望先用图像化方式理解系统，可以阅读 [架构故事导览](architecture-story.md)。

## 1. 总体架构

```text
用户
  -> Browser / Electron UI
    -> open-source-client 本地 Node API
      -> Agent Orchestrator
        -> routerAgent
        -> contextAgent
        -> textAgent
        -> imageAgent
        -> voiceAgent
        -> reviewAgent
        -> memoryAgent
        -> safetyAgent
      -> 本地 SQLite
      -> 图片 / 语音工具
      -> 模型通道
        -> 自部署 OpenAI-compatible / StepFun API
        -> 或部署方提供的远程模型接口
```

一句话分工：

```text
客户端负责体验、角色、记忆、Agent 编排和本地数据。
模型通道负责把 Chat / Image / TTS / Voice Clone 请求交给用户配置的模型服务。
```

任何远程用户体系、支付、用量策略、密钥保管或管理能力，都属于部署方自己的服务边界，不属于本开源仓库。

## 2. 仓库边界

开源客户端包含：

- 浏览器前端和 Electron 桌面壳。
- 本地 Node API 服务。
- 本地 SQLite 数据库。
- 角色配置、记忆、RAG、Agent 编排。
- 图片生成、语音合成、声音克隆等工具调用入口。
- 自部署模型配置入口。
- 可选远程模型接口的客户端调用约定。

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

不进入公开仓库的内容：

- 真实 `.env`。
- 本地数据库。
- 用户生成输出。
- API Key、访问令牌、账号数据。
- 私有服务实现、管理数据或计费数据。
- 私有部署脚本和运维配置。

## 3. 运行模式

客户端按配置选择模型通道：

```text
自部署模型 API
  或
部署方提供的远程模型接口
  或
本地体验模式
```

### 自部署模型

启用方式：

```env
COMPANION_SELF_HOSTED=1
```

启用后，用户可以配置：

```text
Base URL
Model
API Key
Image Base URL / Image Model / Image API Key
Audio Base URL / Audio Model / Audio API Key
```

特点：

- 用户自行管理模型供应商。
- 用户自行承担模型调用成本。
- 本地后端直接调用用户配置的 OpenAI-compatible 或 StepFun API。

### 远程模型接口

客户端可以连接部署方提供的远程模型接口：

```text
客户端本地 /api/chat
  -> 远程模型接口 /api/chat
    -> 模型供应商
```

公开仓库只约定客户端请求形态，不包含远程服务实现。部署方可以自行决定账号、密钥、额度、审计和运维策略。

### 本地体验模式

未配置可用模型通道时，客户端仍可运行本地界面、角色、记忆和部分无模型能力。公共免费体验由本地配置控制：

```env
COMPANION_PUBLIC_FREE_ACCESS=0
COMPANION_FREE_DAILY_CHAT_LIMIT=10
```

## 4. 客户端内部架构

```text
public/app.js
  -> server.js
    -> src/orchestrator/index.js
      -> contextAgent
      -> textAgent
      -> routerAgent
      -> imageAgent
      -> voiceAgent
      -> reviewAgent
      -> memoryAgent
      -> safetyAgent
    -> src/db.js
    -> src/tools/*
    -> self-hosted provider 或 remote model provider
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

### 本地 API 层

文件：

```text
server.js
```

本地 API 入口职责包括：

- HTTP 路由。
- 静态文件服务。
- 角色、配置、消息 API。
- 聊天回合处理。
- 图片、语音、声音克隆工具 API。
- 自部署模型调用。
- 可选远程模型接口代理。

服务拆分目标：

```text
routes/       HTTP 路由与参数校验
services/     chat、memory、agent、media 服务
gateways/     StepFun、OpenAI-compatible、remote model provider
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

Agent 分工：

| Agent | 文件 | 职责 |
| --- | --- | --- |
| contextAgent | `src/orchestrator/contextAgent.js` | 整理角色、人设、记忆和阻断事实 |
| routerAgent | `src/orchestrator/routerAgent.js` | 判断本轮输出 text / image / voice |
| textAgent | `src/orchestrator/textAgent.js` | 调用 `src/agent.js` 生成文本回复 |
| imageAgent | `src/orchestrator/imageAgent.js` | 根据文本 Agent 结果生成图片工具计划 |
| voiceAgent | `src/orchestrator/voiceAgent.js` | 生成语音工具计划和情绪演绎指令 |
| reviewAgent | `src/orchestrator/reviewAgent.js` | 复核输出通道内容 |
| memoryAgent | `src/orchestrator/memoryAgent.js` | 规划记忆候选、摘要、安全提示写入 |
| safetyAgent | `src/orchestrator/safetyAgent.js` | 安全风险识别边界 |

## 6. 聊天链路

### 后端链路

```text
POST /api/chat
  1. 读取 message
  2. 解析当前 agent / character / modelConfig
  3. 校验访问模式和本地体验额度
  4. 写入 user message
  5. retrieveMemories() 召回长期记忆
  6. orchestrateCompanionTurn()
     - contextAgent 整理上下文
     - textAgent 生成回复
     - routerAgent 判断输出形态
     - imageAgent / voiceAgent 生成工具计划
     - reviewAgent 复核
  7. finalizeChatTurn()
     - 写入 assistant 文本消息
     - 写入记忆候选
     - 写入 turn summary
     - 必要时写入 safety_note
     - 按配置压缩历史消息
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
    -> server.js 选择模型通道
      -> remote model provider /api/image
      -> 或 src/tools/imageGeneration.js
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
    -> remote model provider /api/tts
    -> 或 src/tools/speechSynthesis.js
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
| `model_config` | 模型配置 |
| `agents` | 多角色配置 |
| `messages` | 聊天消息 |
| `memories` | 长期记忆、人物语料、摘要、安全提示 |
| `memory_chunks` | 记忆切片和 hash embedding |
| `memory_chunks_fts` | FTS5 全文检索 |

RAG 检索策略：

```text
FTS5 keyword score
+ hash embedding cosine similarity
+ importance
+ confidence
+ recency
```

当前实现是轻量本地 RAG，适合单机与桌面场景。面向大语料、跨设备同步或多人共享角色场景，可以升级为：

- SQLite vector extension。
- 服务端向量库。
- Postgres + pgvector。

## 10. 模型接口契约

本地客户端期望模型通道支持以下能力：

| API | 作用 |
| --- | --- |
| `POST /api/chat` | Chat 生成 |
| `POST /api/image` | 图片生成或编辑 |
| `POST /api/tts` | 语音合成 |
| `POST /api/voice/clone` | 声音克隆 |

远程模型接口可以由任意部署方实现。公开仓库不规定其用户体系、管理界面、数据库或运维方案。

## 11. 配置项

客户端配置文件：

```text
open-source-client/.env
```

常用配置：

```env
PORT=5177
COMPANION_HOST=127.0.0.1
COMPANION_SELF_HOSTED=0
COMPANION_PUBLIC_FREE_ACCESS=0
COMPANION_FREE_DAILY_CHAT_LIMIT=10
COMPANION_COMPRESSION_WINDOW=100
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

可选远程模型接口：

```env
COMPANION_OFFICIAL_BASE_URL=https://your-remote-model-api.example.com
COMPANION_OFFICIAL_MODEL=step-3.7-flash
```

## 12. 本地 API

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

## 13. 安全边界

- 浏览器前端不应保存模型 API Key。
- 真实 `.env`、本地数据库、访问令牌和用户数据属于运行环境资产。
- 自部署 API Key 仅在 `COMPANION_SELF_HOSTED=1` 时启用。
- 自伤、自杀等危机表达优先进入安全回复，不触发语音娱乐化输出。
- 医疗、法律、金融等高风险话题只做信息整理和边界提醒。

## 14. 开发与测试

客户端：

```powershell
npm start
npm test
```

访问：

```text
http://localhost:5177
```

测试覆盖：

- Router Agent 输出规划。
- 不可用能力时不规划图片/语音。
- 危机工作流不规划语音。
- Voice Agent 情绪识别。
- RAG 中文切词和相似度。

## 15. 演进路线

### Phase 1: 编排中心化

- 后端拥有 Agent 编排权。
- 前端只消费输出计划。
- 多模态输出通过统一 `orchestration.outputs` 表达。

### Phase 2: 服务拆分

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
3. `modelGateway`
4. `memoryService`
5. `agentService`

### Phase 3: 产品化发布

- Electron 打包稳定。
- `.env` 模板清晰。
- 首次启动引导。
- 错误提示全部 UTF-8 正常显示。
- 自部署与远程模型接口模式明确区分。
