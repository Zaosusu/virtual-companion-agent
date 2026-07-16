import { buildImageOutputPlan } from "./imageAgent.js";
import { runContextAgent } from "./contextAgent.js";
import { buildVoiceOutputPlan } from "./voiceAgent.js";
import { routeAgentTurn } from "./routerAgent.js";
import { runTextAgent } from "./textAgent.js";
import { buildTemporalContext } from "./temporalContext.js";
import { buildSceneConstraints, canProduceSpeech, enforceSceneConstraints } from "./sceneConstraints.js";
import { buildStoryDirective, nextDialogueState } from "./storyDirectorAgent.js";

export async function orchestrateCompanionTurn({
  agent,
  character,
  memory,
  retrievedMemories = [],
  retrievalPlan = null,
  message,
  history = [],
  llm,
  modelConfig,
  userImage = null,
  traceId = "",
  turnContext = {}
}) {
  const temporalContext = buildTemporalContext({ history });
  const storyDirective = buildStoryDirective({
    userText: message,
    dialogueState: agent?.dialogueState,
    recentAssistant: history.filter((item) => item.role === "assistant").slice(-3).map((item) => item.content)
  });
  const sceneConstraints = buildSceneConstraints({ userText: message, dialogueState: agent?.dialogueState });
  const contextPlan = await runContextAgent({
    agent,
    character,
    memory,
    retrievedMemories,
    retrievalPlan,
    message,
    history,
    llm,
    traceId,
    turnContext
  });
  const textResult = await runTextAgent({
    character,
    memory,
    retrievedMemories,
    retrievalPlan,
    contextPlan,
    message,
    history,
    llm,
    traceId,
    temporalContext,
    sceneConstraints,
    storyDirective,
    userImage
  });
  const reply = {
    ...textResult.reply,
    text: enforceSceneConstraints(textResult.reply?.text, sceneConstraints)
  };
  const router = routeAgentTurn({
    userText: message,
    reply,
    modelConfig
  });
  const outputs = await buildOutputPlan({
    agent,
    character,
    reply,
    router,
    userText: message,
    history,
    llm,
    sceneConstraints
  });

  return {
    reply,
    orchestration: {
      version: "orchestrator-v1",
      router,
      agents: {
        context_agent: summarizeContextAgent(contextPlan),
        memory_agent: summarizeMemoryAgent(retrievalPlan),
        text_agent: {
          enabled: true,
          source: reply.source || "local",
          responseProfile: reply.responseProfile || null
        },
        image_agent: router.imageAgent,
        voice_agent: router.voiceAgent,
        review_agent: summarizeReviewAgent(outputs),
        scene_constraints: sceneConstraints,
        story_director_agent: storyDirective
      },
      outputs
    },
    temporalContext,
    sceneConstraints,
    storyDirective,
    dialogueState: nextDialogueState({ previous: agent?.dialogueState, directive: storyDirective, sceneConstraints })
  };
}

function summarizeMemoryAgent(retrievalPlan) {
  return {
    enabled: Boolean(retrievalPlan),
    quality: retrievalPlan?.quality || "unknown",
    strictEvidence: Boolean(retrievalPlan?.strictEvidence),
    rewrittenQuery: retrievalPlan?.rewrittenQuery || "",
    evidenceCount: retrievalPlan?.evidenceCount || 0,
    rejectedCount: retrievalPlan?.rejectedCount || 0
  };
}

function summarizeContextAgent(contextPlan) {
  return {
    enabled: true,
    reviewer: contextPlan?.reviewer || "unknown",
    characterFacts: contextPlan?.characterFacts?.length || 0,
    userMemory: contextPlan?.userMemory?.length || 0,
    styleHints: contextPlan?.styleHints?.length || 0,
    blockedFacts: contextPlan?.blockedFacts?.length || 0,
    warnings: contextPlan?.warnings || []
  };
}

function summarizeReviewAgent(outputs = []) {
  const reviews = outputs
    .map((output) => output.review)
    .filter(Boolean);
  return {
    enabled: reviews.length > 0,
    reviews
  };
}

async function buildOutputPlan({ agent, character, reply, router, userText, history, llm, sceneConstraints = null }) {
  const shouldRenderText = reply.source !== "tool:image.generate" && !router.voiceAgent?.enabled;
  const outputs = [];
  const imagePlan = buildImageOutputPlan({ reply, router, userText, history, character });
  const imageDelivery = imagePlan?.delivery || null;

  if (reply.source === "tool:image.generate" && imageDelivery?.mode === "text_before_image" && imageDelivery.text) {
    outputs.push({
      type: "text",
      agent: "text_agent",
      text: imageDelivery.text,
      source: "image_delivery",
      delivery: imageDelivery
    });
  }

  if (shouldRenderText && String(reply.text || "").trim()) {
    outputs.push({
      type: "text",
      agent: "text_agent",
      text: reply.text,
      source: reply.source || "local"
    });
  }

  if (imagePlan) outputs.push(imagePlan);

  const voicePlan = canProduceSpeech(sceneConstraints)
    ? await buildVoiceOutputPlan({ reply, router, userText, history, agent, character, llm })
    : null;
  if (voicePlan) outputs.push(voicePlan);

  return outputs;
}

export { routeAgentTurn } from "./routerAgent.js";
export { buildVoiceAgentDecision } from "./voiceAgent.js";
