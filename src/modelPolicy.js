const RESPONSE_STYLES = ["balanced", "vivid", "dream", "lover", "reserved", "story"];

export function buildResponseProfile({ character = {}, message = "", history = [], retrievalPlan = null, safety = {}, workflow = "companionship", mood = "平稳", turnContext = {} }) {
  const runtime = character.runtime_config || {};
  const style = normalizeResponseStyle(runtime.responseStyle);
  const creativity = normalizeRatio(runtime.creativityLevel, 0.6);
  const replyLength = normalizeRatio(runtime.replyLength, 0.35);
  const recentAssistant = history
    .filter((item) => item.role === "assistant")
    .slice(-3)
    .map((item) => String(item.content || "").slice(0, 160));
  const strict = Boolean(retrievalPlan?.strictEvidence);
  const highRisk = safety.level === "crisis" || safety.level === "bounded";
  const concise = workflow === "plan" || workflow === "reflection";
  const dreamLike = style === "dream" || style === "story" || workflow === "creative";
  const intimate = style === "lover" || /想你|抱抱|亲|撒娇|吃醋|梦女|男友|女友|恋人/.test(message);

  let expressiveness = creativity;
  if (dreamLike) expressiveness += 0.16;
  if (intimate) expressiveness += 0.1;
  if (style === "vivid") expressiveness += 0.12;
  if (style === "reserved") expressiveness -= 0.18;
  if (concise) expressiveness -= 0.08;
  if (strict) expressiveness -= 0.24;
  if (highRisk) expressiveness -= 0.3;
  expressiveness = clamp(expressiveness, 0.15, 1);

  const strategy = responseStrategy({ style, workflow, mood, strict, highRisk, intimate, dreamLike });
  const lengthProfile = decideLengthProfile({ replyLength, style, workflow, strict, highRisk, dreamLike, intimate });
  const sampling = decideTextSampling({ expressiveness, creativity, style, workflow, strict, highRisk, dreamLike, intimate });
  const narrativeRhythm = decideNarrativeRhythm({
    style,
    workflow,
    message,
    history,
    recentAssistant,
    strict,
    highRisk,
    dreamLike,
    intimate,
    turnContext
  });

  return {
    style,
    creativityLevel: creativity,
    replyLength,
    expressiveness,
    strategy,
    lengthProfile,
    narrativeRhythm,
    sampling,
    antiRepetition: {
      recentAssistant,
      bannedOpeners: ["我在", "慢慢来", "别太勉强自己", "我陪着你", "没事的"],
      rule: "不要连续复用相同开头、相同安慰句式或同一种收束问题。"
    }
  };
}

export function buildAgentModelRequest({ model, messages, task = "text_reply", sampling = null, maxTokens = null }) {
  const policy = modelTaskPolicy(task);
  const body = {
    model,
    messages,
    max_tokens: maxTokens || policy.maxTokens
  };
  assignSampling(body, sampling || policy.sampling);
  if (supportsReasoningEffort(model) && policy.reasoningEffort) {
    body.reasoning_effort = policy.reasoningEffort;
  }
  return body;
}

export function resolveImageGenerationPolicy({ model = "", imageConfig = {}, referenceImage = null } = {}) {
  const cleanModel = String(model || imageConfig.model || "").trim();
  const isEdit = Boolean(referenceImage?.data && cleanModel === "step-image-edit-2");
  return {
    size: imageConfig.size || "1024x1024",
    steps: numberOr(imageConfig.steps, isEdit ? 8 : isStepFunModel(cleanModel) ? 50 : undefined),
    cfgScale: numberOr(imageConfig.cfgScale ?? imageConfig.cfg_scale, isEdit ? 1 : cleanModel === "step-2x-large" ? 6 : isStepFunModel(cleanModel) ? 7.5 : undefined),
    styleReferenceWeight: numberOr(imageConfig.styleReferenceWeight, 1.35),
    textMode: imageConfig.textMode ?? imageConfig.text_mode ?? !isEdit,
    promptLimit: isStepFunModel(cleanModel) ? 512 : 4000
  };
}

export function normalizeResponseStyle(value) {
  const style = String(value || "").trim();
  return RESPONSE_STYLES.includes(style) ? style : "balanced";
}

function modelTaskPolicy(task) {
  const policies = {
    text_reply: {
      sampling: {},
      maxTokens: 700,
      reasoningEffort: "low"
    },
    context_classification: {
      sampling: { temperature: 0.1 },
      maxTokens: 900,
      reasoningEffort: "low"
    },
    review_gate: {
      sampling: { temperature: 0.2 },
      maxTokens: 360,
      reasoningEffort: "low"
    },
    vision_appearance: {
      sampling: { temperature: 0.2 },
      maxTokens: 1200,
      reasoningEffort: "low"
    }
  };
  return policies[task] || policies.text_reply;
}

function responseStrategy({ style, workflow, mood, strict, highRisk, intimate, dreamLike }) {
  if (highRisk) {
    return {
      label: "安全收敛",
      instruction: "优先安全、事实边界和现实支持；语气可以温柔，但不要戏剧化、暧昧化或制造依赖。"
    };
  }
  if (strict) {
    return {
      label: "证据优先",
      instruction: "事实回答必须收敛；可以保留角色语气，但不要为了生动补不存在的经历、时间、地点或细节。"
    };
  }
  if (style === "dream" || dreamLike) {
    return {
      label: "梦向剧情",
      instruction: "允许进入场景、补画面和动作细节；用具体环境、表情、停顿和互动推进，而不是只安慰。"
    };
  }
  if (style === "lover" || intimate) {
    return {
      label: "恋人互动",
      instruction: "可以有轻微吃醋、逗弄、黏人和在乎的情绪反应；保持尊重边界，不做现实承诺或控制。"
    };
  }
  if (style === "reserved") {
    return {
      label: "克制冷感",
      instruction: "表达更短、更稳、更克制；少说教，用一句判断加一个具体追问推进。"
    };
  }
  if (style === "vivid") {
    return {
      label: "生动陪伴",
      instruction: "允许调侃、主动追问、情绪反应和具体生活细节；避免心理咨询式固定安慰。"
    };
  }
  const byWorkflow = {
    comfort: "先准确命名用户情绪，再给一个不重复的具体回应，最后问一个能继续聊下去的问题。",
    daily_checkin: "主动展开短句，不要只说在；给一个轻量互动或小仪式感。",
    creative: "给更有画面和选择感的回应，允许多版本和发散。",
    plan: "保持清晰，但不要机械列表；先判断卡点，再拆一个最小动作。",
    reflection: "复盘时保留角色态度，先抓情绪再整理事件。"
  };
  return {
    label: "自然平衡",
    instruction: byWorkflow[workflow] || `根据当前情绪「${mood}」自然回应，加入一个新的具体细节、情绪判断或互动动作。`
  };
}

function decideLengthProfile({ replyLength, style, workflow, strict, highRisk, dreamLike, intimate }) {
  if (highRisk) {
    return {
      label: "安全短回复",
      target: "2-4 句",
      instruction: "优先短句、明确安全步骤和现实求助；不要长篇沉浸描写。",
      maxTokens: 420,
      actionDensity: "none",
      allowFollowupQuestion: true
    };
  }
  if (strict) {
    return {
      label: "事实短回复",
      target: "2-4 句",
      instruction: "只说证据支持的结论；证据不足时短句说明不知道，不展开编故事。",
      maxTokens: 360,
      actionDensity: "low",
      allowFollowupQuestion: true
    };
  }

  let value = replyLength;
  if (style === "reserved") value -= 0.12;
  if (workflow === "plan" || workflow === "reflection") value -= 0.08;
  if (dreamLike || intimate) value += 0.06;
  value = clamp(value, 0, 1);

  if (value <= 0.22) {
    return {
      label: "很短",
      target: "1-2 句",
      instruction: "用 1-2 句完成本轮回应；只保留一个核心情绪或动作，不铺陈环境，不连续追问。",
      maxTokens: 180,
      actionDensity: "minimal",
      allowFollowupQuestion: false
    };
  }
  if (value <= 0.45) {
    return {
      label: "偏短",
      target: "2-4 句",
      instruction: "默认 2-4 句；动作描写最多一句，台词承担主要信息；不要写成长段独白。",
      maxTokens: 320,
      actionDensity: "low",
      allowFollowupQuestion: true
    };
  }
  if (value <= 0.72) {
    return {
      label: "适中",
      target: "4-7 句",
      instruction: "可以展开一小段，但要围绕一个情绪点或一个场景推进；避免多段连续动作。",
      maxTokens: 620,
      actionDensity: "medium",
      allowFollowupQuestion: true
    };
  }
  return {
    label: "详细",
    target: "7-12 句",
    instruction: "允许更完整的剧情和画面，但仍要有重点；不要为了凑长度重复安慰或堆动作。",
    maxTokens: 1050,
    actionDensity: "high",
    allowFollowupQuestion: true
  };
}

function decideTextSampling({ expressiveness, creativity, style, workflow, strict, highRisk, dreamLike, intimate }) {
  if (highRisk) {
    return {
      temperature: 0.45,
      top_p: 0.82,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      reason: "high_risk_boundary"
    };
  }
  if (strict) {
    return {
      temperature: round2(0.48 + (creativity * 0.12)),
      top_p: 0.84,
      presence_penalty: 0.05,
      frequency_penalty: 0.18,
      reason: "strict_evidence"
    };
  }
  let temperature = 0.58 + (expressiveness * 0.45);
  let topP = 0.86 + (expressiveness * 0.12);
  let presencePenalty = 0.18 + (expressiveness * 0.35);
  let frequencyPenalty = 0.22 + (expressiveness * 0.32);
  if (dreamLike) {
    temperature += 0.06;
    presencePenalty += 0.08;
  }
  if (intimate) temperature += 0.03;
  if (style === "reserved" || workflow === "plan") {
    temperature -= 0.08;
    topP -= 0.04;
  }
  return {
    temperature: round2(clamp(temperature, 0.55, 1.08)),
    top_p: round2(clamp(topP, 0.82, 0.98)),
    presence_penalty: round2(clamp(presencePenalty, 0.1, 0.75)),
    frequency_penalty: round2(clamp(frequencyPenalty, 0.12, 0.72)),
    reason: "agent_dynamic_response_profile"
  };
}

function decideNarrativeRhythm({ style, workflow, message, history, recentAssistant, strict, highRisk, dreamLike, intimate, turnContext }) {
  if (highRisk || strict) {
    return {
      mode: "plain_dialogue",
      label: "直接回应",
      instruction: "以清晰台词和事实边界为主，不做沉浸式动作表演，不用长括号动作开头。"
    };
  }

  const recentActionFirstCount = recentAssistant.filter(startsWithActionBlock).length;
  const justUsedActionFirst = recentAssistant.slice(-2).some(startsWithActionBlock);
  const needsScene = dreamLike || intimate || /抱|牵|靠|亲|摸|梦|剧情|场景|陪我|哄/.test(String(message || ""));
  const concise = workflow === "plan" || workflow === "reflection";
  const variantIndex = Number(turnContext?.variantIndex || 0);
  const seed = hashText([
    style,
    workflow,
    message,
    history.length,
    variantIndex,
    recentAssistant.map((item) => item.slice(0, 24)).join("|")
  ].join("::"));

  if (concise && !needsScene) {
    return pickBySeed([
      rhythm("dialogue_first", "先回应再补动作", "先给角色真正说出口的话，再用一句很短的神态或动作收住。"),
      rhythm("plain_dialogue", "纯对白推进", "这一轮少写或不写括号动作，用语气、称呼和具体追问推进。")
    ], seed);
  }

  let candidates = needsScene
    ? [
      rhythm("dialogue_first", "对白开场", "先让角色说话，再补一个短动作或环境反应。"),
      rhythm("dialogue_action_dialogue", "对白-动作-对白", "用一句台词接住用户，中间插入短动作，最后再说一句推进关系或场景的话。"),
      rhythm("action_dialogue_action", "动作-对白-动作", "可以用短动作带入，但动作块不要长；台词必须承担主要情绪和信息。"),
      rhythm("action_first_short", "短动作开场", "只允许一句短动作开头，马上进入台词；不要整段括号动作铺陈。")
    ]
    : [
      rhythm("dialogue_first", "对白开场", "先回应用户，再视需要补一个短动作。"),
      rhythm("plain_dialogue", "纯对白推进", "这一轮不写括号动作，用自然口语和具体细节推进。"),
      rhythm("dialogue_action_dialogue", "对白-动作-对白", "不要从动作开头；用短动作作为中间的停顿或情绪变化。")
    ];

  if (style === "reserved") {
    candidates = candidates.filter((item) => item.mode !== "action_dialogue_action" && item.mode !== "action_first_short");
  }

  if (justUsedActionFirst || recentActionFirstCount >= 2 || turnContext?.regenerate) {
    candidates = candidates.filter((item) => item.mode !== "action_first_short" && item.mode !== "action_dialogue_action");
  }

  return pickBySeed(candidates.length ? candidates : [rhythm("dialogue_first", "对白开场", "先说话，再用极短动作补充情绪。")], seed);
}

function rhythm(mode, label, instruction) {
  return { mode, label, instruction };
}

function startsWithActionBlock(text) {
  return /^[\s"'“”]*[（(]/.test(String(text || ""));
}

function pickBySeed(items, seed) {
  return items[Math.abs(seed) % items.length];
}

function hashText(text) {
  let hash = 0;
  for (const char of String(text || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return hash;
}

function assignSampling(body, sampling = {}) {
  for (const [key, value] of Object.entries(sampling || {})) {
    if (["temperature", "top_p", "presence_penalty", "frequency_penalty"].includes(key) && Number.isFinite(Number(value))) {
      body[key] = Number(value);
    }
  }
}

function supportsReasoningEffort(model) {
  return ["step-3.7-flash", "step-3.5-flash-2603", "step-3.5-flash"].includes(String(model || ""));
}

function isStepFunModel(model) {
  return String(model || "").startsWith("step-");
}

function normalizeRatio(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(number, 0, 1);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Number(value.toFixed(2));
}
