import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSceneConstraints,
  canProduceSpeech,
  enforceSceneConstraints,
  spokenTextOutsideNarration
} from "../src/orchestrator/sceneConstraints.js";

test("scene constraints distinguish role silence from user silence", () => {
  const persistent = buildSceneConstraints({ userText: "保持沉默，不许开口。" });
  assert.equal(persistent.speech.mode, "silent");
  assert.equal(persistent.speech.scope, "until_released");
  assert.equal(canProduceSpeech(persistent), false);

  const userSilence = buildSceneConstraints({ userText: "我沉默了，不知道该怎么办。" });
  assert.equal(userSilence.speech.mode, "normal");
});

test("scene constraints remove spoken text after generation", () => {
  const constraints = buildSceneConstraints({ userText: "你不要说话，继续沉默。" });
  assert.equal(spokenTextOutsideNarration("（她垂下眼）我不回答。"), "我不回答");
  assert.equal(enforceSceneConstraints("（她垂下眼）我不回答。", constraints), "（她垂下眼）");
  assert.match(enforceSceneConstraints("我不说话。", constraints), /^（.+）$/);
});

test("persistent silence can be released by the next scene", () => {
  const prior = buildSceneConstraints({ userText: "保持沉默，不许开口。" });
  const released = buildSceneConstraints({
    userText: "沉默片刻后，她终于开口：我们走。",
    dialogueState: { sceneConstraints: prior }
  });
  assert.equal(released.speech.mode, "normal");
});
