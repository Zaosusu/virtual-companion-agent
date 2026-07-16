export async function relayDocumentPageRead({
  baseUrl = "",
  authToken = "",
  image = {},
  pageNumber = 1,
  model = "",
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl || !authToken) {
    return { status: 401, data: { ok: false, code: "authorization_required", error: "请先登录并绑定授权码后识别扫描 PDF。" } };
  }
  if (!image.data) {
    return { status: 400, data: { ok: false, code: "document_page_required", error: "这一页没有可读取的内容。" } };
  }

  let response;
  try {
    response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 5000,
        orchestratorTask: "tool_document_read",
        messages: [
          {
            role: "system",
            content: "你是文档读取助手。准确抄录页面中的全部正文，保留合理换行和段落顺序，不总结、不改写、不解释；看不清的极少数字用[无法识别]标注。只输出提取出的正文。"
          },
          {
            role: "user",
            content: [
              { type: "text", text: `请完整读取这份文档的第 ${Math.max(1, Number(pageNumber) || 1)} 页。` },
              { type: "image_url", image_url: { url: toImageDataUrl(image) } }
            ]
          }
        ]
      })
    });
  } catch {
    return { status: 502, data: { ok: false, code: "document_page_unavailable", error: "这一页暂时没有读取成功，请稍后重试。" } };
  }

  const data = await safeJson(response);
  if (!response.ok) return { status: response.status, data: normalizeDocumentError(data, response.status) };
  const text = extractText(data).trim();
  if (!text) {
    return { status: 502, data: { ok: false, code: "document_page_empty", error: "这一页暂时没有读取成功，请稍后重试。" } };
  }
  return {
    status: 200,
    data: { ok: true, text, pageNumber: Math.max(1, Number(pageNumber) || 1), agent: "document_import_agent" }
  };
}

function toImageDataUrl(image = {}) {
  const data = String(image.data || "");
  return data.startsWith("data:image/") ? data : `data:${image.mime || "image/jpeg"};base64,${data}`;
}

function extractText(data = {}) {
  if (typeof data.text === "string") return data.text;
  if (typeof data.output_text === "string") return data.output_text;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => typeof item === "string" ? item : item?.text || item?.content || "").filter(Boolean).join("\n");
  }
  return "";
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 240) };
  }
}

function normalizeDocumentError(data = {}, status = 500) {
  const text = JSON.stringify(data || {});
  if (status === 401 || status === 403 || /unauthorized|forbidden|授权|登录/i.test(text)) {
    return { ok: false, code: "authorization_required", error: "请先登录并绑定授权码后识别扫描 PDF。" };
  }
  if (status === 402 || status === 429 || /quota|limit|额度|用完|余额|会员|upgrade|payment|subscribe/i.test(text)) {
    return { ok: false, code: "quota_exceeded", error: "额度已用完，暂时不能继续读取这份 PDF。" };
  }
  return { ok: false, code: "document_page_unavailable", error: "这一页暂时没有读取成功，请稍后重试。" };
}
