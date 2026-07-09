const explicitImagePatterns = [
  /自拍|selfie/i,
  /(?:发|给|来|拍|传|上一|发来|发我|给我|让我看).{0,8}(?:照片|相片|图片|图|自拍|近照|照|photo|picture|image)/i,
  /(?:照片|相片|图片|图|自拍|近照|photo|picture|image).{0,8}(?:发|给|来|拍|传|看看|看一下|看一眼)/i,
  /拍一张|发张|发个图|给我看|看看你|画一张|生成一张|生成图|出图/i
];

const implicitImagePatterns = [
  /今天长什么样|现在在哪里|想看看/i,
  /(?:穿|背景|场景|灯光|姿势|表情).{0,12}(?:什么样|看看|发来|拍)/i
];

const textOnlyPatterns = [
  /只要文字|别发图|不要发图|不用发图|不要图片|文字说|text only/i
];

export function detectModalityIntent(text = "") {
  const value = normalizeIntentText(text);
  const textOnly = matchesAny(value, textOnlyPatterns);
  const explicitImage = !textOnly && matchesAny(value, explicitImagePatterns);
  const implicitImage = !textOnly && !explicitImage && matchesAny(value, implicitImagePatterns);
  return {
    textOnly,
    image: {
      explicit: explicitImage,
      implicit: implicitImage,
      requested: explicitImage || implicitImage
    }
  };
}

function normalizeIntentText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim();
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}
