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

test("agent voice experience settings are saved with safe defaults", () => {
  withStore((store) => {
    const defaults = store.upsertAgent({
      id: "voice-defaults",
      name: "Voice Defaults",
      persona: "A custom role.",
      isBuiltin: false
    });
    assert.equal(defaults.autoRead, false);
    assert.equal(defaults.voiceSpeed, 1);
    assert.equal(defaults.voiceVolume, 1);
    assert.equal(defaults.voiceExpressiveness, 0.6);
    assert.equal(defaults.voiceWarmth, 0.7);
    assert.equal(defaults.voiceClarity, 0.65);

    const configured = store.upsertAgent({
      ...defaults,
      autoRead: true,
      voiceSpeed: 1.35,
      voiceVolume: 1.4,
      voiceExpressiveness: 0.9,
      voiceWarmth: 0.8,
      voiceClarity: 0.55
    });
    assert.equal(configured.autoRead, true);
    assert.equal(configured.voiceSpeed, 1.35);
    assert.equal(configured.voiceVolume, 1.4);
    assert.equal(configured.voiceExpressiveness, 0.9);
    assert.equal(configured.voiceWarmth, 0.8);
    assert.equal(configured.voiceClarity, 0.55);

    const normalized = store.upsertAgent({
      ...configured,
      voiceSpeed: "too-fast",
      voiceVolume: 0,
      voiceExpressiveness: 9,
      voiceWarmth: -1,
      voiceClarity: "bad"
    });
    assert.equal(normalized.voiceSpeed, 1);
    assert.equal(normalized.voiceVolume, 0.1);
    assert.equal(normalized.voiceExpressiveness, 1);
    assert.equal(normalized.voiceWarmth, 0);
    assert.equal(normalized.voiceClarity, 0.65);
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
