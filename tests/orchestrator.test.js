import assert from "node:assert/strict";
import test from "node:test";
import { routeAgentTurn, buildVoiceAgentDecision } from "../src/orchestrator/index.js";

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

test("voice agent detects comforting tone", () => {
  const decision = buildVoiceAgentDecision({
    text: "没事，我陪你慢慢来。",
    context: { userText: "我压力很大，睡不着。" }
  });

  assert.equal(decision.emotion, "comforting");
  assert.match(decision.instruction, /温柔稳定/);
});
