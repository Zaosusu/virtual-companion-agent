const $ = (selector) => document.querySelector(selector);

const agentList = $("#agentList");
const leftRail = $("#leftRail");
const sidePanel = $("#sidePanel");
const hideLeftPanel = $("#hideLeftPanel");
const showLeftPanel = $("#showLeftPanel");
const hideRightPanel = $("#hideRightPanel");
const showRightPanel = $("#showRightPanel");
const toggleLeftPanel = $("#toggleLeftPanel");
const toggleRightPanel = $("#toggleRightPanel");
const newAgentButton = $("#newAgentButton");
const cloneAgentButton = $("#cloneAgentButton");
const messagesEl = $("#messages");
const composer = $("#composer");
const input = $("#messageInput");
const template = $("#messageTemplate");
const statusEl = $("#status");
const modePill = $("#modePill");
const openAuthButton = $("#openAuthButton");
const clearChatButton = $("#clearChatButton");
const agentTitleEl = $("#agentTitle");
const agentAvatarEl = $("#agentAvatar");
const quickActions = $("#quickActions");
const memoryListEl = $("#memoryList");
const ragListEl = $("#ragList");
const ragStatusEl = $("#ragStatus");
const resetMemory = $("#resetMemory");

const modelConfigForm = $("#modelConfigForm");
const authAccount = $("#authAccount");
const authCode = $("#authCode");
const authPassword = $("#authPassword");
const authLoginTab = $("#authLoginTab");
const authRegisterTab = $("#authRegisterTab");
const authResetTab = $("#authResetTab");
const sendCodeButton = $("#sendCodeButton");
const registerButton = $("#registerButton");
const loginButton = $("#loginButton");
const resetPasswordButton = $("#resetPasswordButton");
const logoutButton = $("#logoutButton");
const authStatus = $("#authStatus");
const officialLicenseKey = $("#officialLicenseKey");
const clearOfficialLicenseKey = $("#clearOfficialLicenseKey");
const testTtsButton = $("#testTtsButton");
const modelConfigStatus = $("#modelConfigStatus");
const modelConfigHint = $("#modelConfigHint");
const experienceStatus = $("#experienceStatus");
const experienceImageStyle = $("#experienceImageStyle");
const agentVoiceGender = $("#agentVoiceGender");
const agentVoiceTone = $("#agentVoiceTone");
const voiceCloneInput = $("#voiceCloneInput");
const voiceSampleText = $("#voiceSampleText");
const voiceClonePreview = $("#voiceClonePreview");
const cloneVoiceButton = $("#cloneVoiceButton");
const clearClonedVoiceButton = $("#clearClonedVoiceButton");

const agentConfigForm = $("#agentConfigForm");
const agentConfigStatus = $("#agentConfigStatus");
const agentId = $("#agentId");
const agentAvatarInput = $("#agentAvatarInput");
const agentName = $("#agentName");
const agentTagline = $("#agentTagline");
const agentPersona = $("#agentPersona");
const agentAppearance = $("#agentAppearance");
const appearanceImageInput = $("#appearanceImageInput");
const analyzeAppearanceButton = $("#analyzeAppearanceButton");
const appearanceAnalyzeStatus = $("#appearanceAnalyzeStatus");
const agentVoiceStyle = $("#agentVoiceStyle");
const agentRelationship = $("#agentRelationship");
const agentOpening = $("#agentOpening");
const agentSystemPrompt = $("#agentSystemPrompt");
const agentVisualContext = $("#agentVisualContext");
const agentReferenceImageInput = $("#agentReferenceImageInput");
const agentReferencePreview = $("#agentReferencePreview");
const clearReferenceImageButton = $("#clearReferenceImageButton");
const agentPrompts = $("#agentPrompts");
const agentBoundaries = $("#agentBoundaries");
const agentSafetyRules = $("#agentSafetyRules");
const exportAgentButton = $("#exportAgentButton");
const deleteAgentButton = $("#deleteAgentButton");
const importForm = $("#importForm");
const importText = $("#importText");
const personaCorpusForm = $("#personaCorpusForm");
const personaCorpusFile = $("#personaCorpusFile");
const personaCorpusFolder = $("#personaCorpusFolder");
const personaCorpusText = $("#personaCorpusText");
const personaCorpusRelation = $("#personaCorpusRelation");
const personaCorpusStatus = $("#personaCorpusStatus");

let state = {
  agents: [],
  activeAgentId: "",
  activeAgent: null,
  modelConfig: null,
  authUser: null,
  memory: null,
  pendingReferenceImage: null,
  pendingAppearanceImage: null,
  pendingVoiceSample: null,
  authMode: "login",
  clearReferenceImage: false,
  experienceSaveTimer: null,
  oldestMessageId: null,
  hasMoreMessages: true,
  loadingOlderMessages: false
};

let voicePlayback = {
  audio: null,
  button: null,
  src: "",
  html: "",
  text: ""
};
let chatQueue = Promise.resolve();
let pendingChatCount = 0;

init();

async function init() {
  localizeAuthPanel();
  initPanelToggles();
  const bootstrap = await api("/api/bootstrap");
  state = {
    agents: bootstrap.agents,
    activeAgentId: bootstrap.active_agent_id,
    activeAgent: bootstrap.agent,
    modelConfig: bootstrap.model_config,
    authUser: bootstrap.auth_user || null,
    memory: bootstrap.memory,
    recentMessages: bootstrap.recent_messages || []
  };
  renderAll();
  renderConversation(state.recentMessages);
  if (!state.authUser) refreshAuthUser();
}

function localizeAuthPanel() {
  const authBlock = authAccount?.closest(".official-license-block");
  if (!authBlock) return;

  const title = authBlock.querySelector("strong");
  const hint = authBlock.querySelector(".form-hint");
  const labels = authBlock.querySelectorAll("label > span:first-child");

  if (title) title.textContent = "邮箱账号";
  if (hint) hint.textContent = "登录只需要邮箱和密码；注册或重置密码时再使用验证码。";
  if (authLoginTab) authLoginTab.textContent = "登录";
  if (authRegisterTab) authRegisterTab.textContent = "注册";
  if (authResetTab) authResetTab.textContent = "重置";
  if (labels[0]) labels[0].textContent = "邮箱";
  if (labels[1]) labels[1].textContent = "验证码";
  if (labels[2]) labels[2].textContent = "密码";

  if (authAccount) authAccount.placeholder = "请输入邮箱";
  if (authCode) authCode.placeholder = "6 位验证码";
  if (authPassword) authPassword.placeholder = "至少 6 位";
  if (sendCodeButton) sendCodeButton.textContent = "发送";
  if (registerButton) registerButton.textContent = "注册";
  if (loginButton) loginButton.textContent = "登录";
  if (resetPasswordButton) resetPasswordButton.textContent = "重置密码";
  if (logoutButton) logoutButton.textContent = "退出";
  if (authStatus && !authStatus.textContent.trim()) authStatus.textContent = "未登录。";
  renderAuthMode();
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  enqueueMessage(text);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
});

input.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  enqueueMessage(text);
});

newAgentButton.addEventListener("click", async () => {
  const base = {
    id: `agent-${Date.now().toString(36)}`,
    name: "新角色",
    avatar: "新",
    category: "custom",
    tagline: "一句话描述这个角色",
    persona: "写下这个角色是谁、擅长什么，以及和用户是什么关系。",
    appearance: "写下角色的发型、脸部特征、穿搭和整体气质。",
    voiceStyle: "中文口语，具体，稳定。",
    relationship: "亲近但有边界。",
    openingMessage: "我在。你想让我怎么陪你？",
    systemPrompt: "请完全按照人设进行第一人称沉浸式对话。日常聊天不要跳出角色，不要解释自己是系统或模型。",
    imageStyle: "realistic",
    visualContext: "",
    referenceImage: null,
    prompts: ["陪我聊聊", "帮我拆一个计划"],
    boundaries: ["不做现实身份验证、线下承诺或现实关系承诺"],
    safetyRules: ["出现自伤风险时优先安全降级"]
  };
  const result = await api("/api/agents", { method: "POST", body: JSON.stringify({ agent: base }) });
  await applyAgentResult(result);
  addMessage("system", "已新建角色，可以在右侧编辑。");
});

messagesEl.addEventListener("scroll", () => {
  if (messagesEl.scrollTop > 24) return;
  loadOlderMessages();
});

cloneAgentButton.addEventListener("click", async () => {
  if (!state.activeAgentId) return;
  const result = await api(`/api/agents/${encodeURIComponent(state.activeAgentId)}/clone`, { method: "POST" });
  await applyAgentResult(result);
  addMessage("system", "已复制当前角色，副本可以自由修改。");
});

openAuthButton?.addEventListener("click", () => {
  setPanelCollapsed("right", false);
  authAccount?.scrollIntoView({ behavior: "smooth", block: "center" });
  authAccount?.focus();
});

modelConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let submittedModelConfig;
  try {
    submittedModelConfig = readModelConfigForm();
  } catch (error) {
    addMessage("system", error.message);
    return;
  }
  const wantsClearLicense = Boolean(submittedModelConfig.clearOfficialLicenseKey);
  const hasPendingLicense = Boolean(submittedModelConfig.officialLicenseKey || state.modelConfig?.license?.pendingBind || state.modelConfig?.license?.saved);
  const shouldBindLicense = !wantsClearLicense && hasPendingLicense;
  if (shouldBindLicense && !state.authUser) {
    addMessage("system", "请先注册或登录账号，再绑定授权码。");
    return;
  }
  const result = shouldBindLicense
    ? await api("/api/auth/bind-license", {
      method: "POST",
      body: JSON.stringify({ licenseKey: submittedModelConfig.officialLicenseKey })
    })
    : await api("/api/config", {
      method: "POST",
      body: JSON.stringify({
        model_config: submittedModelConfig
      })
    });
  officialLicenseKey.value = "";
  clearOfficialLicenseKey.checked = false;
  if (result.user) state.authUser = result.user;
  state.modelConfig = mergeSavedModelConfig(result.model_config, submittedModelConfig);
  renderModelConfig();
  renderStatus();
  addMessage("system", wantsClearLicense ? "本机保存的授权码已清除。" : shouldBindLicense ? "授权码已绑定到当前账号。" : "授权信息已保存。");
});

authLoginTab?.addEventListener("click", () => setAuthMode("login"));
authRegisterTab?.addEventListener("click", () => setAuthMode("register"));
authResetTab?.addEventListener("click", () => setAuthMode("reset-password"));
sendCodeButton?.addEventListener("click", () => sendAuthCode(state.authMode === "reset-password" ? "reset_password" : "register"));
registerButton?.addEventListener("click", () => submitAuth("register"));
loginButton?.addEventListener("click", () => submitAuth("login"));
resetPasswordButton?.addEventListener("click", () => submitAuth("reset-password"));
clearOfficialLicenseKey?.addEventListener("change", () => renderLicenseBindingState());
logoutButton?.addEventListener("click", async () => {
  authStatus.textContent = "正在退出...";
  const result = await api("/api/auth/logout", { method: "POST" });
  state.authUser = null;
  if (result.model_config) state.modelConfig = result.model_config;
  authPassword.value = "";
  renderModelConfig();
  renderStatus();
  renderAuthStatus();
});

agentConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const agent = readAgentForm();
  const result = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({ agent })
  });
  await applyAgentResult(result);
  addMessage("system", "角色配置已保存，下一轮对话生效。");
});

exportAgentButton.addEventListener("click", async () => {
  const result = await api(`/api/agents/${encodeURIComponent(state.activeAgentId)}`);
  importText.value = JSON.stringify(result.pack, null, 2);
  addMessage("system", "角色包已生成在右侧导入框，可直接复制。");
});

deleteAgentButton.addEventListener("click", async () => {
  if (!state.activeAgent || state.activeAgent.isBuiltin) {
    addMessage("system", "内置角色不能删除，可以先复制再修改。");
    return;
  }
  const result = await api(`/api/agents/${encodeURIComponent(state.activeAgentId)}`, { method: "DELETE" });
  state.agents = result.agents;
  state.activeAgentId = result.active_agent_id;
  await activateAgent(state.activeAgentId);
});

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = importText.value.trim();
  if (!text) return;
  const pack = JSON.parse(text);
  const result = await api("/api/agents/import", { method: "POST", body: JSON.stringify({ pack }) });
  await applyAgentResult(result);
  addMessage("system", "角色包已导入并切换。");
});

personaCorpusFile.addEventListener("change", async () => {
  await loadPersonaCorpusFiles(Array.from(personaCorpusFile.files || []), "文件");
});

personaCorpusFolder.addEventListener("change", async () => {
  await loadPersonaCorpusFiles(Array.from(personaCorpusFolder.files || []), "文件夹");
});

personaCorpusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = personaCorpusText.value.trim();
  if (text.length < 20) {
    personaCorpusStatus.textContent = "资料太短";
    return;
  }
  personaCorpusStatus.textContent = "导入中...";
  try {
    const result = await api("/api/persona-corpus/import", {
      method: "POST",
      body: JSON.stringify({
        text,
        relation: personaCorpusRelation.value,
        sourceName: personaCorpusSourceName() || "粘贴文本"
      })
    });
    state.memory = result.memory;
    renderMemory();
    const imported = result.imported || {};
    personaCorpusStatus.textContent = `已导入 ${imported.chunks || 0} 段`;
    addMessage("system", `人物资料已导入：语料 ${imported.chunks || 0} 段，风格 ${imported.styles || 0} 条，口头禅 ${imported.catchphrases || 0} 条。`);
  } catch (error) {
    personaCorpusStatus.textContent = "导入失败";
    addMessage("system", `人物资料导入失败：${error.message}`);
  }
});

resetMemory.addEventListener("click", async () => {
  const result = await api("/api/memory/reset", { method: "POST" });
  state.memory = result.memory;
  renderMemory();
  renderRag([]);
  addMessage("system", "长期记忆、消息和 RAG 索引已清空。");
});

clearChatButton.addEventListener("click", async () => {
  if (!confirm("清空当前角色的聊天记录？")) return;
  const result = await api("/api/messages/clear", { method: "POST" });
  renderConversation(result.recent_messages || []);
});

agentReferenceImageInput.addEventListener("change", async () => {
  const file = agentReferenceImageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    addMessage("system", "参考图必须是图片文件。");
    agentReferenceImageInput.value = "";
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    addMessage("system", "参考图太大了，请控制在 4MB 以内。");
    agentReferenceImageInput.value = "";
    return;
  }
  state.pendingReferenceImage = await readImageFile(file);
  state.clearReferenceImage = false;
  renderReferencePreview(state.pendingReferenceImage, "保存中...");
  await saveReferenceImageChange("参考图已保存，刷新后仍会保留。");
});

clearReferenceImageButton.addEventListener("click", async () => {
  state.pendingReferenceImage = null;
  state.clearReferenceImage = true;
  agentReferenceImageInput.value = "";
  renderReferencePreview(null, "保存中...");
  await saveReferenceImageChange("参考图已清除。");
});

appearanceImageInput.addEventListener("change", async () => {
  const file = appearanceImageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    appearanceAnalyzeStatus.textContent = "请上传图片文件。";
    appearanceImageInput.value = "";
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    appearanceAnalyzeStatus.textContent = "图片太大了，请控制在 4MB 以内。";
    appearanceImageInput.value = "";
    return;
  }
  state.pendingAppearanceImage = await readImageFile(file);
  appearanceAnalyzeStatus.textContent = `已选择：${file.name}`;
});

analyzeAppearanceButton.addEventListener("click", async () => {
  await analyzeAppearanceFromImage();
});

testTtsButton.addEventListener("click", async () => {
  await playSpeech("我在。今天想让我用什么语气陪你？", testTtsButton);
});

experienceImageStyle.addEventListener("change", () => {
  queueExperienceSave();
});

agentVoiceGender.addEventListener("change", () => {
  if (state.activeAgent) state.activeAgent.voiceGender = agentVoiceGender.value;
  queueExperienceSave();
});

agentVoiceTone.addEventListener("change", () => {
  if (state.activeAgent) state.activeAgent.voiceTone = agentVoiceTone.value;
  queueExperienceSave();
});

voiceCloneInput.addEventListener("change", async () => {
  const file = voiceCloneInput.files?.[0];
  if (!file) return;
  if (!isSupportedVoiceSample(file)) {
    addMessage("system", "声音样本请上传 mp3 或 wav 格式。");
    voiceCloneInput.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    addMessage("system", "声音样本太大了，请控制在 10MB 以内。");
    voiceCloneInput.value = "";
    return;
  }
  try {
    const duration = await readAudioDuration(file);
    if (duration && (duration < 5 || duration > 10)) {
      renderVoiceClonePreview({
        error: `这段音频约 ${duration.toFixed(1)} 秒，请换成 5 到 10 秒的人声样本。`
      });
      voiceCloneInput.value = "";
      state.pendingVoiceSample = null;
      return;
    }
  } catch {
    renderVoiceClonePreview({
      status: "已选择样本，但浏览器无法预读时长；提交后由服务端校验。"
    });
  }
  state.pendingVoiceSample = await readFileAsBase64(file);
  renderVoiceClonePreview({
    name: file.name,
    ready: true,
    clonedVoiceId: state.activeAgent?.clonedVoiceId || ""
  });
});

cloneVoiceButton.addEventListener("click", async () => {
  await cloneCurrentVoice();
});

clearClonedVoiceButton.addEventListener("click", async () => {
  if (!state.activeAgent) return;
  const result = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({
      agent: {
        ...readAgentForm(),
        clonedVoiceId: "",
        voiceSampleName: ""
      }
    })
  });
  await applyAgentResult(result);
  state.pendingVoiceSample = null;
  voiceCloneInput.value = "";
  addMessage("system", "已清除克隆声音。");
});

async function activateAgent(id) {
  const result = await api(`/api/agents/${encodeURIComponent(id)}/activate`, { method: "POST" });
  state.activeAgentId = result.active_agent_id;
  state.activeAgent = result.agent;
  renderAgent();
  renderAgentList();
  renderConversation(result.recent_messages || []);
}

async function applyAgentResult(result) {
  state.agents = result.agents || state.agents;
  state.activeAgentId = result.active_agent_id || result.agent?.id || state.activeAgentId;
  state.activeAgent = result.agent || state.activeAgent;
  if (result.model_config) state.modelConfig = result.model_config;
  if (result.agent) state.activeAgent = result.agent;
  renderAll();
}

async function sendMessage(text) {
  addMessage("user", text);
  try {
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: text })
    });
    state.memory = result.memory;
    state.activeAgent = result.agent || state.activeAgent;
    renderRag(result.retrieved_memories || []);
    const quotaText = result.quota?.mode === "free_quota" ? ` · 免费剩余 ${result.quota.remaining}` : "";
    const routed = await runFrontAgents({ userText: text, result });
    renderAssistantOutputs(routed, quotaText);
    renderMemory();
  } catch (error) {
    addMessage("system", friendlyErrorMessage(error));
  }
}

function enqueueMessage(text) {
  pendingChatCount += 1;
  setBusy(true);
  chatQueue = chatQueue
    .catch(() => {})
    .then(() => sendMessage(text))
    .finally(() => {
      pendingChatCount = Math.max(0, pendingChatCount - 1);
      if (pendingChatCount === 0) setBusy(false);
    });
  return chatQueue;
}

function friendlyErrorMessage(error) {
  const message = String(error?.message || error || "").trim();
  if (error?.code === "quota_exceeded" || error?.status === 402 || error?.status === 429) {
    const upgrade = error.upgrade || {};
    return [
      upgrade.title || "免费额度已用完",
      upgrade.message || message || "开通会员或绑定授权码后，可以继续聊天、生成图片和语音。",
      "请在右侧登录后绑定授权码，或前往会员页开通。"
    ].join("\n\n");
  }
  if (!message) return "暂时没处理成功，请稍后再试。";
  if (/登录|授权码|official_license_required|401|403/.test(message) || error?.code === "authorization_required") {
    return "需要先登录并绑定授权码后才能继续使用。";
  }
  if (/免费体验|free_quota|quota|额度|用完/i.test(message)) {
    return message.replace(/^出错了[:：]\s*/, "");
  }
  if (error?.code === "empty_model_response" || /空内容|empty_model_response|没有返回有效内容/i.test(message)) {
    return "文字服务刚刚没有返回有效内容，这不是角色回复。请稍后重试；如果连续出现，请把终端里的 trace 日志发给开发者。";
  }
  if (/fetch failed|ECONNREFUSED|network|连接失败|服务连接失败/i.test(message)) {
    return "服务暂时连接不上，请稍后再试。";
  }
  return `暂时没处理成功：${message.replace(/^出错了[:：]\s*/, "")}`;
}

function renderAll() {
  renderAgentList();
  renderAgent();
  renderModelConfig();
  renderMemory();
  renderRag([]);
  renderStatus();
}

function renderConversation(messages) {
  messagesEl.innerHTML = "";
  state.oldestMessageId = firstMessageId(messages);
  state.hasMoreMessages = Boolean(state.oldestMessageId);
  state.loadingOlderMessages = false;
  if (!messages?.length) {
    addMessage("assistant", state.activeAgent.openingMessage || "我在。");
    state.hasMoreMessages = false;
    return;
  }
  const visibleMessages = collapseVoiceTextPairs(messages);
  for (const message of visibleMessages) {
    addMessage(message.role, message.content, {
      messageId: message.id,
      meta: message.role === "assistant"
        ? state.activeAgent.name
        : message.role === "user"
          ? "你"
          : "系统",
      metadata: message.metadata || {}
    });
  }
}

async function loadOlderMessages() {
  if (state.loadingOlderMessages || !state.hasMoreMessages || !state.oldestMessageId) return;
  state.loadingOlderMessages = true;
  const previousHeight = messagesEl.scrollHeight;
  try {
    const result = await api(`/api/messages?before_id=${encodeURIComponent(state.oldestMessageId)}&limit=30`);
    const messages = result.messages || [];
    if (!messages.length) {
      state.hasMoreMessages = false;
      return;
    }
    prependMessages(messages);
    state.oldestMessageId = firstMessageId(messages) || state.oldestMessageId;
    state.hasMoreMessages = Boolean(result.has_more);
    const nextHeight = messagesEl.scrollHeight;
    messagesEl.scrollTop = nextHeight - previousHeight + messagesEl.scrollTop;
  } catch (error) {
    addMessage("system", `加载更早聊天记录失败：${error.message}`);
  } finally {
    state.loadingOlderMessages = false;
  }
}

function prependMessages(messages) {
  const fragment = document.createDocumentFragment();
  for (const message of collapseVoiceTextPairs(messages)) {
    fragment.appendChild(createMessageNode(message.role, message.content, {
      messageId: message.id,
      meta: message.role === "assistant"
        ? state.activeAgent.name
        : message.role === "user"
          ? "你"
          : "系统",
      metadata: message.metadata || {}
    }));
  }
  messagesEl.prepend(fragment);
}

function firstMessageId(messages = []) {
  const first = (messages || []).find((message) => Number.isFinite(Number(message.id)));
  return first ? Number(first.id) : null;
}

function collapseVoiceTextPairs(messages) {
  return (messages || []).filter((message, index, list) => {
    if (message.source === "tool:image.generate" && message.metadata?.type !== "image") return false;
    if (message.role !== "assistant" || message.metadata?.type === "voice") return true;
    const next = list[index + 1];
    return !(next?.metadata?.type === "voice" && next.content === message.content);
  });
}

async function runFrontAgents({ userText, result }) {
  const reply = result.reply || {};
  const orchestration = result.orchestration || {};
  const router = orchestration.router || result.router || {};
  const plannedOutputs = Array.isArray(orchestration.outputs)
    ? orchestration.outputs
    : Array.isArray(result.outputs)
      ? result.outputs
      : [];
  const outputs = plannedOutputs.filter((output) => output.type === "text");

  for (const output of plannedOutputs.filter((item) => item.type === "image")) {
    const prompt = output.prompt || reply.tool?.input?.prompt || reply.text || "";
    try {
      const imageResult = await api("/api/image", {
        method: "POST",
        body: JSON.stringify({ prompt, content: output.content || "给你发来一张图片。" })
      });
      outputs.push({ ...output, prompt, image: imageResult.image });
    } catch (error) {
      if (isUpgradeRequiredError(error)) throw error;
      outputs.push({ ...output, prompt, error: error.message });
    }
  }

  for (const output of plannedOutputs.filter((item) => item.type === "voice")) {
    const text = output.text || reply.text || "";
    try {
      const audio = await api("/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text,
          context: output.context || {
            userText,
            replyText: text,
            mood: reply.mood || "",
            workflow: reply.workflow || "",
            history: getVisibleChatHistory(20)
          }
        })
      });
      outputs.push({ ...output, text, audio });
    } catch (error) {
      if (isUpgradeRequiredError(error)) throw error;
      outputs.push({ ...output, text, error: error.message });
    }
  }

  if (!outputs.length && reply.source !== "tool:image.generate") {
    outputs.push({
      type: "text",
      agent: "text_agent",
      text: reply.text || "",
      source: reply.source || "local"
    });
  }

  return { ...result, router, outputs, orchestration };
}

function isUpgradeRequiredError(error) {
  return error?.code === "quota_exceeded"
    || error?.code === "authorization_required"
    || error?.status === 402
    || error?.status === 429;
}

function getVisibleChatHistory(limit = 16) {
  return Array.from(messagesEl.querySelectorAll(".message"))
    .slice(-limit)
    .map((node) => ({
      role: node.classList.contains("assistant") ? "assistant" : node.classList.contains("user") ? "user" : "system",
      content: node.querySelector(".message-body")?.textContent || ""
    }))
    .filter((item) => item.content.trim());
}

function renderAssistantOutputs(result, quotaText = "", options = {}) {
  const reply = result.reply || {};
  const outputs = Array.isArray(result.outputs) && result.outputs.length
    ? result.outputs
    : result.router?.voiceAgent?.enabled || reply.source === "tool:image.generate"
      ? []
      : [{ type: "text", text: reply.text, source: reply.source, agent: "text_agent" }];
  const baseMeta = `${state.activeAgent.name}${result.compression?.triggered ? " · 已整理记忆" : ""}${quotaText}`;

  for (const output of outputs) {
    if (options.skipText && output.type === "text") continue;
    if (output.type === "text" && String(output.text || "").trim()) {
      addMessage("assistant", output.text, {
        meta: baseMeta
      });
    }
    if (output.type === "image") {
      const image = output.image || {};
      addMessage("assistant", output.error ? `图片生成失败：${output.error}` : "", {
        meta: `${baseMeta} · 图片`,
        metadata: {
          type: output.error ? "tool_error" : "image",
          imageUrl: image.url || "",
          b64Json: image.b64Json || "",
          error: output.error || ""
        }
      });
    }
    if (output.type === "voice") {
      const savedMessage = output.audio?.message || null;
      addMessage("assistant", output.error ? `语音生成失败：${output.error}` : output.text || reply.text || "", {
        meta: `${baseMeta} · 语音`,
        messageId: savedMessage?.id || output.audio?.messageId,
        metadata: {
          type: output.error ? "tool_error" : "voice",
          audio: savedMessage?.metadata?.audio || normalizeTtsAudioResult(output.audio),
          transcript: savedMessage?.metadata?.transcript || output.text || reply.text || "",
          error: output.error || ""
        }
      });
    }
  }
}

function renderAgentList() {
  agentList.innerHTML = "";
  for (const agent of state.agents) {
    const button = document.createElement("button");
    button.className = `agent-card${agent.id === state.activeAgentId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="mini-avatar">${escapeHtml(agent.avatar || agent.name.slice(0, 1))}</span>
      <span>
        <strong>${escapeHtml(agent.name)}</strong>
        <small>${escapeHtml(agent.tagline || agent.category)}</small>
      </span>
    `;
    button.addEventListener("click", () => activateAgent(agent.id));
    agentList.appendChild(button);
  }
}

function renderAgent() {
  const agent = state.activeAgent;
  if (!agent) return;
  agentTitleEl.textContent = agent.name;
  agentAvatarEl.textContent = agent.avatar || agent.name.slice(0, 1);
  input.placeholder = `跟${agent.name}说点什么...`;
  agentId.value = agent.id;
  agentId.disabled = Boolean(agent.isBuiltin);
  agentAvatarInput.value = agent.avatar || "";
  agentName.value = agent.name || "";
  agentTagline.value = agent.tagline || "";
  agentPersona.value = agent.persona || "";
  agentAppearance.value = agent.appearance || "";
  agentVoiceStyle.value = agent.voiceStyle || "";
  agentRelationship.value = agent.relationship || "";
  agentOpening.value = agent.openingMessage || "";
  agentSystemPrompt.value = agent.systemPrompt || "";
  experienceImageStyle.value = agent.imageStyle || "realistic";
  agentVoiceGender.value = agent.voiceGender || "female";
  agentVoiceTone.value = agent.voiceTone || "warm";
  agentVisualContext.value = agent.visualContext || "";
  state.pendingReferenceImage = null;
  state.pendingAppearanceImage = null;
  state.pendingVoiceSample = null;
  state.clearReferenceImage = false;
  agentReferenceImageInput.value = "";
  appearanceImageInput.value = "";
  voiceCloneInput.value = "";
  voiceSampleText.value = "";
  renderReferencePreview(agent.referenceImage || null);
  renderVoiceClonePreview({
    name: agent.voiceSampleName || "",
    clonedVoiceId: agent.clonedVoiceId || ""
  });
  agentPrompts.value = (agent.prompts || []).join("\n");
  agentBoundaries.value = (agent.boundaries || []).join("\n");
  agentSafetyRules.value = (agent.safetyRules || []).join("\n");
  agentConfigStatus.textContent = agent.isBuiltin ? "内置模板" : "自定义";
  deleteAgentButton.disabled = Boolean(agent.isBuiltin);
  renderQuickActions(agent.prompts || []);
  renderStatus();
}

function renderQuickActions(prompts) {
  quickActions.innerHTML = "";
  for (const prompt of prompts.slice(0, 6)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = prompt;
    button.addEventListener("click", () => enqueueMessage(prompt));
    quickActions.appendChild(button);
  }
}

function renderModelConfig() {
  const config = state.modelConfig || {};
  modelConfigStatus.textContent = modelModeText(config);
  modelConfigHint.textContent = modelHintText(config);
  renderAuthStatus();
  renderLicenseBindingState(config);
}

function setAuthMode(mode) {
  state.authMode = ["login", "register", "reset-password"].includes(mode) ? mode : "login";
  renderAuthMode();
}

function renderAuthMode() {
  const mode = state.authMode || "login";
  const tabs = [
    [authLoginTab, "login"],
    [authRegisterTab, "register"],
    [authResetTab, "reset-password"]
  ];
  for (const [tab, value] of tabs) {
    if (!tab) continue;
    tab.classList.toggle("active", mode === value);
    tab.setAttribute("aria-selected", mode === value ? "true" : "false");
  }

  const needsCode = mode !== "login";
  const authCodeField = authCode?.closest(".auth-code-field");
  if (authCodeField) authCodeField.hidden = !needsCode;
  if (authCode) authCode.disabled = !needsCode;
  if (sendCodeButton) sendCodeButton.disabled = !needsCode;
  if (loginButton) loginButton.hidden = mode !== "login";
  if (registerButton) registerButton.hidden = mode !== "register";
  if (resetPasswordButton) resetPasswordButton.hidden = mode !== "reset-password";
  if (authPassword) {
    authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
    authPassword.placeholder = mode === "login" ? "请输入密码" : "至少 6 位";
  }
}

function renderLicenseBindingState(config = state.modelConfig || {}) {
  const loggedIn = Boolean(state.authUser || config.user?.loggedIn);
  const bound = Boolean(state.authUser?.boundLicense || config.license?.bound);
  const wantsClearLicense = Boolean(clearOfficialLicenseKey?.checked);
  const submitButton = modelConfigForm?.querySelector('button[type="submit"]');
  const canEditLicense = loggedIn && !bound;
  const canClearLocalLicense = loggedIn && bound && wantsClearLicense && Boolean(config.license?.saved || config.license?.mask);

  officialLicenseKey.disabled = !canEditLicense;
  clearOfficialLicenseKey.disabled = !loggedIn;
  if (submitButton) {
    submitButton.disabled = !(canEditLicense || canClearLocalLicense);
    submitButton.textContent = canClearLocalLicense ? "清除本机授权码" : bound ? "已绑定" : loggedIn ? "绑定授权码" : "请先登录";
  }
  if (!loggedIn) {
    officialLicenseKey.placeholder = "登录后填写授权码";
  } else if (bound) {
    officialLicenseKey.placeholder = "授权码已绑定";
  } else {
    officialLicenseKey.placeholder = "输入授权码";
  }
}

async function submitAuth(mode) {
  const account = authAccount.value.trim();
  const password = authPassword.value;
  const code = authCode?.value.trim() || "";
  if (!account || !password) {
    authStatus.textContent = mode === "login" ? "请输入邮箱和密码。" : "请输入邮箱和新密码。";
    return;
  }
  if ((mode === "register" || mode === "reset-password") && !code) {
    authStatus.textContent = "请输入邮箱验证码。";
    return;
  }
  authStatus.textContent = mode === "register" ? "正在注册..." : mode === "reset-password" ? "正在重置密码..." : "正在登录...";
  try {
    const result = await api(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ account, password, code })
    });
    state.authUser = result.user || null;
    if (result.model_config) state.modelConfig = result.model_config;
    authPassword.value = "";
    if (authCode) authCode.value = "";
    renderModelConfig();
    renderStatus();
    addMessage("system", mode === "register" ? "注册成功，已进入免费体验额度。" : mode === "reset-password" ? "密码已重置，已登录。" : "登录成功。");
  } catch (error) {
    authStatus.textContent = error.message;
  }
}

async function sendAuthCode(purpose = "register") {
  const account = authAccount.value.trim();
  if (!account) {
    authStatus.textContent = "请先填写邮箱。";
    return;
  }
  authStatus.textContent = "正在发送验证码...";
  sendCodeButton.disabled = true;
  try {
    const result = await api("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ account, purpose })
    });
    authStatus.textContent = `验证码已发送，有效期 ${Math.round((result.expiresInSeconds || 600) / 60)} 分钟。`;
  } catch (error) {
    authStatus.textContent = error.message;
  } finally {
    setTimeout(() => {
      sendCodeButton.disabled = false;
    }, 3000);
  }
}

async function refreshAuthUser() {
  try {
    const result = await api("/api/auth/me");
    if (result.authPending) {
      authStatus.textContent = "正在恢复登录状态，请稍后刷新。";
      return;
    }
    state.authUser = result.user || null;
    if (result.model_config) state.modelConfig = result.model_config;
    renderModelConfig();
    renderStatus();
  } catch {
    renderAuthStatus();
  }
}

function renderAuthStatus() {
  if (!authStatus) return;
  const user = state.authUser;
  if (!user) {
    authStatus.textContent = "未登录。注册后可获得新用户免费额度。";
    logoutButton.disabled = true;
    return;
  }
  logoutButton.disabled = false;
  if (user.boundLicense) {
    authStatus.textContent = `账号：${user.account}。已绑定授权码 ${user.boundLicense.keyHash}，本月剩余 ${user.boundLicense.remainingThisMonth} / ${user.boundLicense.monthlyLimit}。`;
    return;
  }
  authStatus.textContent = `账号：${user.account}。免费额度剩余 ${user.freeRemaining ?? user.remaining} / ${user.freeLimit}。`;
}

function readModelConfigForm() {
  return {
    officialLicenseKey: officialLicenseKey.value.trim(),
    clearOfficialLicenseKey: Boolean(clearOfficialLicenseKey.checked)
  };
}

function mergeSavedModelConfig(savedConfig = {}, submittedConfig = {}) {
  return {
    ...savedConfig,
    enabled: Boolean(savedConfig.enabled),
    capabilities: savedConfig.capabilities || { image: false, voice: false },
    license: {
      ...(savedConfig.license || {}),
      saved: Boolean(savedConfig.license?.saved || savedConfig.license?.bound),
      enabled: Boolean(savedConfig.license?.enabled || savedConfig.license?.bound)
    },
    user: {
      ...(savedConfig.user || {}),
      loggedIn: Boolean(savedConfig.user?.loggedIn)
    },
    mode: savedConfig.mode || (submittedConfig.officialLicenseKey ? "licensed" : "trial")
  };
}

function renderStatus() {
  const model = state.modelConfig || {};
  const licenseBound = Boolean(state.authUser?.boundLicense || model.license?.bound);
  modePill.textContent = licenseBound ? "已授权" : model.enabled || model.mode === "online" ? "在线" : "体验";
  statusEl.textContent = model.enabled
    ? `${state.activeAgent?.tagline || "角色已就绪"} · 在线服务已启用`
    : licenseBound
      ? `${state.activeAgent?.tagline || "角色已就绪"} · 授权码已启用`
      : `${state.activeAgent?.tagline || "角色已就绪"} · 免费体验模式`;
}

function sourceLabel(source) {
  if (source === "llm" || source === "cloud_license") return "已回复";
  if (source === "local") return "本地回复";
  if (source === "capability_gate") return "能力提示";
  return source || "未知来源";
}

function modelModeText(config) {
  if (config.mode === "online" || config.enabled) return "在线服务已启用";
  if (state.authUser?.boundLicense || config.license?.bound) return "授权码已启用";
  if (config.user?.loggedIn) return "免费账号已登录";
  if (config.license?.pendingBind || config.license?.saved) return "登录后可绑定授权码";
  return "免费体验模式";
}

function modelHintText(config) {
  const imageText = imageCapabilityText(config);
  const audioText = config.capabilities?.voice ? "语音：可用" : "语音：未启用";
  if (config.mode === "online" || config.enabled) {
    return `服务已启用。图片：${imageText}。${audioText}。`;
  }
  if (state.authUser?.boundLicense || config.license?.bound) {
    return `授权已绑定到账号。${config.license?.mask ? `本机仍有待清理授权码：${config.license.mask}。` : ""}`;
  }
  if (config.license?.pendingBind) {
    return "请先登录账号，然后再绑定授权码。";
  }
  if (config.user?.loggedIn) {
    return `已登录免费账号。新用户免费额度可用于文字、图片和语音。图片：${imageText}。${audioText}。`;
  }
  return `未登录时可先体验基础功能；登录后可绑定授权码。图片：${imageText}。${audioText}。`;
}

function initPanelToggles() {
  const leftCollapsed = localStorage.getItem("leftPanelCollapsed") === "true";
  const rightCollapsed = localStorage.getItem("rightPanelCollapsed") === "true";
  setPanelCollapsed("left", leftCollapsed);
  setPanelCollapsed("right", rightCollapsed);

  hideLeftPanel.addEventListener("click", () => setPanelCollapsed("left", true));
  showLeftPanel.addEventListener("click", () => setPanelCollapsed("left", false));
  hideRightPanel.addEventListener("click", () => setPanelCollapsed("right", true));
  showRightPanel.addEventListener("click", () => setPanelCollapsed("right", false));
  toggleLeftPanel.addEventListener("click", () => setPanelCollapsed("left", !document.body.classList.contains("left-collapsed")));
  toggleRightPanel.addEventListener("click", () => setPanelCollapsed("right", !document.body.classList.contains("right-collapsed")));
}

function setPanelCollapsed(side, collapsed) {
  document.body.classList.toggle(`${side}-collapsed`, collapsed);
  localStorage.setItem(`${side}PanelCollapsed`, String(collapsed));
  if (side === "left") {
    leftRail.setAttribute("aria-expanded", String(!collapsed));
    toggleLeftPanel.textContent = collapsed ? "角色 ›" : "‹ 角色";
  } else {
    sidePanel.setAttribute("aria-expanded", String(!collapsed));
    toggleRightPanel.textContent = collapsed ? "‹ 配置" : "配置 ›";
  }
}

function queueExperienceSave() {
  if (!state.activeAgent) return;
  experienceStatus.textContent = "保存中...";
  clearTimeout(state.experienceSaveTimer);
  state.experienceSaveTimer = setTimeout(saveExperienceSettings, 350);
}

async function saveExperienceSettings() {
  if (!state.activeAgent) return;
  try {
    const result = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({
        agent: {
          id: state.activeAgent.id,
          imageStyle: experienceImageStyle.value,
          voiceGender: agentVoiceGender.value,
          voiceTone: agentVoiceTone.value
        }
      })
    });
    state.activeAgent = result.agent || state.activeAgent;
    state.agents = result.agents || state.agents;
    renderAgentList();
    renderStatus();
    experienceStatus.textContent = "已保存";
  } catch (error) {
    experienceStatus.textContent = "保存失败";
    addMessage("system", `体验设置保存失败：${error.message}`);
  }
}

function imageCapabilityText(config) {
  if (config.capabilities?.image) return "可用";
  return "未配置";
}

function renderMemory() {
  const nextMemory = state.memory || {};
  const sections = [
    ["事实", nextMemory.facts],
    ["偏好", nextMemory.preferences],
    ["情绪模式", nextMemory.emotional_patterns],
    ["人物语气", nextMemory.persona_style],
    ["人物价值观", nextMemory.persona_values],
    ["常用表达", nextMemory.persona_catchphrases],
    ["人物语料", nextMemory.persona_corpus],
    ["安全提示", nextMemory.safety_notes]
  ];
  memoryListEl.innerHTML = "";
  let count = 0;
  for (const [label, items] of sections) {
    for (const item of items || []) {
      count += 1;
      const div = document.createElement("div");
      div.className = "memory-item";
      div.textContent = `${label}: ${item.text || item}`;
      memoryListEl.appendChild(div);
    }
  }
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "还没有长期记忆。你可以说“我喜欢...”或“我叫...”。";
    memoryListEl.appendChild(empty);
  }
}

function renderRag(results) {
  ragListEl.innerHTML = "";
  ragStatusEl.textContent = String(results.length);
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "下一轮对话会显示从沉淀记忆召回的片段。";
    ragListEl.appendChild(empty);
    return;
  }
  for (const item of results.slice(0, 5)) {
    const div = document.createElement("div");
    div.className = "memory-item";
    div.textContent = `${item.kind} · ${item.score}: ${item.content}`;
    ragListEl.appendChild(div);
  }
}

function addMessage(role, content, options = {}) {
  const node = createMessageNode(role, content, options);
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return node;
}

function createMessageNode(role, content, options = {}) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  if (options.messageId) node.dataset.messageId = String(options.messageId);
  node.querySelector(".message-meta").textContent = options.meta || (role === "user" ? "你" : role === "assistant" ? state.activeAgent?.name || "角色" : "系统");
  const deleteButton = node.querySelector(".message-delete");
  if (options.messageId && role !== "system") {
    deleteButton.addEventListener("click", () => deleteMessage(options.messageId, node));
  } else {
    deleteButton.hidden = true;
  }
  const body = node.querySelector(".message-body");
  const imageUrl = options.metadata?.imageUrl;
  const b64Json = options.metadata?.b64Json;
  if (options.metadata?.type === "image" && (imageUrl || b64Json)) {
    body.textContent = "";
    const img = document.createElement("img");
    img.className = "generated-image";
    img.alt = "生成图片";
    img.src = imageUrl || `data:image/png;base64,${b64Json}`;
    body.appendChild(img);
  } else if (options.metadata?.type === "voice" && (options.metadata.audio || options.metadata.audioUrl || options.metadata.audioBase64)) {
    renderVoiceBubble(body, {
      audio: normalizeVoiceAudio(options.metadata),
      transcript: options.metadata.transcript || content || ""
    });
  } else if (options.metadata?.type === "tool_error") {
    body.textContent = content || options.metadata.error || "工具调用失败。";
  } else {
    body.textContent = content;
  }
  return node;
}

async function deleteMessage(messageId, node) {
  const result = await api(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
  if (result.recent_messages) {
    renderConversation(result.recent_messages);
  } else {
    node.remove();
  }
}

function renderVoiceBubble(body, { audio, transcript }) {
  body.textContent = "";
  body.classList.add("voice-message-body");
  const bubble = document.createElement("button");
  bubble.type = "button";
  bubble.className = "voice-bubble";
  bubble.innerHTML = `
    <span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="voice-label">语音</span>
    <span class="voice-duration">${estimateVoiceDuration(transcript)}</span>
  `;
  const transcriptEl = document.createElement("div");
  transcriptEl.className = "voice-transcript";
  transcriptEl.textContent = transcript || "暂无转文字内容";
  transcriptEl.hidden = true;

  let pinned = false;
  let pressTimer = null;
  const showTranscript = () => { transcriptEl.hidden = false; };
  const hideTranscript = () => { if (!pinned) transcriptEl.hidden = true; };
  const clearPress = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  };

  bubble.addEventListener("click", () => toggleVoicePlayback(audio, bubble));
  bubble.addEventListener("dblclick", (event) => {
    event.preventDefault();
    pinned = !pinned;
    transcriptEl.hidden = !pinned;
  });
  bubble.addEventListener("pointerdown", () => {
    clearPress();
    pressTimer = setTimeout(showTranscript, 450);
  });
  bubble.addEventListener("pointerup", () => {
    clearPress();
    hideTranscript();
  });
  bubble.addEventListener("pointerleave", () => {
    clearPress();
    hideTranscript();
  });
  bubble.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    pinned = !pinned;
    transcriptEl.hidden = !pinned;
  });

  body.append(bubble, transcriptEl);
}

function normalizeVoiceAudio(metadata) {
  return metadata.audio || {
    audioUrl: metadata.audioUrl || "",
    audioBase64: metadata.audioBase64 || "",
    mimeType: metadata.mimeType || "audio/mpeg"
  };
}

function normalizeTtsAudioResult(result = {}) {
  if (result.audio) return result.audio;
  return {
    audioUrl: result.audioUrl || "",
    audioBase64: result.audioBase64 || "",
    mimeType: result.mimeType || "audio/mpeg",
    format: result.format || "mp3"
  };
}

function estimateVoiceDuration(text) {
  const seconds = Math.max(2, Math.min(60, Math.round(String(text || "").length / 5)));
  return `${seconds}"`;
}

async function playSpeech(text, button) {
  const oldText = button.innerHTML || button.textContent;
  button.disabled = true;
  button.textContent = "合成中...";
  try {
    const result = await api("/api/tts", {
      method: "POST",
      body: JSON.stringify({
        text,
        context: {
          replyText: text,
          history: getVisibleChatHistory(20)
        }
      })
    });
    await playAudioResult(result, button, oldText);
  } catch (error) {
    button.textContent = oldText;
    button.disabled = false;
    addMessage("system", `语音合成失败：${error.message}`);
  }
}

async function playAudioResult(result, button, oldText) {
  const src = audioSourceFromResult(result);
  return new Promise((resolve, reject) => {
    button.textContent = "播放中";
    const audio = new Audio(src);
    audio.addEventListener("ended", () => {
      restoreButtonLabel(button, oldText);
      button.disabled = false;
      resolve();
    });
    audio.addEventListener("error", () => {
      restoreButtonLabel(button, oldText);
      button.disabled = false;
      reject(new Error("音频播放失败"));
    });
    audio.play().catch((error) => {
      restoreButtonLabel(button, oldText);
      button.disabled = false;
      reject(error);
    });
  });
}

function toggleVoicePlayback(result, button) {
  const src = audioSourceFromResult(result);
  if (voicePlayback.audio && voicePlayback.button === button && voicePlayback.src === src) {
    if (voicePlayback.audio.paused) {
      voicePlayback.audio.play().then(() => markVoicePlaying(button)).catch(() => resetVoicePlayback());
    } else {
      voicePlayback.audio.pause();
      markVoicePaused(button);
    }
    return;
  }

  resetVoicePlayback();
  const audio = new Audio(src);
  voicePlayback = {
    audio,
    button,
    src,
    html: button.innerHTML,
    text: button.textContent
  };
  markVoicePlaying(button);
  audio.addEventListener("ended", resetVoicePlayback, { once: true });
  audio.addEventListener("error", resetVoicePlayback, { once: true });
  audio.play().catch(resetVoicePlayback);
}

function resetVoicePlayback() {
  if (voicePlayback.audio) {
    voicePlayback.audio.pause();
    voicePlayback.audio.currentTime = 0;
  }
  if (voicePlayback.button) {
    voicePlayback.button.innerHTML = voicePlayback.html;
    voicePlayback.button.classList.remove("playing", "paused");
    voicePlayback.button.removeAttribute("aria-pressed");
    const label = voicePlayback.button.querySelector(".voice-label");
    if (label) label.textContent = "语音";
  }
  voicePlayback = {
    audio: null,
    button: null,
    src: "",
    html: "",
    text: ""
  };
}

function markVoicePlaying(button) {
  button.classList.add("playing");
  button.classList.remove("paused");
  button.setAttribute("aria-pressed", "true");
  const label = button.querySelector(".voice-label");
  if (label) label.textContent = "播放中";
}

function markVoicePaused(button) {
  button.classList.add("paused");
  button.classList.remove("playing");
  button.setAttribute("aria-pressed", "false");
  const label = button.querySelector(".voice-label");
  if (label) label.textContent = "继续播放";
}

function audioSourceFromResult(result) {
  const src = result.audioUrl || `data:${result.mimeType || "audio/mpeg"};base64,${result.audioBase64}`;
  if (!result.audioUrl && !result.audioBase64) {
    throw new Error("没有生成可播放的语音");
  }
  return src;
}

function restoreButtonLabel(button, value) {
  if (String(value || "").includes("<")) {
    button.innerHTML = value;
  } else {
    button.textContent = value;
  }
}

async function cloneCurrentVoice() {
  if (!state.pendingVoiceSample?.data) {
    renderVoiceClonePreview({ error: "请先上传一段声音样本。" });
    return;
  }
  const oldText = cloneVoiceButton.textContent;
  cloneVoiceButton.disabled = true;
  cloneVoiceButton.textContent = "克隆中...";
  renderVoiceClonePreview({ name: state.pendingVoiceSample.name, ready: true, status: "正在克隆声音..." });
  try {
    const result = await api("/api/voice/clone", {
      method: "POST",
      body: JSON.stringify({
        audioBase64: state.pendingVoiceSample.data,
        fileName: state.pendingVoiceSample.name,
        mime: state.pendingVoiceSample.mime,
        sampleText: voiceSampleText.value.trim()
      })
    });
    const saveResult = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({
        agent: {
          ...readAgentForm(),
          clonedVoiceId: result.voiceId || state.activeAgent?.clonedVoiceId || "",
          voiceSampleName: state.pendingVoiceSample.name || "已克隆声音"
        }
      })
    });
    await applyAgentResult(saveResult);
    renderVoiceClonePreview({
      name: state.pendingVoiceSample.name || "已克隆声音",
      clonedVoiceId: result.voiceId || state.activeAgent?.clonedVoiceId || "pending",
      status: result.voiceId ? "克隆完成，后续语音会优先使用这个声音。" : "已提交克隆，请稍后试听确认。"
    });
  } catch (error) {
    renderVoiceClonePreview({
      name: state.pendingVoiceSample.name,
      ready: true,
      error: friendlyVoiceCloneError(error.message)
    });
  } finally {
    cloneVoiceButton.textContent = oldText;
    cloneVoiceButton.disabled = false;
  }
}

function readAgentForm() {
  const referenceImage = state.clearReferenceImage
    ? null
    : state.pendingReferenceImage || state.activeAgent?.referenceImage || null;
  return {
    id: agentId.value.trim(),
    avatar: agentAvatarInput.value.trim(),
    name: agentName.value.trim(),
    category: state.activeAgent?.category || "custom",
    tagline: agentTagline.value.trim(),
    persona: agentPersona.value.trim(),
    appearance: agentAppearance.value.trim(),
    voiceStyle: agentVoiceStyle.value.trim(),
    relationship: agentRelationship.value.trim(),
    openingMessage: agentOpening.value.trim(),
    systemPrompt: agentSystemPrompt.value.trim(),
    imageStyle: experienceImageStyle.value || "realistic",
    visualContext: agentVisualContext.value.trim(),
    voiceGender: agentVoiceGender.value,
    voiceTone: agentVoiceTone.value,
    clonedVoiceId: state.activeAgent?.clonedVoiceId || "",
    voiceSampleName: state.activeAgent?.voiceSampleName || "",
    referenceImage,
    clearReferenceImage: state.clearReferenceImage,
    prompts: lines(agentPrompts.value),
    boundaries: lines(agentBoundaries.value),
    safetyRules: lines(agentSafetyRules.value),
    isBuiltin: false
  };
}

async function saveReferenceImageChange(successMessage) {
  try {
    const result = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ agent: readAgentForm() })
    });
    state.agents = result.agents || state.agents;
    state.activeAgentId = result.active_agent_id || result.agent?.id || state.activeAgentId;
    state.activeAgent = result.agent || state.activeAgent;
    state.pendingReferenceImage = null;
    state.clearReferenceImage = false;
    agentReferenceImageInput.value = "";
    renderAgentList();
    renderReferencePreview(state.activeAgent?.referenceImage || null, successMessage);
  } catch (error) {
    renderReferencePreview(state.pendingReferenceImage || state.activeAgent?.referenceImage || null, "保存失败，请重新上传。");
    addMessage("system", `参考图保存失败：${error.message}`);
  }
}

function renderReferencePreview(referenceImage, statusText = "") {
  agentReferencePreview.innerHTML = "";
  if (!referenceImage?.data) {
    const empty = document.createElement("span");
    empty.textContent = statusText || "未上传参考图";
    agentReferencePreview.appendChild(empty);
    clearReferenceImageButton.disabled = true;
    return;
  }
  const img = document.createElement("img");
  img.alt = "角色参考图";
  img.src = toDataUrl(referenceImage);
  const meta = document.createElement("span");
  meta.className = "reference-meta";
  const name = document.createElement("strong");
  name.textContent = referenceImage.name || "已上传参考图";
  const status = document.createElement("small");
  status.textContent = statusText || "已保存为锁脸参考图";
  meta.append(name, status);
  agentReferencePreview.append(img, meta);
  clearReferenceImageButton.disabled = false;
}

async function analyzeAppearanceFromImage({
  image = state.pendingAppearanceImage,
  button = analyzeAppearanceButton,
  emptyMessage = "请先上传一张图片。"
} = {}) {
  if (!image?.data) {
    appearanceAnalyzeStatus.textContent = emptyMessage;
    return;
  }
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "识别中...";
  appearanceAnalyzeStatus.textContent = "正在识别外貌特征...";
  try {
    const result = await api("/api/appearance/analyze", {
      method: "POST",
      body: JSON.stringify({
        image,
        currentAppearance: agentAppearance.value.trim()
      })
    });
    agentAppearance.value = result.appearance || agentAppearance.value;
    appearanceAnalyzeStatus.textContent = "已填入外貌特征，保存角色后生效。";
  } catch (error) {
    appearanceAnalyzeStatus.textContent = error.message || "识别失败，请换一张清晰图片重试。";
  } finally {
    button.textContent = oldText;
    button.disabled = false;
  }
}

function renderVoiceClonePreview({ name = "", clonedVoiceId = "", ready = false, status = "", error = "" } = {}) {
  voiceClonePreview.innerHTML = "";
  const text = document.createElement("span");
  if (error) {
    text.textContent = error;
    text.className = "error-text";
  } else if (status) {
    text.textContent = status;
  } else if (ready && name) {
    text.textContent = `已选择样本：${name}`;
  } else if (clonedVoiceId) {
    text.textContent = name ? `已启用克隆声音：${name}` : "已启用克隆声音";
  } else {
    text.textContent = "未上传声音样本";
  }
  voiceClonePreview.appendChild(text);
}

function readImageFile(file) {
  return readFileAsBase64(file).then(({ data, mime, name }) => ({ data, mime, name }));
}

async function loadPersonaCorpusFiles(files, sourceLabel) {
  const allFiles = files || [];
  if (!allFiles.length) return;
  const readable = allFiles.filter(isSupportedCorpusFile);
  const skipped = allFiles.length - readable.length;
  const maxFiles = 200;
  const maxTotalBytes = 8 * 1024 * 1024;
  const selected = readable.slice(0, maxFiles);
  let totalBytes = 0;
  const blocks = [];

  personaCorpusStatus.textContent = `正在读取${sourceLabel}...`;
  for (const file of selected) {
    if (totalBytes + file.size > maxTotalBytes) break;
    totalBytes += file.size;
    try {
      const text = (await readTextFile(file)).trim();
      if (text) {
        const path = file.webkitRelativePath || file.name;
        blocks.push(`\n\n===== ${path} =====\n${text}`);
      }
    } catch {
      // Ignore unreadable files in mixed folders.
    }
  }

  if (!blocks.length) {
    personaCorpusStatus.textContent = "没有读到可用文本";
    return;
  }

  const existing = personaCorpusText.value.trim();
  personaCorpusText.value = [existing, ...blocks].filter(Boolean).join("\n");
  const limited = readable.length > selected.length ? `，仅读取前 ${selected.length} 个` : "";
  const sizeMb = (totalBytes / 1024 / 1024).toFixed(1);
  personaCorpusStatus.textContent = `已读取 ${blocks.length} 个文本文件，约 ${sizeMb}MB${limited}${skipped ? `，跳过 ${skipped} 个非文本文件` : ""}`;
}

function personaCorpusSourceName() {
  const folderFile = personaCorpusFolder.files?.[0];
  if (folderFile?.webkitRelativePath) return folderFile.webkitRelativePath.split("/")[0] || "资料文件夹";
  const files = Array.from(personaCorpusFile.files || []);
  if (files.length > 1) return `${files.length} 个资料文件`;
  return files[0]?.name || "";
}

function isSupportedCorpusFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const mime = String(file?.type || "").toLowerCase();
  if (file.size > 2 * 1024 * 1024) return false;
  return [
    ".txt", ".md", ".markdown", ".srt", ".vtt", ".json", ".jsonl", ".csv", ".tsv", ".log",
    ".yaml", ".yml"
  ].some((ext) => name.endsWith(ext))
    || [
      "text/plain", "text/markdown", "text/csv", "text/tab-separated-values",
      "application/json", "application/x-ndjson"
    ].includes(mime);
}

function isSupportedVoiceSample(file) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  return [".mp3", ".wav"].some((ext) => name.endsWith(ext))
    || ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"].includes(mime);
}

function friendlyVoiceCloneError(message) {
  const value = String(message || "");
  if (value.includes("有效人声时长") || value.includes("duration")) {
    return "有效人声时长不在 5 到 10 秒内。建议录 6 到 9 秒，开头结尾少留空白。";
  }
  if (value.includes("mp3") || value.includes("wav") || value.includes("5 到 10 秒") || value.includes("请先上传")) {
    return value.slice(0, 160);
  }
  if (value.includes("授权") || value.includes("权限") || value.includes("接口不可用") || value.includes("stepaudio")) {
    return value.slice(0, 160);
  }
  return "请换一段 5 到 10 秒的清晰 mp3/wav 人声后重试。";
}

function readAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration);
      cleanup();
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("无法读取音频时长"));
    };
    audio.src = url;
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        data: dataUrl.split(",")[1] || "",
        mime: file.type || "application/octet-stream",
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  });
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file, "utf-8");
  });
}

function toDataUrl(referenceImage) {
  const data = String(referenceImage.data || "");
  if (data.startsWith("data:image/")) return data;
  return `data:${referenceImage.mime || "image/png"};base64,${data}`;
}

function setBusy(isBusy) {
  const button = composer.querySelector("button");
  if (button) {
    button.disabled = isBusy;
    button.textContent = isBusy
      ? pendingChatCount > 1 ? `排队中 ${pendingChatCount}` : "发送中"
      : "发送";
  }
  input.disabled = isBusy;
}

function lines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonTextarea(element, label) {
  const value = element.value.trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be an object");
    }
    return parsed;
  } catch {
    throw new Error(`${label} 必须是合法 JSON 对象`);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    const data = parseApiError(text);
    const error = new Error(data.error || data.message || response.statusText);
    error.status = response.status;
    error.code = data.code || "";
    error.upgrade = data.upgrade || null;
    error.quota = data.quota || null;
    throw error;
  }
  return response.json();
}

function parseApiError(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  try {
    const data = JSON.parse(value);
    return data && typeof data === "object" ? data : { error: value };
  } catch {
    return { error: value };
  }
}
