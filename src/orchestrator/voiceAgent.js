import { reviewAgentOutput } from "./reviewAgent.js";

export async function buildVoiceOutputPlan({ reply = {}, router = {}, userText = "", history = [], agent = {}, character = {}, llm = {} }) {
  if (!router.voiceAgent?.enabled) return null;
  const review = await reviewAgentOutput({
    channel: "voice",
    text: reply.text,
    userText,
    history,
    agent,
    character,
    llm
  });
  const text = String(review.text || reply.text || "").trim();
  if (!text) return null;

  return {
    type: "voice",
    agent: "voice_agent",
    text,
    context: {
      userText,
      replyText: text,
      mood: reply.mood || "",
      workflow: reply.workflow || "",
      history: history.slice(-20)
    },
    decision: buildVoiceAgentDecision({
      text,
      context: {
        userText,
        replyText: text,
        mood: reply.mood || "",
        workflow: reply.workflow || "",
        history
      },
      agent
    }),
    review
  };
}

export function buildVoiceAgentDecision({ text = "", context = {}, agent = {} }) {
  const history = Array.isArray(context?.history) ? context.history : [];
  const joined = [
    ...history.slice(-20).map((item) => `${item.role || ""}:${item.content || ""}`),
    context?.userText ? `user:${context.userText}` : "",
    context?.replyText ? `assistant:${context.replyText}` : "",
    `assistant:${text}`
  ].join("\n");
  const signals = detectVoiceEmotionSignals(joined);
  const primary = signals[0] || {
    key: "natural",
    label: "自然亲近",
    instruction: "像真实微信语音一样自然说出，不要播音腔；语速中等，停顿自然，情绪贴合文字内容。"
  };
  const support = signals.slice(1, 4).map((item) => item.instruction);
  const characterStyle = String(agent.voiceStyle || "").trim();
  const instruction = [
    primary.instruction,
    ...support,
    characterStyle ? `角色自定义声音风格：${characterStyle}` : "",
    "保留口语里的短暂停顿和呼吸感；只朗读角色真正说出口的话，括号里的动作、神态、内心和场景描写不要逐字念出来，只转化成停顿、语气和情绪。"
  ].filter(Boolean).join("；");

  return {
    agent: "voice_agent",
    emotion: primary.key,
    label: primary.label,
    signals: signals.map((item) => item.key),
    instruction
  };
}

function detectVoiceEmotionSignals(text) {
  const value = String(text || "");
  const rules = [
    {
      key: "crying",
      label: "难过哭腔",
      re: /哭|眼泪|泪|哭腔|哽咽|抽噎|掉眼泪|眼眶红|快要哭|鼻音|别丢下|不要丢下|委屈/,
      instruction: "带明显但克制的哭腔和鼻音，声音发软，句尾微微发颤，像刚忍住眼泪；音量偏低，语速稍慢。"
    },
    {
      key: "panic",
      label: "慌乱害怕",
      re: /慌|害怕|怕|吓|抖|发抖|手指|威胁|曝光|公开|雪藏|事业全毁|别这样|不要这样/,
      instruction: "语气慌乱、气息不稳，短句之间有急促停顿；关键字压低，像怕被旁人听见。"
    },
    {
      key: "pleading",
      label: "央求撒娇",
      re: /好不好|求你|拜托|你别|别去找|只要你|我错了|答应你|马上|你想怎么样/,
      instruction: "带央求感和一点撒娇，声音放软，尾音轻轻下坠，不要强势，不要开心营业。"
    },
    {
      key: "secretive",
      label: "压低偷说",
      re: /偷偷|后台|储物间|躲|门外|经纪人|队友|同事|粉丝|公司|微博|截图/,
      instruction: "像躲在后台或房间角落偷偷发语音，音量压低，靠近话筒，偶尔停顿听外面的动静。"
    },
    {
      key: "shy",
      label: "害羞紧张",
      re: /羞|脸红|耳尖红|不好意思|亲|想你|喜欢你|暧昧/,
      instruction: "带害羞和紧张，声音轻、软、略带停顿，尾音不要太满。"
    },
    {
      key: "happy",
      label: "轻快开心",
      re: /开心|高兴|太好了|哈哈|赢了|顺利|喜欢|期待|晚安|早安/,
      instruction: "语气轻快自然，带一点笑意，语速略快但不吵。"
    },
    {
      key: "comforting",
      label: "安慰陪伴",
      re: /难受|累|压力|失眠|孤独|焦虑|陪我|安慰|没事|慢慢来/,
      instruction: "语气温柔稳定，像贴近耳边安慰；语速慢一点，停顿清楚，给人安全感。"
    },
    {
      key: "angry",
      label: "生气克制",
      re: /生气|气死|烦|讨厌|过分|破防|不公平/,
      instruction: "带一点压住的生气和委屈，咬字更清楚，但不要吼叫。"
    }
  ];
  return rules.filter((rule) => rule.re.test(value));
}
