import { resolveImageGenerationPolicy } from "../modelPolicy.js";

export async function generateImage({ prompt, imageConfig, referenceImage }) {
  if (!imageConfig?.apiKey || !imageConfig?.model || !imageConfig?.baseUrl) {
    throw new Error("图片模型配置不完整。");
  }

  const model = String(imageConfig.model || "").trim();
  if (referenceImage?.data && model === "step-image-edit-2") {
    return editImageWithReference({
      prompt: buildReferenceEditPrompt(prompt),
      imageConfig,
      referenceImage
    });
  }

  return generateImageFromText({
    prompt: limitPrompt(prompt, resolveImageGenerationPolicy({ model, imageConfig, referenceImage }).promptLimit),
    imageConfig,
    referenceImage
  });
}

async function generateImageFromText({ prompt, imageConfig, referenceImage }) {
  const endpoint = `${normalizeImageBaseUrl(imageConfig.baseUrl).replace(/\/$/, "")}/images/generations`;
  const body = buildGenerationRequestBody({ prompt, imageConfig, referenceImage });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${imageConfig.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`图片模型请求失败 ${response.status}: ${compactProviderError(text)}`);
  }

  const data = await response.json();
  return normalizeImageResponse(data, {
    referenceMode: body.style_reference ? "stepfun:style_reference" : "none",
    requestPrompt: body.prompt,
    endpoint: "images/generations"
  });
}

async function editImageWithReference({ prompt, imageConfig, referenceImage }) {
  const endpoint = `${normalizeImageBaseUrl(imageConfig.baseUrl).replace(/\/$/, "")}/images/edits`;
  const form = new FormData();
  const model = String(imageConfig.model || "").trim();
  const policy = resolveImageGenerationPolicy({ model, imageConfig, referenceImage });
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("response_format", "b64_json");
  if (policy.steps !== undefined) form.append("steps", String(policy.steps));
  if (policy.cfgScale !== undefined) form.append("cfg_scale", String(policy.cfgScale));
  form.append("text_mode", String(policy.textMode));
  if (policy.size) form.append("size", policy.size);
  if (imageConfig.seed !== undefined && imageConfig.seed !== "") form.append("seed", String(imageConfig.seed));
  form.append("image", dataUrlToBlob(referenceImage), safeImageFileName(referenceImage));

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${imageConfig.apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`图片编辑请求失败 ${response.status}: ${compactProviderError(text)}`);
  }

  const data = await response.json();
  return normalizeImageResponse(data, {
    referenceMode: "stepfun:image_edit",
    requestPrompt: prompt,
    endpoint: "images/edits"
  });
}

function buildGenerationRequestBody({ prompt, imageConfig, referenceImage }) {
  const model = String(imageConfig.model || "").trim();
  const policy = resolveImageGenerationPolicy({ model, imageConfig, referenceImage });
  const body = {
    model,
    prompt,
    size: policy.size,
    response_format: isStepFunModel(model) ? "b64_json" : "url"
  };

  if (isStepFunModel(model)) {
    body.steps = policy.steps;
    body.cfg_scale = policy.cfgScale;
    body.text_mode = policy.textMode;
  }

  if (referenceImage?.data && model === "step-1x-medium") {
    body.style_reference = {
      source_url: toDataUrl(referenceImage),
      weight: policy.styleReferenceWeight
    };
  }

  return body;
}

function normalizeImageResponse(data, meta) {
  const first = data.data?.[0] || {};
  return {
    url: first.url || "",
    b64Json: first.b64_json || "",
    seed: first.seed,
    finishReason: first.finish_reason || "",
    revisedPrompt: first.revised_prompt || "",
    referenceMode: meta.referenceMode,
    requestPrompt: meta.requestPrompt,
    endpoint: meta.endpoint,
    raw: data
  };
}

function buildReferenceEditPrompt(prompt) {
  const raw = String(prompt || "").replace(/\s+/g, " ").trim();
  const sceneLock = buildSceneLock(raw);
  const emotionLock = buildEmotionLock(raw);
  const prefix = [
    "参考图只用于保持同一个人的脸、发型、气质和身份，不用于保留原背景。",
    "人物必须像参考图本人：脸型、五官比例、眼睛、鼻唇、发色、发型、刘海保持一致。",
    sceneLock,
    emotionLock,
    "必须彻底替换参考图原背景；不要保留公园、树林、街道、路人、室外自然景或与用户要求冲突的环境。",
    "自拍构图，脸部完整清晰，手机不入镜，不要镜子自拍，不要文字水印。"
  ].filter(Boolean).join(" ");

  return limitPrompt(`${prefix} ${raw}`, 512);
}

function buildSceneLock(prompt) {
  if (/舞台|公演|剧场|演出|live|stage|theater/i.test(prompt)) {
    return "目标场景硬约束：必须是舞台/剧场/公演现场，有舞台灯、幕布或侧幕、演出空间、舞台地面；禁止画成公园、树林、街道、室外写真或普通房间。";
  }
  if (/后台|化妆间|补妆|候场/i.test(prompt)) {
    return "目标场景硬约束：必须是演出后台/化妆间/候场区，有化妆镜灯、衣架、演出服或后台通道。";
  }
  if (/排练室|练舞|训练|舞蹈房/i.test(prompt)) {
    return "目标场景硬约束：必须是排练室/练舞房，有镜墙、木地板、训练服、水杯或毛巾。";
  }
  return "目标场景硬约束：用户本次指定的场景必须生效，优先于参考图原背景。";
}

function buildEmotionLock(prompt) {
  if (!/哭|眼泪|泪|哽咽|哭腔|慌|害怕|手抖|发抖|曝光|公开|微博|找其他|别丢下|难受|委屈/.test(prompt)) return "";
  return "情绪硬约束：刚哭过或快哭出来，眼眶红、有泪光，表情委屈慌乱；不要阳光明媚、不要平静甜笑、不要开心营业照、不要精致摆拍。";
}

function isStepFunModel(model) {
  return model.startsWith("step-");
}

function normalizeImageBaseUrl(baseUrl) {
  return String(baseUrl || "").trim();
}

function limitPrompt(prompt, maxLength) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const tail = " 硬约束：同一张脸，目标场景必须生效，彻底替换参考图原背景，不要文字水印。";
  const available = Math.max(0, maxLength - tail.length);
  return `${text.slice(0, available)}${tail}`;
}

function toDataUrl(referenceImage) {
  const data = String(referenceImage.data || "");
  if (data.startsWith("data:image/")) return data;
  return `data:${referenceImage.mime || "image/png"};base64,${data}`;
}

function dataUrlToBlob(referenceImage) {
  const data = String(referenceImage.data || "");
  const base64 = data.includes(",") ? data.split(",").at(-1) : data;
  const bytes = Buffer.from(base64, "base64");
  return new Blob([bytes], { type: referenceImage.mime || "image/png" });
}

function safeImageFileName(referenceImage) {
  const rawName = String(referenceImage.name || "reference.png").replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (/\.(png|jpe?g|webp)$/i.test(rawName)) return rawName;
  const ext = mimeToExtension(referenceImage.mime || "image/png");
  return `${rawName || "reference"}.${ext}`;
}

function mimeToExtension(mime) {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function compactProviderError(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "服务端没有返回错误详情。";
  try {
    const parsed = JSON.parse(value);
    return parsed.error?.message || parsed.message || JSON.stringify(parsed).slice(0, 240);
  } catch {
    return value.slice(0, 240);
  }
}
