const STORY_COMMAND = /(?:进入|开启|开始|切换到|接下来是|现在是|我们来玩).{0,8}(?:故事模式|剧情模式|角色扮演|剧情)/i;
const STORY_EXIT = /(?:退出|结束|关闭|停止|离开).{0,8}(?:故事模式|剧情模式|角色扮演|剧情)|回到普通聊天|不玩剧情了/i;
const TRANSITION = /来到|进入|穿过|穿越|传送|抵达|到达|离开|画面一转|时空|第二天|多年后|片刻后|许久后/i;
const ACTION = /递给|交给|塞给|拿出|放下|推开|打开|关上|走进|走出|跑向|冲向|抱住|抓住|握住|亲|签下|喝下|吃下|坐下|站起|醒来/i;
const DANGER = /危险|救命|袭击|追杀|敌人|怪物|丧尸|爆炸|着火|坍塌|中弹|大量流血|昏迷|被困|绑架|快躲|快跑/i;
const NARRATIVE = /剧情|场景|接着刚才|继续刚才|与此同时|下一秒|忽然|突然|此时|就在这时|门外|走廊|房间里|夜色|清晨|黄昏|[（(][^）)]{2,}[）)]|[“"][^”"]{2,}[”"]/i;

export function buildStoryDirective({ userText = "", dialogueState = {}, recentAssistant = [] } = {}) {
  const text = String(userText || "").trim();
  const exiting = STORY_EXIT.test(text);
  const active = !exiting && (Boolean(dialogueState?.storyMode) || STORY_COMMAND.test(text) || detectNarrativeTurn(text));
  const turnType = !active ? "conversation"
    : DANGER.test(text) ? "danger"
      : TRANSITION.test(text) ? "scene_transition"
        : ACTION.test(text) ? "user_action"
          : "story_dialogue";
  return {
    agent: "story_director_agent",
    active,
    exiting,
    turnType,
    mustAdvance: ["danger", "scene_transition", "user_action"].includes(turnType),
    recentAssistant: (Array.isArray(recentAssistant) ? recentAssistant : []).slice(-3).map((item) => String(item || "").slice(0, 220)),
    lastUserEvent: active ? text.slice(0, 500) : ""
  };
}

export function formatStoryDirectiveInstruction(directive = {}) {
  if (!directive.active) return "";
  return [
    "[STORY_DIRECTOR]",
    `本轮类型：${directive.turnType}。`,
    directive.mustAdvance
      ? "用户已经给出事件或动作。必须先让它产生一个可观察结果，再从结果之后继续；不能只复述用户动作，也不能把决定权原样推回用户。"
      : "延续当前场景、人物位置、关系和情绪，不要无提示重置地点或状态。",
    "最近角色回复均视为已经发生完成的内容。禁止换词重演同一个拥抱、递物、道歉、进门、受伤或告别；从最后结果之后推进。",
    "不要用连续环境旁白代替互动；优先角色台词和能改变局势的有效行动。",
    directive.recentAssistant?.length ? `最近已发生的角色内容：${directive.recentAssistant.join(" / ")}` : "",
    "[/STORY_DIRECTOR]"
  ].filter(Boolean).join("\n");
}

export function nextDialogueState({ previous = {}, directive = {}, sceneConstraints = null } = {}) {
  if (directive.exiting) return { storyMode: false, sceneConstraints: null, lastUserEvent: "", updatedAt: new Date().toISOString() };
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    storyMode: Boolean(directive.active),
    sceneConstraints,
    lastUserEvent: directive.lastUserEvent || previous?.lastUserEvent || "",
    updatedAt: new Date().toISOString()
  };
}

export function detectNarrativeTurn(message = "") {
  const text = String(message || "").normalize("NFKC").trim();
  if (!text || STORY_EXIT.test(text)) return false;
  return STORY_COMMAND.test(text) || TRANSITION.test(text) || ACTION.test(text) || DANGER.test(text) || NARRATIVE.test(text);
}
