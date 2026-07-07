# 架构故事导览

这份导览解释系统如何从“一条用户消息”进入本地客户端，再由多个 Agent 接力完成回复、图片、语音、记忆和安全边界。

详细到每个 Agent 的职责、输入、处理方式和输出，请阅读 [Agent 职责故事板](agent-roles-storyboard.md)。

## 总体故事

```text
用户消息
  -> 前端界面
    -> 本地 Node API
      -> MemoryAgent / CRAG 记忆查证
      -> ContextAgent 上下文整理
      -> TextAgent 主回复生成
      -> RouterAgent 输出通道分流
      -> ImageAgent 图片计划
      -> VoiceAgent 语音情绪演绎
      -> ReviewAgent 输出前复核
      -> Gateway / Tools 模型通道执行
    -> 前端展示文字、图片、语音
```

一句话理解：

```text
前端负责展示。
本地后端负责 Agent 编排、CRAG 记忆、review 复核和工具计划。
模型通道负责把 Chat / Image / TTS / Voice Clone 请求交给用户配置的模型服务。
自部署模式给专业用户保留直连模型服务的能力；远程模型接口由部署方自行提供。
```

## 图册规划

当前图册按“一个 Agent 一个故事”拆分，而不是用一张大图概括所有能力：

| 编号 | 图名 | 说明 |
| --- | --- | --- |
| 01 | [Orchestrator 总控台](images/story/architecture_story_images/01_orchestrator/image_1.png) | 串起本轮聊天的完整 Agent 接力 |
| 02 | [RouterAgent 总调度员](images/story/architecture_story_images/02_router_agent/image_1.png) | 判断输出 text / image / voice |
| 03 | [ContextAgent 上下文整理员](images/story/architecture_story_images/03_context_agent/image_1.png) | 整理角色、人设、记忆和阻断事实 |
| 04 | [MemoryAgent / CRAG 记忆查证员](images/story/architecture_story_images/04_memory_crag_agent/image_1.png) | 查询改写、证据评分、低质量证据过滤 |
| 05 | [TextAgent 主回复撰写员](images/story/architecture_story_images/05_text_agent/image_1.png) | 生成主回复并遵守证据与安全边界 |
| 06 | [ImageAgent 图像计划师](images/story/architecture_story_images/06_image_agent/image_1.png) | 把图片需求变成可执行工具计划 |
| 07 | [VoiceAgent 情绪导演](images/story/architecture_story_images/07_voice_agent/image_1.png) | 捕获上下文情绪并生成 TTS 演绎指令 |
| 08 | [ReviewAgent 出口质检员](images/story/architecture_story_images/08_review_agent/image_1.png) | 输出前复核通道内容 |
| 09 | [SafetyAgent 安全边界员](images/story/architecture_story_images/09_safety_agent/image_1.png) | 识别 normal / bounded / crisis |
| 10 | [Gateway / Tools 模型通道执行层](images/story/architecture_story_images/10_gateway_tools/image_1.png) | 调用远程模型接口或自部署模型 |

对应 image2 / api2img 提示词在：

```text
docs/prompts/architecture_story/
```
