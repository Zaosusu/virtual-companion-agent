# Virtual Companion Agent

开源客户端仓库。项目默认接入 StepFun 生态，同时保留自部署模式：普通用户走官方授权后端，专业玩家可以配置自己的 OpenAI-compatible / StepFun API Key。

详细技术架构见：

```text
docs/architecture.md
```

StepFun 接入说明见：

```text
docs/stepfun-api.md
```

## 系统边界

整个项目分为两个主要运行系统：

```text
open-source-client  客户端 / 本地 Agent 运行时
license-backend     私有授权后端 / 模型中转网关
```

本仓库只包含开源客户端：

- 浏览器前端。
- 本地 Node.js API。
- Electron 桌面壳。
- 角色配置。
- 本地 SQLite 记忆。
- Agent 编排。
- 图片、语音、声音克隆工具入口。

不应提交到本仓库的内容：

- 官方授权码服务源码。
- 真实授权数据。
- 生产 `.env`。
- StepFun API Key。
- 管理员 token。

## 当前架构

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
      -> 官方授权后端 或 自部署模型 API
```

一句话分工：

```text
客户端负责体验、角色、记忆和 Agent 编排。
授权后端负责账号、授权码、额度、API Key 隔离和 StepFun 中转。
```

## 运行模式

优先级：

```text
官方账号 token / 授权码绑定 > 自部署 API Key > 免费体验模式
```

### 普通用户

普通用户登录账号或绑定授权码，走官方授权后端：

```text
客户端 -> license-backend -> StepFun
```

用户不需要接触模型 API Key。

### 专业玩家

专业玩家可以开启自部署模式：

```env
COMPANION_SELF_HOSTED=1
```

然后配置自己的：

```text
Base URL
Model
API Key
Image Base URL / Image Model / Image API Key
Audio Base URL / Audio Model / Audio API Key
```

自部署模式不经过官方授权后端，模型费用由用户自己承担。

### 免费体验

未配置官方授权或自部署 API Key 时进入免费体验模式。免费额度由本地配置和授权后端策略共同控制。

## 普通用户版

Windows 发行版在：

```text
release/虚拟角色智能体 0.1.0.exe
```

普通用户双击 exe 即可使用，不需要运行 `npm start`，也不需要手动打开 `localhost`。

## 开发启动

启动客户端：

```powershell
cd open-source-client
npm start
```

打开：

```text
http://localhost:5177
```

启动授权后端：

```powershell
cd ../license-backend
npm start
```

授权后台：

```text
http://localhost:8787/admin
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
COMPANION_OFFICIAL_BASE_URL=http://localhost:8787
COMPANION_OFFICIAL_MODEL=step-3.7-flash
COMPANION_FREE_DAILY_CHAT_LIMIT=10
COMPANION_COMPRESSION_WINDOW=100
COMPANION_SELF_HOSTED=0
```

生产环境请使用项目自己的 `.env`，不要依赖 PowerShell 全局 `$env:`。

## 当前架构状态

已完成：

- 后端新增 `src/orchestrator/`。
- `/api/chat` 返回统一 `orchestration.outputs`。
- 前端不再负责核心输出路由和 prompt 构造。
- 删除旧前端 router。
- 增加最小测试。

待完成：

- 全仓中文乱码修复，统一 UTF-8。
- 拆分 `server.js` 到 `routes/`、`services/`、`gateways/`、`policies/`。
- 授权后端从 JSON 升级 SQLite 或 Postgres。
- 补授权额度、网关 mock、端到端 smoke test。

## License

AGPL-3.0-only.
