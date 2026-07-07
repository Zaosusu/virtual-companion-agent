export function buildImageOutputPlan({ reply = {}, router = {}, userText = "" }) {
  if (!router.imageAgent?.enabled) return null;

  const prompt = reply.tool?.input?.prompt || reply.text || "";
  if (!String(prompt).trim()) return null;

  return {
    type: "image",
    agent: "image_agent",
    prompt,
    content: "给你发来一张图片。",
    explicit: Boolean(router.imageAgent.explicit),
    source: router.imageAgent.source || "router_agent",
    userText
  };
}
