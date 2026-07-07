# StepFun Step Plan 接入说明

本项目默认兼容 StepFun Step Plan，同时支持 OpenAI-compatible 模型服务。浏览器前端只调用本地客户端 API；模型 API Key 应保存在本地 Node 运行环境或部署方提供的远程模型接口中，不应写入浏览器前端。

## 运行通道

```text
自部署用户
  -> open-source-client
    -> OpenAI-compatible / StepFun API

使用远程模型接口的用户
  -> open-source-client
    -> 部署方提供的远程模型接口
      -> 模型供应商
```

公开仓库只提供客户端侧调用逻辑和接口约定，不包含远程服务实现、管理界面、用户体系、数据库或运维配置。

## 客户端环境配置

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
STEP_API_KEY=your-stepfun-api-key
STEPFUN_IMAGE_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_IMAGE_MODEL=step-image-edit-2
STEPFUN_AUDIO_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_AUDIO_MODEL=stepaudio-2.5-tts
```

远程模型接口：

```env
COMPANION_OFFICIAL_BASE_URL=https://your-remote-model-api.example.com
COMPANION_OFFICIAL_MODEL=step-3.7-flash
```

## Step Plan 路径

统一 base URL：

```text
https://api.stepfun.com/step_plan/v1
```

常用能力路径：

```text
/chat/completions
/images/generations
/images/edits
/audio/speech
/audio/voices/preview
/audio/voices
/audio/asr/sse
/realtime
/realtime/audio
```

## 文本模型

客户端入口：

```text
POST /api/chat
```

StepFun 请求路径：

```text
POST /chat/completions
```

默认模型：

```text
step-3.7-flash
```

可选模型：

```text
step-3.7-flash
step-3.5-flash-2603
step-3.5-flash
step-router-v1
```

支持推理强度的模型可以携带：

```json
{
  "reasoning_effort": "medium"
}
```

## 图片模型

客户端入口：

```text
POST /api/image
```

StepFun 请求路径：

```text
POST /images/generations
POST /images/edits
```

默认模型：

```text
step-image-edit-2
```

有参考图时使用 `/images/edits`，无参考图时使用 `/images/generations`。

默认请求参数：

```json
{
  "model": "step-image-edit-2",
  "response_format": "b64_json",
  "cfg_scale": 1,
  "steps": 8,
  "text_mode": true
}
```

返回字段：

```text
image.url
image.b64Json
image.seed
image.finishReason
```

## 语音模型

客户端入口：

```text
POST /api/tts
```

StepFun 请求路径：

```text
POST /audio/speech
```

默认模型：

```text
stepaudio-2.5-tts
```

默认音色：

```text
yuanqishaonv
```

返回字段：

```text
audioUrl
audioBase64
mimeType
format
```

## 声音克隆

客户端入口：

```text
POST /api/voice/clone
```

服务端先上传声音样本，再创建或复用音色 ID。客户端语音优先使用角色上的 `clonedVoiceId`。

## Agent 编排

多模态输出由后端统一编排：

```text
src/orchestrator/index.js
```

```text
routerAgent -> 判断 text / image / voice 输出计划
textAgent   -> 生成文字回复
imageAgent  -> 生成图片工具计划
voiceAgent  -> 生成语音工具计划和情绪演绎指令
memoryAgent -> 规划记忆写入
safetyAgent -> 识别安全风险并约束输出
```

`/api/chat` 返回：

```text
reply
orchestration.outputs
memory
quota
```

前端消费 `orchestration.outputs`，按计划触发 `/api/image` 和 `/api/tts`。

## 远程模型接口约定

如果部署方提供远程模型接口，客户端期望它支持：

```text
POST /api/chat
POST /api/image
POST /api/tts
POST /api/voice/clone
GET /api/health
```

该接口只需要对客户端呈现模型调用能力。用户体系、用量策略、审计、管理界面和密钥管理都由部署方自行实现，不在本公开仓库展开。

## 常见问题

### EADDRINUSE: address already in use

端口已有服务占用。修改 `PORT`，或关闭正在占用该端口的本地进程后重新启动。

### 公共免费体验

未登录或未配置模型通道时的公共 `free` 体验默认关闭。客户端 `.env` 可开启：

```env
COMPANION_PUBLIC_FREE_ACCESS=1
```

正式分发时请根据自己的部署策略决定是否开启。
