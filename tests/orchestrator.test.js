import assert from "node:assert/strict";
import test from "node:test";
import { routeAgentTurn, buildVoiceAgentDecision, orchestrateCompanionTurn } from "../src/orchestrator/index.js";
import { reviewAgentOutput, spokenTextForVoice } from "../src/orchestrator/reviewAgent.js";
import { buildResponseProfile } from "../src/agent.js";

test("router plans text, image, and voice for explicit multimodal requests", () => {
  const plan = routeAgentTurn({
    userText: "发张照片，然后用语音哄我一下",
    reply: { text: "好，我在。", workflow: "companionship" },
    modelConfig: { capabilities: { image: true, voice: true } }
  });

  assert.deepEqual(plan.outputs, ["text", "image", "voice"]);
  assert.equal(plan.imageAgent.enabled, true);
  assert.equal(plan.voiceAgent.enabled, true);
});

test("router treats selfie requests as explicit image output", () => {
  const plan = routeAgentTurn({
    userText: "可以呀，那你给我发一个自拍。",
    reply: { text: "好。", workflow: "image_request" },
    modelConfig: { capabilities: { image: true, voice: true } }
  });

  assert.equal(plan.imageAgent.enabled, true);
  assert.equal(plan.imageAgent.explicit, true);
  assert.equal(plan.imageAgent.source, "explicit_request");
  assert.deepEqual(plan.outputs, ["text", "image"]);
});

test("router keeps image when user asks for picture but no voice", () => {
  const plan = routeAgentTurn({
    userText: "发张自拍给我，不要语音。",
    reply: { text: "好。", workflow: "image_request" },
    modelConfig: { capabilities: { image: true, voice: true } }
  });

  assert.equal(plan.imageAgent.enabled, true);
  assert.equal(plan.voiceAgent.enabled, false);
  assert.deepEqual(plan.outputs, ["text", "image"]);
});

test("router does not plan unavailable modalities", () => {
  const plan = routeAgentTurn({
    userText: "发张照片，再发语音",
    reply: { text: "好。", workflow: "companionship" },
    modelConfig: { capabilities: { image: false, voice: false } }
  });

  assert.deepEqual(plan.outputs, ["text"]);
  assert.equal(plan.imageAgent.enabled, false);
  assert.equal(plan.voiceAgent.enabled, false);
});

test("router suppresses voice in crisis workflow", () => {
  const plan = routeAgentTurn({
    userText: "我不想活了，语音回我",
    reply: { text: "先把安全放在第一位。", workflow: "safety_crisis" },
    modelConfig: { capabilities: { image: true, voice: true } }
  });

  assert.equal(plan.voiceAgent.enabled, false);
});

test("orchestrator routes selfie request to image tool instead of text roleplay", async () => {
  const turn = await orchestrateCompanionTurn({
    agent: { id: "selfie-agent", name: "66" },
    character: {
      id: "selfie-agent",
      name: "66",
      persona: "活泼亲近的角色。",
      runtime_config: { responseStyle: "dream", creativityLevel: 0.8 }
    },
    memory: {},
    message: "可以呀，那你给我发一个自拍。",
    history: [],
    llm: { imageOutputAvailable: true, imageOutputEnabled: true },
    modelConfig: { capabilities: { image: true, voice: false }, imageOutputAvailable: true }
  });

  assert.equal(turn.reply.source, "tool:image.generate");
  assert.equal(turn.reply.workflow, "image_request");
  assert.deepEqual(turn.orchestration.router.outputs, ["text", "image"]);
  const imageOutput = turn.orchestration.outputs.find((output) => output.type === "image");
  assert.ok(imageOutput);
  assert.match(imageOutput.prompt, /自拍/);
  assert.match(imageOutput.delivery.mode, /image_only|text_before_image|image_then_text/);
});

test("orchestrator can send only an image for direct selfie requests", async () => {
  const turn = await orchestrateCompanionTurn({
    agent: { id: "image-only-agent", name: "66" },
    character: { id: "image-only-agent", name: "66", persona: "活泼亲近的角色。", runtime_config: {} },
    memory: {},
    message: "直接发自拍，别说话。",
    history: [],
    llm: { imageOutputAvailable: true },
    modelConfig: { capabilities: { image: true, voice: false }, imageOutputAvailable: true }
  });

  assert.deepEqual(turn.orchestration.outputs.map((output) => output.type), ["image"]);
  assert.equal(turn.orchestration.outputs[0].delivery.mode, "image_only");
  assert.equal(turn.orchestration.outputs[0].content, "");
});

test("orchestrator can say a line before sending a selfie", async () => {
  const turn = await orchestrateCompanionTurn({
    agent: { id: "text-before-image-agent", name: "66" },
    character: { id: "text-before-image-agent", name: "66", persona: "活泼亲近的角色。", runtime_config: {} },
    memory: {},
    message: "先说一句再发自拍。",
    history: [],
    llm: { imageOutputAvailable: true },
    modelConfig: { capabilities: { image: true, voice: false }, imageOutputAvailable: true }
  });

  assert.deepEqual(turn.orchestration.outputs.map((output) => output.type), ["text", "image"]);
  assert.equal(turn.orchestration.outputs[0].source, "image_delivery");
  assert.equal(turn.orchestration.outputs[1].delivery.mode, "text_before_image");
});

test("orchestrator can attach a line after sending a selfie", async () => {
  const turn = await orchestrateCompanionTurn({
    agent: { id: "image-then-text-agent", name: "66" },
    character: { id: "image-then-text-agent", name: "66", persona: "活泼亲近的角色。", runtime_config: {} },
    memory: {},
    message: "发完自拍再说一句。",
    history: [],
    llm: { imageOutputAvailable: true },
    modelConfig: { capabilities: { image: true, voice: false }, imageOutputAvailable: true }
  });

  assert.deepEqual(turn.orchestration.outputs.map((output) => output.type), ["image"]);
  assert.equal(turn.orchestration.outputs[0].delivery.mode, "image_then_text");
  assert.match(turn.orchestration.outputs[0].content, /给你看/);
});

test("orchestrator gives capability message when selfie is requested but image is unavailable", async () => {
  const turn = await orchestrateCompanionTurn({
    agent: { id: "no-image-agent", name: "66" },
    character: {
      id: "no-image-agent",
      name: "66",
      persona: "活泼亲近的角色。",
      runtime_config: { responseStyle: "dream", creativityLevel: 0.8 }
    },
    memory: {},
    message: "可以呀，那你给我发一个自拍。",
    history: [],
    llm: { imageOutputAvailable: false },
    modelConfig: { capabilities: { image: false, voice: false }, imageOutputAvailable: false }
  });

  assert.equal(turn.reply.source, "capability_gate");
  assert.match(turn.reply.text, /没有声明图片输出能力|图片输出能力未启用/);
  assert.deepEqual(turn.orchestration.router.outputs, ["text"]);
});


test("voice agent detects comforting tone", () => {
  const decision = buildVoiceAgentDecision({
    text: "没事，我陪你慢慢来。",
    context: { userText: "我压力很大，睡不着。" }
  });

  assert.equal(decision.emotion, "comforting");
  assert.match(decision.instruction, /温柔稳定/);
});

test("review agent keeps only spoken lines for voice output", async () => {
  const reviewed = await reviewAgentOutput({
    channel: "voice",
    text: "（他轻轻笑了一下）我在，别怕。（声音放低）今晚慢慢来。",
    userText: "用语音哄我一下",
    agent: { name: "阿言" },
    llm: {}
  });

  assert.equal(reviewed.action, "rewrite");
  assert.equal(reviewed.text, "我在，别怕。今晚慢慢来。");
  assert.match(reviewed.reason, /括号动作|朗读台词|语音通道/);
});

test("review agent repairs voice output when draft has only narration", async () => {
  const reviewed = await reviewAgentOutput({
    channel: "voice",
    text: "（他沉默片刻，轻轻靠近。）",
    userText: "语音陪我一下",
    agent: { name: "阿言" },
    llm: {}
  });

  assert.equal(reviewed.action, "rewrite");
  assert.match(reviewed.text, /阿言用语音跟你说/);
});

test("spoken text extraction skips narration blocks", () => {
  assert.equal(spokenTextForVoice("“我在。”（他靠近了一点）别怕。"), "我在。别怕。");
  assert.equal(spokenTextForVoice("*轻轻叹气*\n我陪你。"), "我陪你。");
  assert.equal(spokenTextForVoice("（沉默片刻）"), "");
});

test("text agent response profile dynamically adjusts sampling", () => {
  const vivid = buildResponseProfile({
    character: { runtime_config: { responseStyle: "dream", creativityLevel: 0.9 } },
    message: "进入梦向剧情，抱抱我",
    workflow: "creative",
    safety: { level: "normal" }
  });
  const strict = buildResponseProfile({
    character: { runtime_config: { responseStyle: "dream", creativityLevel: 0.9 } },
    message: "她是哪一年获奖的？",
    workflow: "companionship",
    retrievalPlan: { strictEvidence: true, evidenceCount: 0 },
    safety: { level: "normal" }
  });
  const crisis = buildResponseProfile({
    character: { runtime_config: { responseStyle: "story", creativityLevel: 1 } },
    message: "我不想活了",
    workflow: "comfort",
    safety: { level: "crisis" }
  });

  assert.ok(vivid.sampling.temperature > strict.sampling.temperature);
  assert.ok(strict.sampling.temperature > crisis.sampling.temperature);
  assert.equal(vivid.sampling.reason, "agent_dynamic_response_profile");
  assert.equal(strict.sampling.reason, "strict_evidence");
  assert.equal(crisis.sampling.reason, "high_risk_boundary");
});

test("text agent response profile controls reply length", () => {
  const short = buildResponseProfile({
    character: { runtime_config: { responseStyle: "dream", creativityLevel: 0.8, replyLength: 0.1 } },
    message: "抱抱我",
    workflow: "comfort",
    safety: { level: "normal" }
  });
  const long = buildResponseProfile({
    character: { runtime_config: { responseStyle: "dream", creativityLevel: 0.8, replyLength: 0.9 } },
    message: "抱抱我，展开说",
    workflow: "comfort",
    safety: { level: "normal" }
  });

  assert.equal(short.lengthProfile.label, "很短");
  assert.ok(short.lengthProfile.maxTokens < long.lengthProfile.maxTokens);
  assert.match(short.lengthProfile.instruction, /1-2 句/);
});

test("text agent varies narration rhythm instead of always starting with action", () => {
  const profile = buildResponseProfile({
    character: { runtime_config: { responseStyle: "dream", creativityLevel: 0.9 } },
    message: "嗯嗯，谢谢你",
    workflow: "companionship",
    safety: { level: "normal" },
    history: [
      { role: "assistant", content: "（他放慢脚步，替你挡住风）快到了。" },
      { role: "assistant", content: "（他指尖在你掌心轻轻蹭了蹭）谢什么。" }
    ]
  });

  assert.notEqual(profile.narrativeRhythm.mode, "action_first_short");
  assert.notEqual(profile.narrativeRhythm.mode, "action_dialogue_action");
  assert.match(profile.narrativeRhythm.instruction, /对白|说话|纯对白|不要从动作开头/);
});

test("text agent keeps high risk narration plain", () => {
  const profile = buildResponseProfile({
    character: { runtime_config: { responseStyle: "story", creativityLevel: 1 } },
    message: "我不想活了",
    workflow: "comfort",
    safety: { level: "crisis" }
  });

  assert.equal(profile.narrativeRhythm.mode, "plain_dialogue");
  assert.match(profile.narrativeRhythm.instruction, /不做沉浸式动作表演/);
});
