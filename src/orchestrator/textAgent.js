import { createCompanionReply } from "../agent.js";

export async function runTextAgent({ character, memory, retrievedMemories = [], retrievalPlan = null, contextPlan = null, message, history = [], llm, traceId = "", turnContext = {}, temporalContext = null, sceneConstraints = null, storyDirective = null, userImage = null }) {
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
    turnContext,
    temporalContext,
    sceneConstraints,
    storyDirective,
    userImage
  });

  return {
    agent: "text_agent",
    reply
  };
}
