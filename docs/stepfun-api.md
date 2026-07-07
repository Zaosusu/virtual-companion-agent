# StepFun Step Plan 接入说明

本项目生产环境默认接入 StepFun Step Plan。浏览器前端不要直连 StepFun，也不要保存 StepFun API Key；前端只调用本项目后端或授权后端提供的中转接口。

## 环境配置

配置文件：

```text
open-source-client/.env
license-backend/.env
```

授权后端核心配置：

```env
LICENSE_PORT=8787
LICENSE_ADMIN_TOKEN=your-admin-token
STEP_API_KEY=your-stepfun-api-key
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_MODEL=step-3.7-flash
STEPFUN_REASONING_EFFORT=medium
STEPFUN_IMAGE_MODEL=step-image-edit-2
STEPFUN_AUDIO_MODEL=stepaudio-2.5-tts
STEPFUN_AUDIO_VOICE=yuanqishaonv
STEPFUN_AUDIO_FORMAT=mp3
```

不要在生产环境用 PowerShell 全局 `$env:` 放这些值。多项目同机部署时，用项目自己的 `.env`，避免互相污染。

## Step Plan 路径

Step Plan 统一使用：

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

## 授权后端中转接口

授权后端目录：

```text
license-backend
```

授权后台：

```text
http://localhost:8787/admin
```

管理员口令对应：

```env
license-backend/.env 里的 LICENSE_ADMIN_TOKEN
```

### 用量规则

授权后端会统计所有成功的 StepFun 中转调用：

```text
POST /api/chat   -> 文字/推理模型
POST /api/image  -> 图片生成或图片编辑
POST /api/tts    -> 语音合成
POST /api/audio/voices/preview -> 音色试听
POST /api/audio/voices/clone   -> 声音克隆
POST /api/voice/clone          -> 声音克隆
```

每次用户可见接口成功调用计 1 次。参数错误、授权失败、StepFun 返回失败时不扣次数。后台里的“本月用量 / 月额度”是文字、图片、语音和声音克隆的合计，不是只统计聊天。

## 推理模型

授权后端接口：

```text
POST /api/chat
```

StepFun 实际请求：

```text
POST https://api.stepfun.com/step_plan/v1/chat/completions
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

支持推理强度的模型会带：

```json
{
  "reasoning_effort": "medium"
}
```

前端调用本项目后端：

```js
await api("/api/chat", {
  method: "POST",
  body: JSON.stringify({ message: userText })
});
```

## 图像模型

授权后端接口：

```text
POST /api/image
```

StepFun 实际请求：

```text
POST https://api.stepfun.com/step_plan/v1/images/generations
POST https://api.stepfun.com/step_plan/v1/images/edits
```

默认模型：

```text
step-image-edit-2
```

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

前端调用本项目后端：

```js
await api("/api/image", {
  method: "POST",
  body: JSON.stringify({ prompt })
});
```

返回值里的图片字段：

```js
result.image.url
result.image.b64Json
```

如果传入角色参考图，授权后端会自动使用 `/images/edits`，仍按一次图片调用计量。

## 语音模型

授权后端接口：

```text
POST /api/tts
```

StepFun 实际请求：

```text
POST https://api.stepfun.com/step_plan/v1/audio/speech
```

默认模型：

```text
stepaudio-2.5-tts
```

默认音色：

```text
yuanqishaonv
```

前端调用本项目后端：

```js
await api("/api/tts", {
  method: "POST",
  body: JSON.stringify({ text })
});
```

返回值：

```js
result.audioUrl
result.audioBase64
result.mimeType
result.format
```

## 前端 Agent 分工

前端负责“像人一样选择输出方式”，后端只负责授权、用量统计和中转。

文件：

```text
public/routerAgent.js
```

分工：

```text
router_agent: 判断本轮输出文字、语音、图片，或组合输出
text_agent: 调用 /api/chat
voice_agent: 调用 /api/tts
image_agent: 调用 /api/image
```

示例：

```text
用户：发张照片，然后用语音哄我一下
router_agent: text + image + voice
text_agent: 获取文字回复
image_agent: 根据上下文生成图片
voice_agent: 把文字回复转成语音
```

## 健康检查

本地客户端后端：

```text
GET /api/health
```

授权后端：

```text
GET /api/health
```

授权后端会返回：

```text
baseUrl
model
imageModel
audioModel
meteredEndpoints
```

## 常见问题

### EADDRINUSE: address already in use

说明端口已经有服务在运行。`node license-server.js` 和 `npm start` 是同一个授权服务，不要同时启动。

### 管理员口令不正确

授权后台输入的管理员口令必须等于：

```env
license-backend/.env 里的 LICENSE_ADMIN_TOKEN
```

### baseUrl 看不到

检查：

```text
GET /api/bootstrap
GET /api/health
```

## 注册用户与免费额度

授权后端提供账号接口：

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

新用户注册后会得到用户 token，客户端把 token 保存在本机 SQLite，并用这个 token 调用授权后端。默认免费额度是 10 次，由 `LICENSE_FREE_USER_TRIAL_LIMIT` 控制。免费额度绑定到用户 token，文字、图片、语音和声音克隆共享同一个额度。

未登录用户的公共 `free` 体验默认关闭；如需打开，可以在客户端 `.env` 设置：

```env
COMPANION_PUBLIC_FREE_ACCESS=1
```

## 账号与授权码绑定规则

生产规则：

```text
1. 用户先注册或登录账号。
2. 用户把购买到的授权码绑定到账号。
3. 客户端保存用户 token，不再直接用授权码调用模型接口。
4. 授权后端收到用户 token 后，自动找到该用户绑定的授权码。
5. 所有文字、图片、语音调用都计入绑定授权码的用量。
```

默认不允许把 `vc_live_...` 授权码直接作为 Bearer 调用模型接口。需要兼容旧模式时，才在授权后端 `.env` 打开：

```env
LICENSE_ALLOW_DIRECT_KEYS=1
```

## 邮箱验证码

注册和重置密码使用邮箱验证码，接口在授权后端：

```text
POST /api/auth/send-code
POST /api/auth/register
POST /api/auth/reset-password
```

授权后端需要配置 SMTP：

```env
EMAIL_CODE_TTL_MINUTES=10
EMAIL_CODE_COOLDOWN_SECONDS=60
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=no-reply@example.com
```

没有配置 SMTP 时，后端会明确返回“邮件服务未配置”，不会假装发送成功。
