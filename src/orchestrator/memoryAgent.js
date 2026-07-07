import { buildTurnSummary, compressConversation, extractMemoryCandidates } from "../agent.js";

export {
  buildTurnSummary,
  compressConversation,
  extractMemoryCandidates
};

export function buildMemoryWritePlan({ agentId, message, reply = {}, userMessageId, assistantMessageId }) {
  const writes = extractMemoryCandidates(message).map((candidate) => ({
    ...candidate,
    sourceMessageId: userMessageId,
    metadata: { bucket: candidate.bucket, extractedBy: "regex-v0", agentId }
  }));

  if (reply.safety?.level === "crisis") {
    writes.push({
      kind: "safety_note",
      text: "危机安全提示",
      content: "用户曾出现可能涉及自伤/轻生的表达，后续陪伴需要优先关注现实安全与求助路径。",
      importance: 0.95,
      confidence: 0.65,
      sourceMessageId: userMessageId,
      metadata: { safetyLevel: "crisis", agentId }
    });
  }

  writes.push({
    kind: "summary",
    content: buildTurnSummary({ message, reply }),
    importance: 0.35,
    confidence: 0.65,
    sourceMessageId: assistantMessageId || userMessageId,
    metadata: { workflow: reply.workflow, mood: reply.mood, agentId }
  });

  return writes;
}
