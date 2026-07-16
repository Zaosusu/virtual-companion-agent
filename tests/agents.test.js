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

test("agent response experience settings are saved with safe defaults", () => {
  withStore((store) => {
    const defaults = store.upsertAgent({
      id: "response-defaults",
      name: "Response Defaults",
      persona: "A custom role.",
      isBuiltin: false
    });
    assert.equal(defaults.responseStyle, "balanced");
    assert.equal(defaults.creativityLevel, 0.6);
    assert.equal(defaults.replyLength, 0.35);

    const configured = store.upsertAgent({
      ...defaults,
      responseStyle: "dream",
      creativityLevel: 0.9,
      replyLength: 0.2
    });
    assert.equal(configured.responseStyle, "dream");
    assert.equal(configured.creativityLevel, 0.9);
    assert.equal(configured.replyLength, 0.2);

    const normalized = store.upsertAgent({
      ...configured,
      responseStyle: "unknown-style",
      creativityLevel: 5,
      replyLength: -1
    });
    assert.equal(normalized.responseStyle, "balanced");
    assert.equal(normalized.creativityLevel, 1);
    assert.equal(normalized.replyLength, 0);
  });
});

test("individual memories can be confirmed, prioritized, edited, and deleted per agent", () => {
  withStore((store) => {
    const memoryId = store.upsertMemory({
      kind: "fact",
      content: "用户喜欢旧内容",
      importance: 0.4,
      metadata: { agentId: "mori", sourceName: "聊天记录" }
    });
    const updated = store.updateMemory({
      id: memoryId,
      agentId: "mori",
      content: "用户喜欢新的准确内容",
      importance: 1,
      confirmed: true,
      pinned: true
    });
    assert.equal(updated.text, "用户喜欢新的准确内容");
    assert.equal(updated.importance, 1);
    assert.equal(updated.confirmed, true);
    assert.equal(updated.pinned, true);
    assert.equal(updated.sourceName, "聊天记录");
    assert.equal(store.updateMemory({ id: memoryId, agentId: "other", importance: 0.2 }), null);
    assert.equal(store.retrieveMemories("新的准确内容", { agentId: "mori", limit: 4 })[0].content, "用户喜欢新的准确内容");

    const snapshot = store.getMemorySnapshot({ perKind: 20, agentId: "mori" });
    assert.equal(snapshot.facts[0].confirmed, true);
    assert.equal(snapshot.facts[0].pinned, true);
    assert.equal(store.deleteMemory({ id: memoryId, agentId: "other" }), false);
    assert.equal(store.deleteMemory({ id: memoryId, agentId: "mori" }), true);
    assert.equal(store.getMemory(memoryId), null);
    assert.equal(store.retrieveMemories("新的准确内容", { agentId: "mori", limit: 4 }).length, 0);
  });
});

test("chat request ids are persisted on messages for idempotent recovery", () => {
  withStore((store) => {
    const id = store.addMessage({
      sessionId: "mori",
      role: "user",
      content: "只发送一次",
      metadata: { requestId: "req-once", requestStatus: "processing" }
    });
    assert.equal(store.getMessageByRequestId({ sessionId: "mori", requestId: "req-once", role: "user" }).id, id);
    assert.equal(store.getMessageByRequestId({ sessionId: "other", requestId: "req-once", role: "user" }), null);
    const patched = store.patchMessageMetadata(id, { requestStatus: "completed" });
    assert.equal(patched.metadata.requestId, "req-once");
    assert.equal(patched.metadata.requestStatus, "completed");
  });
});

test("full desktop backup round-trips user data without exporting credentials", () => {
  withStore((store) => {
    const agent = store.upsertAgent({
      id: "backup-role",
      name: "Backup Role",
      persona: "Persistent persona",
      chatBackground: { data: "aGVsbG8=", mime: "image/png", name: "background.png" },
      isBuiltin: false
    });
    store.setActiveAgent(agent.id);
    const userId = store.addMessage({
      sessionId: agent.id,
      role: "user",
      content: "backup user message",
      metadata: { requestId: "req-backup" }
    });
    store.addMessage({
      sessionId: agent.id,
      role: "assistant",
      content: "backup assistant message",
      parentId: userId,
      metadata: { requestId: "req-backup" }
    });
    store.upsertMemory({
      kind: "fact",
      content: "backup memory fact",
      sourceMessageId: userId,
      metadata: { agentId: agent.id, confirmed: true }
    });
    store.saveModelConfig({ officialUserToken: "secret-user-token", officialLicenseKey: "secret-license" });

    const backup = store.exportUserBackup();
    const serialized = JSON.stringify(backup);
    assert.equal(backup.format, "2link-desktop-backup");
    assert.doesNotMatch(serialized, /secret-user-token|secret-license/);

    store.upsertAgent({ id: "temporary-role", name: "Temporary", isBuiltin: false });
    const restored = store.importUserBackup(backup);
    assert.equal(restored.activeAgentId, agent.id);
    assert.equal(store.getAgent("temporary-role"), null);
    assert.equal(store.getAgent(agent.id).chatBackground.name, "background.png");
    assert.equal(store.getRecentMessages(agent.id, 10).length, 2);
    assert.equal(store.retrieveMemories("backup memory fact", { agentId: agent.id, limit: 4 }).length, 1);
    assert.equal(store.getModelConfig().officialUserToken, "secret-user-token");
    assert.equal(store.getModelConfig().officialLicenseKey, "secret-license");
  });
});

test("mobile-compatible role fields survive desktop persistence", () => {
  withStore((store) => {
    const saved = store.upsertAgent({
      id: "cross-client-fields",
      name: "Cross Client",
      persona: "A custom role.",
      userPersonaEnabled: true,
      userPersona: "我是角色正在聊天的对象。",
      openingSuggestions: ["第一条", "第二条", "第三条", "不应保存的第四条"],
      quickActionsEnabled: true,
      chatBackgroundOverlay: true,
      chatBrandVisible: false,
      responseStyle: "immersive",
      isBuiltin: false
    });

    assert.equal(saved.userPersonaEnabled, true);
    assert.equal(saved.userPersona, "我是角色正在聊天的对象。");
    assert.deepEqual(saved.openingSuggestions, ["第一条", "第二条", "第三条"]);
    assert.equal(saved.quickActionsEnabled, true);
    assert.equal(saved.chatBackgroundOverlay, true);
    assert.equal(saved.chatBrandVisible, false);
    assert.equal(saved.responseStyle, "immersive");

    const historyStyle = store.upsertAgent({ ...saved, responseStyle: "history" });
    assert.equal(historyStyle.responseStyle, "history");
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

test("editing the last user message replaces its assistant reply", () => {
  withStore((store) => {
    const sessionId = "edit-agent";
    const earlierUserId = store.addMessage({ sessionId, role: "user", content: "较早消息" });
    store.addMessage({ sessionId, role: "assistant", content: "较早回复", parentId: earlierUserId });
    const userId = store.addMessage({ sessionId, role: "user", content: "原消息" });
    const assistantId = store.addMessage({ sessionId, role: "assistant", content: "原回复", parentId: userId });

    assert.throws(
      () => store.editLastUserMessage({ sessionId, id: earlierUserId, content: "不能修改" }),
      /Only the last user message/
    );

    const edited = store.editLastUserMessage({ sessionId, id: userId, content: "修改后的消息" });
    assert.equal(edited.content, "修改后的消息");
    assert.equal(edited.metadata.revisions.at(-1).content, "原消息");
    assert.equal(store.getMessage(assistantId).status, "replaced");
    assert.equal(store.getLastActiveAssistantMessage(sessionId).content, "较早回复");
  });
});

test("memory capsules are isolated per agent and update their search chunk", () => {
  withStore((store) => {
    store.saveMemoryCapsule({ agentId: "agent-a", content: "角色叫阿早，用户叫小夏。" });
    store.saveMemoryCapsule({ agentId: "agent-b", content: "角色叫沐里。" });
    assert.equal(store.getMemorySnapshot({ agentId: "agent-a" }).memory_capsule[0].text, "角色叫阿早，用户叫小夏。");
    assert.equal(store.getMemorySnapshot({ agentId: "agent-b" }).memory_capsule[0].text, "角色叫沐里。");

    store.saveMemoryCapsule({ agentId: "agent-a", content: "角色叫阿早，用户叫小夏，约定称呼是队长。" });
    const snapshot = store.getMemorySnapshot({ agentId: "agent-a" });
    assert.equal(snapshot.memory_capsule.length, 1);
    assert.match(snapshot.memory_capsule[0].text, /队长/);
    assert.ok(store.retrieveMemories("约定称呼队长", { agentId: "agent-a" }).some((item) => item.kind === "memory_capsule"));
    assert.equal(store.retrieveMemories("约定称呼队长", { agentId: "agent-b" }).some((item) => /队长/.test(item.content)), false);
  });
});

test("dialogue state persists independently for each agent", () => {
  withStore((store) => {
    store.saveAgentDialogueState("mori", {
      storyMode: true,
      lastUserEvent: "用户推开了门",
      sceneConstraints: { speech: { mode: "silent", scope: "until_released" } }
    });
    const mori = store.getAgent("mori");
    const other = store.getAgent("sharp-friend");
    assert.equal(mori.dialogueState.storyMode, true);
    assert.equal(mori.dialogueState.sceneConstraints.speech.mode, "silent");
    assert.deepEqual(other.dialogueState, {});
  });
});
