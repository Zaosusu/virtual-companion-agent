# StepFun Step Plan 接入说明

本项目默认接入 StepFun Step Plan，并同时支持托管授权服务与自部署模型配置。浏览器前端只调用本地客户端 API；模型 API Key 由托管授权服务或本地自部署配置持有。

## 运行通道

```text
普通用户
  -> open-source-client
    -> 托管授权服务
      -> StepFun

专业玩家自部署
  -> open-source-client
    -> OpenAI-compatible / StepFun API
```

普通用户使用账号或授权码登录后，由托管授权服务完成额度校验和模型中转。自部署用户可以在本地 `.env` 中配置自己的模型服务和 API Key。

## 环境配置

客户端配置文件：

```text
open-source-client/.env
```

托管授权服务配置文件：

```text
license-backend/.env
```

部署环境建议使用项目级 `.env` 管理配置，避免依赖 PowerShell 全局 `$env:`。

## 客户端常用配置

```env
PORT=5177
COMPANION_HOST=127.0.0.1
COMPANION_OFFICIAL_BASE_URL=http://localhost:8787
COMPANION_OFFICIAL_MODEL=step-3.7-flash
COMPANION_FREE_DAILY_CHAT_LIMIT=10
COMPANION_COMPRESSION_WINDOW=100
COMPANION_SELF_HOSTED=0
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

## 托管授权服务常用配置

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
STEP_API_KEY=your-stepfun-api-key
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_MODEL=step-3.7-flash
STEPFUN_REASONING_EFFORT=medium
STEPFUN_IMAGE_MODEL=step-image-edit-2
STEPFUN_AUDIO_MODEL=stepaudio-2.5-tts
STEPFUN_AUDIO_VOICE=yuanqishaonv
STEPFUN_AUDIO_FORMAT=mp3
```

`LICENSE_ADMIN_TOKEN` 建议使用至少 24 位的长随机密钥。`LICENSE_CORS_ORIGINS` 应配置为实际允许访问授权服务的客户端来源。

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

托管授权服务中转：

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

支持推理强度的模型会携带：

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

托管授权服务中转：

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

托管授权服务中转：

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

托管授权服务中转：

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

## 额度规则

托管授权服务统计成功中转的模型调用：

```text
POST /api/chat
POST /api/image
POST /api/tts
POST /api/audio/voices/preview
POST /api/audio/voices/clone
POST /api/voice/clone
```

一次成功中转计 1 次。参数错误、授权失败或模型服务返回失败时不扣减额度。

## 账号与授权码绑定

调用规则：

```text
1. 用户注册或登录账号。
2. 用户绑定授权码。
3. 客户端保存用户访问令牌。
4. 托管授权服务根据用户访问令牌查找绑定授权码。
5. 文本、图片、语音和声音克隆共享同一额度池。
```

默认通过用户账号访问模型中转接口。授权码直连能力可通过托管授权服务 `.env` 开启：

```env
LICENSE_ALLOW_DIRECT_KEYS=1
```

## 健康检查

客户端：

```text
GET /api/health
```

托管授权服务：

```text
GET /api/health
```

托管授权服务健康检查返回安全配置状态、模型名称和可计量接口列表，不暴露 StepFun baseUrl。

## 常见问题

### EADDRINUSE: address already in use

端口已有服务占用。`node license-server.js` 和 `npm start` 指向同一个授权服务，同一目录保留一个运行实例即可。

### 管理凭证不正确

管理后台凭证来自：

```text
license-backend/.env 里的 LICENSE_ADMIN_TOKEN
```

`LICENSE_ADMIN_TOKEN` 建议使用至少 24 位的长随机密钥。

### 公共免费体验

未登录用户的公共 `free` 体验默认关闭。客户端 `.env` 可开启：

```env
COMPANION_PUBLIC_FREE_ACCESS=1
```

正式部署通常使用登录后的用户免费额度。
