import { createCompanionReply } from "../agent.js";

export async function runTextAgent({ character, memory, retrievedMemories = [], contextPlan = null, message, history = [], llm, traceId = "" }) {
  const reply = await createCompanionReply({
    character,
    memory,
    retrievedMemories,
    contextPlan,
    message,
    history,
    llm,
    traceId
  });

  return {
    agent: "text_agent",
    reply
  };
}
