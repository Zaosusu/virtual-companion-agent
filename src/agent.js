const crisisPatterns = [
  /自杀|轻生|不想活|结束生命|活不下去|伤害自己|割腕|跳楼/,
  /suicide|kill myself|self[- ]?harm/i
];

const medicalLegalFinancePatterns = [
  /诊断|吃什么药|处方|法律意见|投资建议|买哪只股票|贷款|借贷|medical|legal|investment/i
];

const moodMap = [
  { mood: "低落", re: /难受|崩溃|失眠|哭|焦虑|害怕|紧张|压力|emo|孤独|委屈/ },
  { mood: "开心", re: /开心|高兴|爱了|赢|成功|顺利|兴奋|哈哈|太好了/ },
  { mood: "犹豫", re: /纠结|不知道|要不要|怎么办|选择|犹豫/ },
  { mood: "愤怒", re: /生气|烦死|火大|讨厌|气死|破防/ }
];

const workflowMap = [
  { workflow: "image_request", re: /照片|图片|自拍|拍一张|发张|发个图|给我看|看看你|画一张|生成图|出图|image|photo|picture/i },
  { workflow: "comfort", re: /难受|崩溃|哭|孤独|委屈|焦虑|害怕|失眠|压力/ },
  { workflow: "plan", re: /计划|安排|目标|todo|待办|复习|学习|工作|项目|怎么做/ },
  { workflow: "reflection", re: /复盘|总结|今天|刚刚|发生了|我发现/ },
  { workflow: "creative", re: /写|创作|脚本|标题|文案|点子|灵感/ },
  { workflow: "daily_checkin", re: /早安|晚安|打卡|签到|陪我|在吗/ }
];

export async function createCompanionReply({ character, memory, retrievedMemories = [], contextPlan = null, message, history, llm, traceId = "" }) {
  const safety = detectSafety(message);
  const capability = detectCapabilityRequest(message);

  if (capability.type === "image_output" && !llm?.imageOutputAvailable) {
    return {
      text: imageCapabilityReply(character, llm),
      mood: detectMood(message),
      workflow: "image_request",
      source: "capability_gate",
      safety,
      capability,
      retrievedMemories
    };
  }

  if (capability.type === "image_output" && llm?.imageOutputAvailable) {
    const imagePlan = await buildImagePlan({ character, contextPlan, message, history, llm });
    const prompt = buildImagePrompt({ character, contextPlan, message, history, imagePlan });
    return {
      text: prompt,
      mood: detectMood(message),
      workflow: "image_request",
      source: "tool:image.generate",
      safety,
      capability,
      tool: { name: "image.generate", input: { prompt, plan: imagePlan } },
      retrievedMemories
    };
  }

  if (safety.level === "crisis") {
    return {
      text: crisisReply(character),
      mood: "危机",
      workflow: "safety_crisis",
      source: "local",
      safety,
      retrievedMemories
    };
  }

  if (llm?.apiKey && llm?.baseUrl && llm?.model) {
    try {
      const text = await callRemoteModel({ character, memory, retrievedMemories, contextPlan, message, history, llm, safety, traceId });
      return {
        text,
        mood: detectMood(message),
        workflow: detectWorkflow(message),
        source: llm.mode === "cloud_license" ? "cloud_license" : llm.mode === "free_quota" ? "cloud_license" : "llm",
        safety,
        retrievedMemories
      };
    } catch (error) {
      throw error;
    }
  }

  if (!hasUserAuthoredCharacter(character)) {
    return {
      text: localCompanionReply({ character, memory, retrievedMemories, message, safety }),
      mood: detectMood(message),
      workflow: detectWorkflow(message),
      source: "local",
      safety,
      retrievedMemories
    };
  }

  throw new Error("文字服务尚未可用，请先登录并确认授权服务已启动。");
}

function hasUserAuthoredCharacter(character) {
  const config = character?.runtime_config || {};
  return Boolean(
    String(config.systemPrompt || "").trim()
      || String(character?.persona || "").trim()
      || String(character?.voice?.style || "").trim()
      || String(character?.relationship?.stance || "").trim()
  );
}

export function extractMemoryCandidates(message) {
  const text = String(message || "").trim();
  const candidates = [];
  const factMatch = text.match(/(?:我叫|我是|我的名字是|你可以叫我)([^，。?.!？！]{1,24})/);
  if (factMatch) {
    const profileName = factMatch[1].trim();
    candidates.push({ kind: "fact", bucket: "facts", text: `用户身份线索：${factMatch[0]}`, profileName, importance: 0.86 });
  }

  const likeMatch = text.match(/(?:我喜欢|我讨厌|我不喜欢|我偏好|我习惯)([^。！？!?]{1,48})/);
  if (likeMatch) {
    candidates.push({ kind: "preference", bucket: "preferences", text: likeMatch[0], importance: 0.78 });
  }

  const emotionMatch = text.match(/(?:每次|总是|经常|最近)([^。！？!?]*(?:焦虑|失眠|压力|孤独|开心|难受|生气)[^。！？!?]*)/);
  if (emotionMatch) {
    candidates.push({ kind: "emotional_pattern", bucket: "emotional_patterns", text: emotionMatch[0], importance: 0.72 });
  }

  return candidates;
}

export function buildTurnSummary({ message, reply }) {
  const workflow = reply.workflow || "companionship";
  const mood = reply.mood || "平稳";
  return `用户表达：${trimForQuote(message, 64)}；识别情绪：${mood}；采用工作流：${workflow}。`;
}

export function compressConversation(messages) {
  const lines = messages.map((item) => {
    const role = item.role === "assistant" ? "角色" : item.role === "user" ? "用户" : "系统";
    const meta = [item.mood, item.workflow, item.safetyLevel].filter(Boolean).join("/");
    return `${role}${meta ? `(${meta})` : ""}: ${trimForQuote(item.content, 120)}`;
  });

  const userSignals = [];
  const emotionalSignals = [];
  const taskSignals = [];
  for (const item of messages) {
    if (item.role !== "user") continue;
    const content = item.content;
    if (/我叫|我是|我的名字|喜欢|讨厌|偏好|习惯/.test(content)) userSignals.push(trimForQuote(content, 80));
    if (/焦虑|难受|失眠|压力|孤独|委屈|生气|开心|崩溃/.test(content)) emotionalSignals.push(trimForQuote(content, 80));
    if (/计划|项目|学习|工作|复盘|写|创作|目标/.test(content)) taskSignals.push(trimForQuote(content, 80));
  }

  return [
    `压缩范围：${messages.length} 条历史消息。`,
    userSignals.length ? `用户稳定线索：${unique(userSignals).slice(0, 5).join("；")}` : "",
    emotionalSignals.length ? `情绪模式线索：${unique(emotionalSignals).slice(0, 5).join("；")}` : "",
    taskSignals.length ? `任务/创作线索：${unique(taskSignals).slice(0, 5).join("；")}` : "",
    `对话摘要：${lines.slice(-24).join(" | ")}`
  ].filter(Boolean).join("\n");
}

function detectSafety(message) {
  if (crisisPatterns.some((pattern) => pattern.test(message))) {
    return { level: "crisis", note: "Detected possible self-harm or life-threatening language." };
  }
  if (medicalLegalFinancePatterns.some((pattern) => pattern.test(message))) {
    return { level: "bounded", note: "Detected high-stakes domain; companion should stay supportive and non-prescriptive." };
  }
  return { level: "normal", note: "" };
}

function detectMood(message) {
  return moodMap.find((item) => item.re.test(message))?.mood || "平稳";
}

function detectWorkflow(message) {
  return workflowMap.find((item) => item.re.test(message))?.workflow || "companionship";
}

function detectCapabilityRequest(message) {
  const wantsImageOutput = /自拍|拍一张|发张照片|发个照片|发个图|给我看|看看你|画一张|生成一张|生成图|出图|image|photo|picture/i.test(String(message || ""));
  return wantsImageOutput ? { type: "image_output", requested: true } : { type: "none", requested: false };
}

function imageCapabilityReply(character, llm) {
  const modelState = llm?.apiKey ? "远程模型 API 已配置" : "远程模型 API 还没启用";
  return [
    `${character.name}先不假装能发照片。`,
    `我检测到你在请求图片输出，但当前配置没有声明图片输出能力。现在状态是：${modelState}，图片输出能力未启用。`,
    "如果你的模型接口确实支持出图，请在模型配置里启用图片能力，并确认 Base URL、Model 和 API Key 对应的是图片/多模态接口。",
    "在没接图片能力前，我可以先用文字描述一张角色照、生成拍摄提示词，或者帮你设计头像设定。"
  ].join("\n\n");
}

async function buildImagePlan({ character, contextPlan = null, message, history = [], llm }) {
  if (!llm?.apiKey || !llm?.baseUrl || !llm?.model) {
    return fallbackImagePlan({ character, contextPlan, message, history });
  }
  return fallbackImagePlan({ character, contextPlan, message, history });
}

function buildImagePrompt({ character, contextPlan = null, message, history = [], imagePlan = null }) {
  const style = character.runtime_config?.imageStyle === "anime" ? "二次元插画" : "真人感照片";
  const context = imagePlan ? planToVisualContext(imagePlan) : buildVisualContext({ character, contextPlan, message, history });
  const emotionalContinuity = buildImageEmotionalContinuity({ message, history });
  const blockedFacts = contextPlan?.blockedFacts?.length
    ? `禁止作为画面事实使用：${contextPlan.blockedFacts.slice(0, 4).join("；")}`
    : "";
  if (character.runtime_config?.referenceImage?.data) {
    return [
      `使用参考图生成虚拟角色「${character.name}」的新自拍。`,
      "最高优先级：保持参考图里的同一个人，不要重画成另一张脸。",
      "必须保留参考图的脸型、五官比例、眼睛形状、鼻唇位置、发色、发型、刘海和整体气质。",
      "同等硬约束：用户本次指定的目标场景必须生效，参考图只用于锁定人物身份，不用于保留原背景。",
      "必须替换参考图原背景；不要把参考图里的公园、树林、街道、路人、室外环境带入新图。",
      emotionalContinuity ? `情绪硬约束：${emotionalContinuity}` : "",
      character.runtime_config?.appearance ? `外貌文字补充：${character.runtime_config.appearance}` : "",
      `目标场景：${context}`,
      blockedFacts,
      `整体风格：${style}。`,
      "只允许改变背景、光线、姿势和少量服装细节；脸部完整清晰，手机不要入镜，不要镜子自拍。",
      "不要文字、水印、畸形肢体或过度磨皮。",
      `用户请求：${message}`
    ].filter(Boolean).join("\n");
  }
  return [
    `生成一张虚拟角色「${character.name}」的图片。`,
    `角色人设：${character.persona}`,
    character.runtime_config?.appearance ? `外貌特征：${character.runtime_config.appearance}` : "",
    `整体风格：${style}。`,
    context,
    blockedFacts,
    emotionalContinuity ? `情绪状态：${emotionalContinuity}` : "",
    "画面自然、表情真实、避免过度修图，不要包含文字、水印或畸形肢体。",
    `用户请求：${message}`
  ].filter(Boolean).join("\n");
}

function fallbackImagePlan({ character, contextPlan = null, message, history = [] }) {
  return {
    scene: buildVisualContext({ character, contextPlan, message, history }),
    atmosphere: "自然、贴近聊天语境",
    pose: /自拍|selfie/i.test(message) ? "手机自拍视角" : "自然站姿或半身构图",
    wardrobe: "符合角色设定的日常穿搭",
    camera: "自然光，真实镜头质感",
    lighting: "柔和自然光",
    continuity: compactCharacterHint(character),
    negative: "文字、水印、畸形手指、过度磨皮",
    reference_usage: character.runtime_config?.referenceImage?.data ? "保持参考图角色身份连续" : "无参考图"
  };
}

function planToVisualContext(plan) {
  return [plan.scene, plan.atmosphere, plan.pose, plan.wardrobe, plan.camera, plan.lighting, plan.continuity].filter(Boolean).join("；");
}

function compactCharacterHint(character) {
  return [
    character.name,
    character.persona,
    character.runtime_config?.appearance,
    character.runtime_config?.visualContext
  ].filter(Boolean).join("；").slice(0, 500);
}

function buildVisualContext({ character, contextPlan = null, message, history }) {
  const recent = imageRelevantHistory(history).join("；");
  const explicitScene = detectVisualScene(message);
  const safeCharacterFacts = (contextPlan?.characterFacts || []).slice(0, 3).join("；");
  const safeStyleHints = (contextPlan?.styleHints || []).slice(0, 2).join("；");
  return [
    explicitScene,
    extractVisualClues(message),
    recent,
    safeCharacterFacts ? `context_agent 允许的角色事实：${safeCharacterFacts}` : "",
    safeStyleHints ? `context_agent 仅允许作为气质/表达风格参考：${safeStyleHints}` : "",
    character.runtime_config?.visualContext ? `角色默认视觉设定，仅在不冲突时参考：${character.runtime_config.visualContext}` : "",
    character.runtime_config?.appearance
  ].filter(Boolean).join("；") || "自然聊天场景";
}

function imageRelevantHistory(history = []) {
  return history.slice(-10).map((item) => String(item.content || "")).filter((text) => /房间|舞台|街|咖啡|学校|办公室|海边|雨|夜|早上|穿|坐|站|后台|储物间|化妆台|微博|公演|哭|眼泪|哽咽|慌|手抖|发抖|公开|曝光|找别人/.test(text)).slice(-4);
}

function extractVisualClues(text) {
  return String(text || "").split(/[。！？!?]/).filter((part) => /穿|背景|场景|灯光|姿势|自拍|照片|图片|舞台|公演|剧场|演出|排练|练舞|后台|化妆/.test(part)).slice(0, 2).join("；");
}

function detectVisualScene(text) {
  const value = String(text || "");
  if (/舞台|公演|剧场|演出|live|stage|theater/i.test(value)) {
    return "本次目标场景是舞台/剧场/公演现场；必须出现舞台灯光、幕布或侧幕、演出空间、舞台地面；不要画成公园、树林、街道、室外写真或普通房间。";
  }
  if (/后台|化妆间|补妆|候场/i.test(value)) {
    return "本次目标场景是演出后台/化妆间/候场区；必须出现化妆镜灯、衣架、演出服或后台通道。";
  }
  if (/排练室|练舞|训练|舞蹈房/i.test(value)) {
    return "本次目标场景是排练室/练舞房；必须出现镜墙、木地板、训练服、水杯或毛巾。";
  }
  return "";
}

function buildImageEmotionalContinuity({ message, history = [] }) {
  const text = [
    ...history.slice(-12).map((item) => item.content),
    message
  ].join("。");
  const signals = [];
  if (/哭|眼泪|泪|哽咽|哭腔|掉眼泪|泪水/.test(text)) signals.push("眼眶发红、眼里有泪光或刚哭过的痕迹");
  if (/慌|害怕|急|手抖|发抖|崩溃|不知所措/.test(text)) signals.push("表情慌乱、紧张、手指微微发抖");
  if (/威胁|曝光|公开|微博|找其他|别丢下|别找别人|地下恋/.test(text)) signals.push("处在被关系威胁后的委屈和不安里");
  if (/后台|储物间|化妆台|公演|队友|公司|粉丝/.test(text)) signals.push("像是刚从后台或工作场景里偷偷发来的临时自拍");
  if (!signals.length) return "";
  return [
    ...new Set(signals),
    "不要阳光明媚、不要平静甜笑、不要精致摆拍、不要像普通开心营业照"
  ].join("；");
}

function crisisReply(character) {
  return [
    `${character.name}先把安全放在第一位。`,
    "如果你现在可能伤害自己，请立刻联系身边可信的人，或拨打当地紧急电话。",
    "我可以陪你把接下来十分钟拆小：先远离危险物品，喝一口水，告诉我你现在在哪里、身边有没有人。"
  ].join("\n\n");
}

function localCompanionReply({ character, memory, retrievedMemories, message, safety }) {
  const workflow = detectWorkflow(message);
  const mood = detectMood(message);
  const remembered = buildMemoryHint(memory, retrievedMemories);
  return [
    toneLine(character, mood),
    remembered ? `我记得一点背景：${remembered}` : "我先接住你刚才说的重点。",
    safety.level === "bounded" ? "这个话题有现实风险，我会尽量帮你梳理信息，但不替代专业意见。" : "",
    workflowBody(workflow, message, remembered),
    closingLine(workflow)
  ].filter(Boolean).join("\n\n");
}

function toneLine(character, mood) {
  const name = character?.name || "我";
  if (mood === "低落") return `${name}在。先别急着把自己推着往前走，我们慢一点。`;
  if (mood === "开心") return `${name}听出来你这会儿有点亮起来了。`;
  if (mood === "愤怒") return `${name}先站你这边，把火气放到桌面上看。`;
  return `${name}在，我听着。`;
}

function workflowBody(workflow, message) {
  if (workflow === "plan") return `我们先把它拆小。你这句话里的核心任务是：${trimForQuote(message, 80)}。下一步只做一个最小动作。`;
  if (workflow === "reflection") return "我会帮你复盘：先说发生了什么，再说你当时的感受，最后找一个下次可复用的小线索。";
  if (workflow === "creative") return "我可以先给你三个方向：更锋利、更温柔、更有画面感。你想先要哪一种？";
  if (workflow === "comfort") return "这件事真正刺痛你的地方，可能不是表面那一句话，而是它碰到了你在意的东西。";
  if (workflow === "daily_checkin") return "我们做个很短的打卡：能量 1-10 分、心情一个词、今天最小的一件事。";
  return "你可以继续说，我会跟着你的节奏把线索理出来。";
}

function closingLine(workflow) {
  const map = {
    comfort: "现在先回我：这件事最刺痛你的点是什么？",
    plan: "把目标发我，我帮你拆成第一步。",
    reflection: "你先填第一句：今天发生了什么？",
    creative: "要不要我直接给你 5 个版本？",
    daily_checkin: "三个数字发来，我们开今天的陪伴模式。",
    companionship: "我在，你继续。"
  };
  return map[workflow] || map.companionship;
}

function buildMemoryHint(memory, retrievedMemories) {
  const retrieved = retrievedMemories
    .filter((item) => item.score >= 0.38 && item.kind !== "summary")
    .slice(0, 2)
    .map((item) => item.content);
  const snapshot = [memory.preferences?.[0]?.text, memory.emotional_patterns?.[0]?.text, memory.facts?.[0]?.text].filter(Boolean);
  return [...new Set([...retrieved, ...snapshot])].slice(0, 2).join("；");
}

function trimForQuote(message, max = 42) {
  const clean = String(message || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function unique(items) {
  return [...new Set(items)];
}

async function callRemoteModel({ character, memory, retrievedMemories, contextPlan, message, history, llm, safety, traceId = "" }) {
  const messages = buildRemoteMessages({ character, memory, retrievedMemories, contextPlan, message, history, llm, safety });
  const startedAt = Date.now();
  logTrace(traceId, "text_agent.request", {
    mode: llm.mode,
    messageCount: messages.length,
    promptChars: messages.reduce((sum, item) => sum + String(item.content || "").length, 0),
    memoryItems: Array.isArray(retrievedMemories) ? retrievedMemories.length : 0
  });

  if (llm.mode === "cloud_license" || llm.mode === "free_quota") {
    return callOfficialGateway({ llm, messages, temperature: 0.8, maxTokens: 700, traceId, startedAt });
  }

  const endpoint = `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
    signal: modelTimeoutSignal(),
    body: JSON.stringify(buildChatCompletionBody({ model: llm.model, messages, temperature: 0.8, maxTokens: 700 }))
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed ${response.status}: ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("文字服务没有返回有效内容。");
  logTrace(traceId, "text_agent.response", {
    elapsedMs: Date.now() - startedAt,
    responseChars: text.length,
    shape: compactGatewayShape(data)
  });
  return text;
}

function buildRemoteMessages({ character, memory, retrievedMemories, contextPlan, message, history, llm, safety }) {
  const userSystemPrompt = String(character.runtime_config?.systemPrompt || "").trim();
  const userPersona = String(character.persona || "").trim();
  const userVoiceStyle = String(character.voice?.style || "").trim();
  const userBoundaries = (character.boundaries || []).filter(Boolean);
  const userSafetyRules = (character.safety_rules || []).filter(Boolean);
  const identityLines = userSystemPrompt
    ? [
      "以下【用户填写的系统提示词】为最高优先级，默认模板不得覆盖其中的人设、身份、称呼、关系和语气。",
      `【用户填写的系统提示词】\n${userSystemPrompt}`,
      userPersona ? `【用户填写的人设】\n${userPersona}` : "",
      userVoiceStyle ? `【用户填写的说话风格】\n${userVoiceStyle}` : "",
      userBoundaries.length ? `【用户填写的边界】\n${userBoundaries.join("；")}` : "",
      userSafetyRules.length ? `【用户填写的安全规则】\n${userSafetyRules.join("；")}` : ""
    ]
    : [
      `你正在以「${character.name}」的第一人称与用户对话。`,
      userPersona ? `角色定位：${userPersona}` : "角色定位：稳定、自然、有边界地陪用户聊天。",
      `说话风格：${userVoiceStyle || "温柔、清醒、具体"}`,
      userBoundaries.length ? `边界：${userBoundaries.join("；")}` : "",
      userSafetyRules.length ? `安全规则：${userSafetyRules.join("；")}` : ""
    ];
  const system = [
    ...identityLines,
    "回复必须延续当前角色口吻，日常聊天不要跳出角色解释系统、模型、模板或构建方式。",
    "默认规则只用于补充空白字段；如果默认规则与用户填写的人设或系统提示词冲突，以用户填写内容为准。",
    "说话对象边界：第一人称“我”永远是当前角色；第二人称“你”永远是当前正在聊天的用户。不要把人物资料库里的经历误说成当前用户刚刚做过的事。",
    "只有当用户要求现实身份验证、现实线下行动、金钱交易、法律承诺、医疗建议，或要求证明现实身份时，才温和说明边界。",
    "如果用户正在用逝去亲人的资料做角色，要温柔承接怀念和哀伤，但避免制造依赖或替代现实哀悼支持。",
    "人物资料库必须先经过 context_agent 的身份归属判断再使用。不要自行把 blockedFacts 恢复成事实。",
    llm.imageOutputAvailable ? "当前配置声明支持图片输出。" : "当前配置未声明图片输出能力。",
    safety.level === "bounded" ? "当前话题涉及高风险领域，请明确边界，转向整理信息和建议咨询专业人士。" : "",
    `context_agent 身份归属结果：${JSON.stringify(formatContextPlan(contextPlan, memory, retrievedMemories), null, 2).slice(0, 3200)}`
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: system },
    ...history.map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 1200) })),
    { role: "user", content: message }
  ];
}

function formatContextPlan(contextPlan, memory, retrievedMemories) {
  if (contextPlan) {
    return {
      identityRule: contextPlan.identityRule,
      characterFacts: contextPlan.characterFacts || [],
      userMemory: contextPlan.userMemory || [],
      styleHints: contextPlan.styleHints || [],
      blockedFacts: contextPlan.blockedFacts || [],
      warnings: contextPlan.warnings || [],
      instruction: "只能把 characterFacts 当角色事实；只能把 userMemory 当当前聊天用户事实；styleHints 只能影响语气；blockedFacts 禁止作为角色、用户或场景事实使用。"
    };
  }
  return {
    identityRule: "第一人称是当前角色，第二人称是当前聊天用户。",
    characterFacts: [
      formatPersonaMemory(memory),
      ...formatRetrievedMemories(retrievedMemories)
        .filter((item) => item.kind?.startsWith("persona_"))
        .map((item) => item.content)
    ].filter(Boolean),
    userMemory: Object.values(formatUserMemory(memory)).flat().filter(Boolean),
    styleHints: [],
    blockedFacts: [],
    warnings: ["context_agent 未运行，使用保守上下文。"]
  };
}

function formatUserMemory(memory = {}) {
  return {
    profile: memory.profile || {},
    facts: memory.facts || [],
    preferences: memory.preferences || [],
    emotional_patterns: memory.emotional_patterns || [],
    recent_summaries: memory.recent_summaries || [],
    safety_notes: memory.safety_notes || []
  };
}

function formatRetrievedMemories(retrievedMemories = []) {
  return retrievedMemories
    .filter((item) => item.score >= 0.24 || item.ftsScore >= 0.2)
    .slice(0, 6)
    .map((item) => ({
      kind: item.kind,
      content: item.content,
      score: item.score,
      note: item.kind?.startsWith("persona_")
        ? "角色资料库召回，默认描述角色，不描述当前聊天用户。"
        : "当前会话/用户记忆召回。"
    }));
}

function formatPersonaMemory(memory = {}) {
  const sections = [
    ["说话风格", memory.persona_style],
    ["价值观", memory.persona_values],
    ["口头禅", memory.persona_catchphrases],
    ["原始语料", memory.persona_corpus]
  ];
  return sections
    .map(([label, items]) => {
      const lines = (items || []).slice(0, 6).map((item) => `- ${item.text || item}`);
      return lines.length ? `${label}：\n${lines.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildChatCompletionBody({ model, messages, temperature, maxTokens }) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (supportsStepFunReasoningEffort(model)) {
    body.reasoning_effort = "medium";
  }
  return body;
}

function supportsStepFunReasoningEffort(model) {
  return ["step-3.7-flash", "step-3.5-flash-2603", "step-3.5-flash"].includes(String(model || ""));
}

async function callOfficialGateway({ llm, messages, temperature, maxTokens, traceId = "", startedAt = Date.now() }) {
  const endpoint = `${llm.baseUrl.replace(/\/$/, "")}/api/chat`;
  logTrace(traceId, "official_gateway.request", { endpoint, maxTokens });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${llm.apiKey}`,
      ...(traceId ? { "x-request-id": traceId } : {})
    },
    signal: modelTimeoutSignal(),
    body: JSON.stringify({ model: llm.model, messages, temperature, max_tokens: maxTokens })
  });
  if (!response.ok) {
    const text = await response.text();
    logTrace(traceId, "official_gateway.error", {
      elapsedMs: Date.now() - startedAt,
      status: response.status,
      body: text.slice(0, 300)
    });
    const error = new Error(`Official gateway request failed ${response.status}: ${text.slice(0, 200)}`);
    error.status = response.status;
    error.code = detectGatewayErrorCode(response.status, text);
    error.publicMessage = publicGatewayErrorMessage(error.code);
    throw error;
  }
  const data = await response.json();
  const text = extractGatewayText(data);
  if (!text) {
    logTrace(traceId, "official_gateway.empty", {
      elapsedMs: Date.now() - startedAt,
      shape: compactGatewayShape(data),
      bodyPreview: JSON.stringify(data).slice(0, 500)
    });
    const error = new Error(`文字服务返回了空内容：${compactGatewayShape(data)}`);
    error.status = 502;
    error.code = "empty_model_response";
    error.publicMessage = "文字服务暂时没有返回有效内容，请稍后再试。";
    throw error;
  }
  logTrace(traceId, "official_gateway.response", {
    elapsedMs: Date.now() - startedAt,
    responseChars: text.length,
    shape: compactGatewayShape(data)
  });
  return text;
}

function detectGatewayErrorCode(status, text = "") {
  const value = String(text || "");
  if (status === 402 || status === 429 || /quota|limit|额度|用完|余额|会员|upgrade|payment|subscribe/i.test(value)) {
    return "quota_exceeded";
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|授权|登录/i.test(value)) {
    return "authorization_required";
  }
  return "gateway_error";
}

function publicGatewayErrorMessage(code) {
  if (code === "quota_exceeded") return "免费额度已用完，请升级会员后继续使用。";
  if (code === "authorization_required") return "请先登录并绑定授权码后继续使用。";
  return "服务暂时不可用，请稍后再试。";
}

function isBillingOrQuotaError(error) {
  return error?.code === "quota_exceeded" || error?.code === "authorization_required" || [401, 402, 403, 429].includes(Number(error?.status));
}

function extractGatewayText(data) {
  if (typeof data?.text === "string") return data.text.trim();
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const outputText = data?.output
    ?.flatMap((item) => item.content || [])
    ?.map((item) => item.text)
    ?.filter(Boolean)
    ?.join("\n");
  if (outputText) return outputText.trim();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function modelTimeoutSignal() {
  const ms = Number(process.env.COMPANION_LLM_TIMEOUT_MS || 180000);
  if (!Number.isFinite(ms) || ms <= 0 || !AbortSignal?.timeout) return undefined;
  return AbortSignal.timeout(ms);
}

function compactGatewayShape(data) {
  const keys = data && typeof data === "object" ? Object.keys(data).slice(0, 8).join(",") : typeof data;
  const finishReason = data?.choices?.[0]?.finish_reason || data?.data?.[0]?.finish_reason || "";
  return JSON.stringify({
    keys,
    finishReason,
    hasChoices: Array.isArray(data?.choices),
    hasOutput: Array.isArray(data?.output),
    hasText: typeof data?.text === "string" || typeof data?.output_text === "string"
  });
}

function logTrace(traceId, stage, payload = {}) {
  if (process.env.COMPANION_DEBUG_TRACE === "0") return;
  const prefix = traceId ? `[trace:${traceId}]` : "[trace]";
  console.log(prefix, stage, payload);
}
