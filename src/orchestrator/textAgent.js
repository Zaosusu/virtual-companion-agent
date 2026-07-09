import { createCompanionReply } from "../agent.js";

export async function runTextAgent({ character, memory, retrievedMemories = [], retrievalPlan = null, contextPlan = null, message, history = [], llm, traceId = "", turnContext = {} }) {
  const reply = await createCompanionReply({
    character,
    memory,
    retrievedMemories,
    retrievalPlan,
    contextPlan,
    message,
    history,
    llm,
    traceId,
    turnContext
  });

  return {
    agent: "text_agent",
    reply
  };
}
