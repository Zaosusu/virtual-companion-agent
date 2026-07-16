import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoryDirective,
  detectNarrativeTurn,
  formatStoryDirectiveInstruction,
  nextDialogueState
} from "../src/orchestrator/storyDirectorAgent.js";

test("story director requires observable progress after user events", () => {
  const directive = buildStoryDirective({
    userText: "我签下合同，穿过时空隧道来到修仙界。",
    recentAssistant: ["（她接过合同）好，我签。"]
  });
  assert.equal(directive.active, true);
  assert.equal(directive.turnType, "scene_transition");
  assert.equal(directive.mustAdvance, true);
  assert.match(formatStoryDirectiveInstruction(directive), /可观察结果/);
  assert.match(formatStoryDirectiveInstruction(directive), /禁止换词重演/);
});

test("story mode persists until an explicit exit", () => {
  const first = buildStoryDirective({ userText: "进入剧情模式，门外突然传来脚步声。" });
  const state = nextDialogueState({ previous: {}, directive: first, sceneConstraints: { speech: { mode: "normal" } } });
  assert.equal(state.storyMode, true);
  const continued = buildStoryDirective({ userText: "我回头看她。", dialogueState: state });
  assert.equal(continued.active, true);
  const exit = buildStoryDirective({ userText: "退出剧情模式，回到普通聊天。", dialogueState: state });
  assert.equal(exit.exiting, true);
  assert.equal(nextDialogueState({ previous: state, directive: exit }).storyMode, false);
  assert.equal(detectNarrativeTurn("我推开门走进房间。"), true);
});
