# Virtual Companion Agent

开源客户端仓库。项目包含浏览器前端、Electron 桌面壳、本地 Node API、Agent 编排、本地 SQLite 记忆和多模态工具入口。

这个仓库不包含任何私有运行环境资产，例如 `.env`、本地数据库、生成输出、API Key、访问令牌、账号数据或商业授权数据。

架构故事导览：

```text
docs/architecture-story.md
docs/agent-roles-storyboard.md
```

详细技术架构：

```text
docs/architecture.md
```

StepFun / OpenAI-compatible 接入说明：

```text
docs/stepfun-api.md
```

## 仓库范围

| 模块 | 内容 |
| --- | --- |
| UI | 浏览器前端和 Electron 桌面壳 |
| Local API | 本地 Node.js API |
| Agent | 路由、文本、图片、语音、记忆和安全编排 |
| Storage | 本地 SQLite 记忆与角色配置 |
| Tools | 图片、语音、声音克隆工具入口 |
| Model Config | 自部署模型配置，以及可选的远程模型接口地址 |

开源客户端只定义本地运行逻辑和模型调用接口。任何远程用户体系、支付、用量策略、密钥保管或管理能力，都属于部署方自己的服务边界，不是本开源仓库的一部分。

## 架构概览

```text
用户
  -> Browser / Electron UI
    -> 本地 Node API
      -> src/orchestrator
        -> routerAgent
        -> textAgent
        -> imageAgent
        -> voiceAgent
        -> memoryAgent
        -> safetyAgent
      -> 本地 SQLite
      -> 模型通道
        -> 自部署模型 API
        -> 或部署方提供的远程模型接口
```

一句话分工：

```text
客户端负责体验、角色、记忆、Agent 编排和本地数据。
模型通道负责把 Chat / Image / TTS / Voice Clone 请求交给用户配置的模型服务。
```

## Agent 图册

完整说明见 [Agent 职责故事板](docs/agent-roles-storyboard.md)。

<details>
<summary>展开 10 张 Agent 职责图</summary>

### 01 Orchestrator

![Orchestrator 总控台](docs/images/story/architecture_story_images/01_orchestrator/image_1.png)

### 02 RouterAgent

![RouterAgent 总调度员](docs/images/story/architecture_story_images/02_router_agent/image_1.png)

### 03 ContextAgent

![ContextAgent 上下文整理员](docs/images/story/architecture_story_images/03_context_agent/image_1.png)

### 04 MemoryAgent CRAG

![MemoryAgent / CRAG 记忆查证员](docs/images/story/architecture_story_images/04_memory_crag_agent/image_1.png)

### 05 TextAgent

![TextAgent 主回复撰写员](docs/images/story/architecture_story_images/05_text_agent/image_1.png)

### 06 ImageAgent

![ImageAgent 图像计划师](docs/images/story/architecture_story_images/06_image_agent/image_1.png)

### 07 VoiceAgent

![VoiceAgent 情绪导演](docs/images/story/architecture_story_images/07_voice_agent/image_1.png)

### 08 ReviewAgent

![ReviewAgent 出口质检员](docs/images/story/architecture_story_images/08_review_agent/image_1.png)

### 09 SafetyAgent

![SafetyAgent 安全边界员](docs/images/story/architecture_story_images/09_safety_agent/image_1.png)

### 10 Gateway / Tools

![Gateway / Tools 模型通道执行层](docs/images/story/architecture_story_images/10_gateway_tools/image_1.png)

</details>

## 运行模式

### 自部署模型

适合希望自己管理模型供应商、API Key 和调用成本的用户。

```env
COMPANION_SELF_HOSTED=1
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_MODEL=step-3.7-flash
STEP_API_KEY=your-api-key
STEPFUN_IMAGE_MODEL=step-image-edit-2
STEPFUN_AUDIO_MODEL=stepaudio-2.5-tts
```

### 远程模型接口

客户端也可以连接部署方提供的远程模型接口。公开仓库只保留客户端侧配置和接口约定，不包含该远程服务的实现、管理界面、数据库或运维配置。

```env
COMPANION_OFFICIAL_BASE_URL=https://your-remote-model-api.example.com
COMPANION_OFFICIAL_MODEL=step-3.7-flash
```

### 本地体验模式

未配置可用模型通道时，客户端仍可运行本地界面、角色、记忆和部分无模型能力。是否允许公共免费体验由本地配置控制：

```env
COMPANION_PUBLIC_FREE_ACCESS=0
COMPANION_FREE_DAILY_CHAT_LIMIT=10
```

## 普通用户版

Windows 发行版在：

```text
release/虚拟角色智能体 0.1.0.exe
```

普通用户双击 exe 即可使用，无需运行 `npm start` 或手动打开 `localhost`。

## 开发启动

```powershell
cd open-source-client
npm install
npm start
```

打开：

```text
http://localhost:5177
```

桌面预览：

```powershell
npm run desktop
```

## 测试

```powershell
npm test
```

当前测试覆盖：

- Agent 路由规划。
- 图片/语音能力开关。
- 危机场景语音抑制。
- Voice Agent 情绪识别。
- RAG 中文召回基础逻辑。

## 关键目录

```text
server.js                         本地 API 入口
public/app.js                     前端主逻辑
src/orchestrator/                 Agent 编排层
src/agent.js                      文本 Agent 核心逻辑
src/db.js                         SQLite 数据与记忆层
src/config.js                     模型配置与模式选择
src/tools/imageGeneration.js      图片工具
src/tools/speechSynthesis.js      语音工具
tests/                            最小测试
docs/architecture.md              技术架构文档
docs/architecture-story.md        架构故事导览
docs/agent-roles-storyboard.md    Agent 职责故事板
```

## 环境配置

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

部署环境建议使用项目级 `.env` 管理配置，避免依赖 PowerShell 全局 `$env:`。

## 路线图

- 保持全仓 Markdown、配置模板和示例资产使用 UTF-8 编码。
- 拆分 `server.js` 到 `routes/`、`services/`、`gateways/`、`policies/`。
- 完善模型网关 mock、自部署模型测试和端到端 smoke test。
- 优化首次启动引导和错误提示。

## License

AGPL-3.0-only.
