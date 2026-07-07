# Agent 职责故事板

这份文档按“一个 Agent 一个故事”的方式解释当前架构。每一节都回答四个问题：

- 它接到什么输入。
- 它做什么判断。
- 它怎么处理。
- 它把什么结果交给下一个环节。

完整接口、配置和部署边界见 [技术架构与 Agent 编排](architecture.md)。

## 01 Orchestrator：总控台

![Orchestrator 总控台](images/story/architecture_story_images/01_orchestrator/image_1.png)

真实入口：

```text
src/orchestrator/index.js
orchestrateCompanionTurn()
```

故事：

用户发来一条消息后，总控台先不急着让模型回答。它把本轮需要的角色、人设、历史、记忆召回、模型能力和安全边界摆到桌面上，然后按顺序请不同 Agent 接力。

处理顺序：

```text
CRAG 记忆召回
  -> contextAgent 整理上下文
  -> textAgent 生成主回复
  -> routerAgent 判断输出形态
  -> imageAgent / voiceAgent 生成工具计划
  -> reviewAgent 复核输出
  -> orchestration.outputs
```

输出：

```text
reply
orchestration.version
orchestration.router
orchestration.agents
orchestration.outputs
```

## 02 RouterAgent：总调度员

![RouterAgent 总调度员](images/story/architecture_story_images/02_router_agent/image_1.png)

真实入口：

```text
src/orchestrator/routerAgent.js
routeAgentTurn()
```

故事：

RouterAgent 像前台分诊台。用户可能只是想聊天，也可能想看图、听语音，或者说了“只要文字”。RouterAgent 先判断这一句话属于哪类请求，再决定本轮输出哪些通道。

它会看：

- 用户是否明确要图片。
- 用户是否隐含了视觉需求，例如穿搭、背景、表情、场景。
- 用户是否要语音。
- 用户是否明确只要文字。
- 当前模型配置是否真的支持图片或语音。
- 当前回复是否属于 `safety_crisis`，危机场景不规划语音娱乐化输出。

输出：

```text
outputs: ["text", "image", "voice"]
imageAgent.enabled / explicit / source
voiceAgent.enabled / explicit
```

## 03 ContextAgent：上下文整理员

![ContextAgent 上下文整理员](images/story/architecture_story_images/03_context_agent/image_1.png)

真实入口：

```text
src/orchestrator/contextAgent.js
runContextAgent()
```

故事：

ContextAgent 像资料整理员。它把角色人设、用户资料、长期记忆、最近历史和 CRAG 证据放在一起，整理成本轮 TextAgent 可以使用的上下文计划。

它会在两种情况下更谨慎：

- 记忆或人物语料较大，需要模型辅助压缩。
- 涉及身份、复刻、开发者、项目获奖、代码、Demo 等容易混淆事实的内容。

输出：

```text
characterFacts
userMemory
styleHints
blockedFacts
warnings
reviewer: local / llm
```

## 04 MemoryAgent / CRAG：记忆查证员

![MemoryAgent / CRAG 记忆查证员](images/story/architecture_story_images/04_memory_crag_agent/image_1.png)

真实入口：

```text
src/orchestrator/memoryAgent.js
runCragRetrieval()
buildMemoryWritePlan()
```

故事：

MemoryAgent 不是简单拿最近几条记忆。它先判断用户问题是不是事实型、是不是承接上文、是不是太短，然后改写查询、召回候选、必要时做关键词补扫，再给每条证据打分。

CRAG 流程：

```text
用户问题
  -> buildRetrievalPlan()
  -> retrieveMemories()
  -> scanMemories()
  -> evaluateEvidence()
  -> quality: good / partial / poor
  -> strictEvidence
```

它会过滤：

- 目录噪声。
- 风格语料噪声。
- 与奖项、项目、教育等意图不匹配的记忆。
- 低事实信号、低置信度候选。

输出：

```text
retrievedMemories
retrievalPlan.quality
retrievalPlan.strictEvidence
retrievalPlan.evidenceCount
retrievalPlan.rejectedCount
```

## 05 TextAgent：主回复撰写员

![TextAgent 主回复撰写员](images/story/architecture_story_images/05_text_agent/image_1.png)

真实入口：

```text
src/orchestrator/textAgent.js
runTextAgent()
src/agent.js
createCompanionReply()
```

故事：

TextAgent 是真正写主回复的人。它拿到角色设定、上下文计划、CRAG 证据、安全等级和历史对话后，决定本轮是陪伴、计划、复盘、创作、安全回复，还是图片请求。

它会遵守：

- CRAG 证据不足时，不编造具体事实。
- 高风险话题只做边界提醒和信息整理。
- 危机场景优先安全回复。
- 图片请求可生成 `tool:image.generate` 计划。

输出：

```text
reply.text
reply.workflow
reply.mood
reply.safety
reply.tool
reply.source
```

## 06 ImageAgent：图像计划师

![ImageAgent 图像计划师](images/story/architecture_story_images/06_image_agent/image_1.png)

真实入口：

```text
src/orchestrator/imageAgent.js
buildImageOutputPlan()
server.js POST /api/image
src/tools/imageGeneration.js
```

故事：

ImageAgent 不直接画图。它先把 TextAgent 的结果变成可执行的图片计划，保留用户本轮意图、角色视觉设定、参考图模式和 prompt。前端拿到计划后，再调用 `/api/image` 真正生成图片。

图片链路：

```text
routerAgent 判断需要 image
  -> imageAgent 生成 image output plan
  -> 前端调用 /api/image
  -> 远程模型接口或自部署图片模型
  -> 图片消息写入 SQLite
```

Image Review 关注：

- 图片 prompt 是否继承角色外观和情绪上下文。
- 有参考图时是否走 `/images/edits`。
- 结果是否记录 `seed`、`finishReason`、`referenceMode`、`imageEndpoint`。
- 图片是否作为 assistant message 持久化。

## 07 VoiceAgent：情绪导演

![VoiceAgent 情绪导演](images/story/architecture_story_images/07_voice_agent/image_1.png)

真实入口：

```text
src/orchestrator/voiceAgent.js
buildVoiceOutputPlan()
buildVoiceAgentDecision()
server.js POST /api/tts
```

故事：

VoiceAgent 不只是把文字交给 TTS。它会先让 reviewAgent 检查语音文本，再读取最近历史、本轮用户文本、回复文本、workflow 和角色声音风格，判断这段话应该怎么说。

它识别的情绪信号包括：

```text
crying / panic / pleading / secretive / shy / happy / comforting / angry / natural
```

输出：

```text
voice output text
voiceDecision.emotion
voiceDecision.label
voiceDecision.instruction
audioConfig
```

危机场景下，RouterAgent 会直接抑制语音输出。

## 08 ReviewAgent：出口质检员

![ReviewAgent 出口质检员](images/story/architecture_story_images/08_review_agent/image_1.png)

真实入口：

```text
src/orchestrator/reviewAgent.js
reviewAgentOutput()
```

故事：

ReviewAgent 站在输出前最后一道门。它检查草稿是否适合当前通道，尤其是语音通道：如果系统已经要发语音，回复里就不能再说“我不能发语音”“只能打字”“我们打电话吧”。

它有两层机制：

- 有模型配置时，请模型按 JSON 返回 `keep` 或 `rewrite`。
- 本地硬检查兜底，发现语音能力冲突就自动修复。

输出：

```text
action: keep / rewrite
text
reason
reviewer: llm / local
```

## 09 SafetyAgent：安全边界员

![SafetyAgent 安全边界员](images/story/architecture_story_images/09_safety_agent/image_1.png)

真实入口：

```text
src/orchestrator/safetyAgent.js
detectSafety()
```

故事：

SafetyAgent 负责先看风险，而不是等生成完再补救。它识别危机场景和医疗、法律、金融等高风险领域，把本轮回复限制在合适边界内。

当前安全等级：

```text
normal
bounded
crisis
```

影响：

- crisis：优先安全回复，不触发语音娱乐化输出。
- bounded：不替代专业意见，只做信息整理和边界提醒。
- normal：正常陪伴与多模态输出。

## 10 Gateway / Tools：模型通道执行层

![Gateway / Tools 模型通道执行层](images/story/architecture_story_images/10_gateway_tools/image_1.png)

真实入口：

```text
server.js
callOfficialImageGateway()
callOfficialTtsGateway()
src/tools/imageGeneration.js
src/tools/speechSynthesis.js
```

故事：

Agent 只规划“要做什么”，真正调用模型的是工具和网关层。用户可以走部署方提供的远程模型接口，也可以走本地 `.env` 配置的自部署模型服务。

它负责：

- Chat / Image / TTS / Voice Clone 中转。
- API Key 隔离。
- 本地体验额度或模型调用状态判断。
- 图片与语音结果持久化。
- 网络错误和额度错误转成用户可理解的提示。
