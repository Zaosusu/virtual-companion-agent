export function buildImageOutputPlan({ reply = {}, router = {}, userText = "", history = [], character = {} }) {
  if (!router.imageAgent?.enabled) return null;

  const prompt = reply.tool?.input?.prompt || reply.text || "";
  if (!String(prompt).trim()) return null;
  const delivery = decideImageDelivery({ userText, history, character });

  return {
    type: "image",
    agent: "image_agent",
    prompt,
    content: delivery.mode === "image_then_text" ? delivery.text : "",
    delivery,
    explicit: Boolean(router.imageAgent.explicit),
    source: router.imageAgent.source || "router_agent",
    userText
  };
}

function decideImageDelivery({ userText = "", history = [], character = {} }) {
  const text = normalize(userText);
  if (/只发|直接发|别说话|不用说|少说话|别废话|只要图|只要照片|只要自拍/.test(text)) {
    return {
      mode: "image_only",
      label: "只发图片",
      text: "",
      reason: "user_requested_image_only"
    };
  }
  if (/先.{0,6}(说|回|告诉|哄|解释).{0,12}(再|然后|再发|再拍)|说.{0,6}(再|然后).{0,8}(发|拍)/.test(text)) {
    return {
      mode: "text_before_image",
      label: "先说一句再发图",
      text: buildCompanionLine({ userText, character, position: "before" }),
      reason: "user_requested_text_before_image"
    };
  }
  if (/(发|拍|给).{0,10}(之后|以后|后|完).{0,10}(说|回|告诉)|发完.{0,8}(说|回|告诉)/.test(text)) {
    return {
      mode: "image_then_text",
      label: "先发图再说一句",
      text: buildCompanionLine({ userText, character, position: "after" }),
      reason: "user_requested_image_then_text"
    };
  }

  const choices = [
    { mode: "image_only", label: "只发图片", reason: "agent_delivery_variation" },
    { mode: "text_before_image", label: "先说一句再发图", reason: "agent_delivery_variation" },
    { mode: "image_then_text", label: "先发图再说一句", reason: "agent_delivery_variation" }
  ];
  const selected = choices[Math.abs(hashText(`${text}:${history.length}`)) % choices.length];
  return {
    ...selected,
    text: selected.mode === "image_only"
      ? ""
      : buildCompanionLine({ userText, character, position: selected.mode === "text_before_image" ? "before" : "after" })
  };
}

function buildCompanionLine({ userText = "", character = {}, position = "before" }) {
  const name = character.name || "我";
  const wantsSelfie = /自拍|selfie/i.test(userText);
  if (position === "before") {
    return wantsSelfie
      ? "好，给你拍一张。"
      : "好，我给你发一张。";
  }
  return wantsSelfie
    ? `${name}拍好了，给你看。`
    : `${name}发来了，给你看。`;
}

function normalize(text) {
  return String(text || "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function hashText(text) {
  let hash = 0;
  for (const char of String(text || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return hash;
}
