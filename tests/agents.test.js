import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CompanionStore } from "../src/db.js";

function withStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "companion-agents-"));
  const store = new CompanionStore(path.join(dir, "test.sqlite"));
  try {
    return fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("deleting the active custom agent selects an existing fallback agent", () => {
  withStore((store) => {
    const agent = store.upsertAgent({
      id: "custom-delete-me",
      name: "Custom",
      isBuiltin: false
    });
    store.setActiveAgent(agent.id);

    assert.equal(store.deleteAgent(agent.id), true);
    assert.equal(store.getAgent(agent.id), null);
    assert.ok(store.getAgent(store.getActiveAgentId()));
    assert.notEqual(store.getActiveAgentId(), agent.id);
  });
});

test("built-in agents cannot be deleted", () => {
  withStore((store) => {
    assert.throws(() => store.deleteAgent("mori"), /Built-in agents cannot be deleted/);
    assert.ok(store.getAgent("mori"));
  });
});

test("agent gender is saved independently from voice type", () => {
  withStore((store) => {
    const explicit = store.upsertAgent({
      id: "male-agent-with-female-voice",
      name: "Male Agent",
      persona: "A custom role.",
      gender: "male",
      voiceGender: "female",
      isBuiltin: false
    });
    assert.equal(explicit.gender, "male");
    assert.equal(explicit.voiceGender, "female");

    const inferred = store.upsertAgent({
      id: "inferred-male-agent",
      name: "Inferred Male Agent",
      persona: "A custom role.",
      voiceGender: "deep_male",
      isBuiltin: false
    });
    assert.equal(inferred.gender, "male");
  });
});

test("last active assistant can be used when regenerate id is stale", () => {
  withStore((store) => {
    const sessionId = "regen-agent";
    const userId = store.addMessage({
      sessionId,
      role: "user",
      content: "你好"
    });
    const assistantId = store.addMessage({
      sessionId,
      role: "assistant",
      content: "你好呀",
      parentId: userId,
      variantGroupId: `variant:${userId}`
    });

    const staleId = assistantId + 9999;
    assert.equal(store.getMessage(staleId), null);
    assert.equal(store.getLastActiveAssistantMessage(sessionId).id, assistantId);
  });
});
