import { buildTurnSummary, compressConversation, extractMemoryCandidates } from "../agent.js";
import { classifyRetrievalQuality, evaluateEvidence, evidenceScore, shouldRunKeywordScan } from "./memoryPolicy.js";

export {
  buildTurnSummary,
  compressConversation,
  extractMemoryCandidates
};

export function buildMemoryWritePlan({ agentId, message, reply = {}, userMessageId, assistantMessageId }) {
  const writes = extractMemoryCandidates(message).map((candidate) => ({
    ...candidate,
    sourceMessageId: userMessageId,
    metadata: { bucket: candidate.bucket, extractedBy: "regex-v0", agentId }
  }));

  if (reply.safety?.level === "crisis") {
    writes.push({
      kind: "safety_note",
      text: "危机安全提示",
      content: "用户曾出现可能涉及自伤或轻生的表达，后续陪伴需要优先关注现实安全与求助路径。",
      importance: 0.95,
      confidence: 0.65,
      sourceMessageId: userMessageId,
      metadata: { safetyLevel: "crisis", agentId }
    });
  }

  writes.push({
    kind: "summary",
    content: buildTurnSummary({ message, reply }),
    importance: 0.35,
    confidence: 0.65,
    sourceMessageId: assistantMessageId || userMessageId,
    metadata: { workflow: reply.workflow, mood: reply.mood, agentId }
  });

  return writes;
}

export function runCragRetrieval({ store, agentId = "", message = "", history = [], limit = 8 }) {
  const retrievalPlan = buildRetrievalPlan({ message, history });
  const rounds = [];
  const seen = new Map();

  for (const query of retrievalPlan.queries) {
    const results = store.retrieveMemories(query, { limit: 16, agentId });
    rounds.push({ query, count: results.length, mode: "retrieve" });
    mergeEvidence(seen, results, retrievalPlan, query);
  }

  const preliminary = evaluateEvidence([...seen.values()], retrievalPlan)
    .filter((item) => item.evidenceGrade !== "reject");

  const shouldScan = typeof store.scanMemories === "function"
    && shouldRunKeywordScan({ retrievalPlan, preliminary });

  if (shouldScan) {
    const scanTerms = scanTermsForPlan(retrievalPlan);
    const scanned = store.scanMemories({ terms: scanTerms, limit: 60, agentId });
    rounds.push({ query: `scan:${scanTerms.join("|")}`, count: scanned.length, mode: "keyword_scan" });
    mergeEvidence(seen, scanned, retrievalPlan, "keyword_scan");
  }

  const evaluated = evaluateEvidence([...seen.values()], retrievalPlan)
    .sort((left, right) => (right.evidenceScore - left.evidenceScore) || (right.evidenceRank - left.evidenceRank));

  const initialUseful = evaluated
    .filter((item) => item.evidenceGrade !== "reject")
    .slice(0, limit);

  const { bestScore, quality } = classifyRetrievalQuality(initialUseful);
  const strictEvidence = retrievalPlan.factSeeking || quality !== "good";
  const useful = strictEvidence && quality === "poor" ? [] : initialUseful;

  return {
    retrievedMemories: useful,
    retrievalPlan: {
      ...retrievalPlan,
      rounds,
      quality,
      bestScore,
      rejectedCount: evaluated.length - useful.length,
      evidenceCount: useful.length,
      strictEvidence
    }
  };
}

function mergeEvidence(seen, items, plan, query) {
  for (const item of items || []) {
    const candidate = { ...item, retrievalQuery: query };
    const key = candidate.chunkId || candidate.memoryId || `${candidate.kind}:${candidate.content}`;
    const previous = seen.get(key);
    if (!previous || evidenceScore(candidate, plan) > evidenceScore(previous, plan)) {
      seen.set(key, candidate);
    }
  }
}

function buildRetrievalPlan({ message = "", history = [] }) {
  const raw = String(message || "").trim();
  const recentTopic = inferRecentTopic(history);
  const underspecified = isUnderspecified(raw);
  const expanded = underspecified && recentTopic ? `${recentTopic} ${raw}` : raw;
  const intent = detectIntent(`${expanded} ${recentTopic}`);
  const factSeeking = isFactSeeking(raw, recentTopic) || intent === "awards";
  const focused = buildFocusedQuery(expanded || recentTopic || raw);

  const queries = [
    expanded,
    focused,
    recentTopic && factSeeking ? `${recentTopic} fact evidence source detail` : "",
    factSeeking ? `${expanded} award prize competition date place project organizer source` : ""
  ].map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return {
    originalQuery: raw,
    rewrittenQuery: expanded || raw,
    focusedQuery: focused,
    recentTopic,
    intent,
    factSeeking,
    underspecified,
    queries: [...new Set(queries)].slice(0, 4)
  };
}

function inferRecentTopic(history = []) {
  const recent = [...history]
    .reverse()
    .map((item) => String(item.content || ""))
    .filter(Boolean)
    .slice(0, 6)
    .join("\n");

  if (/奖|获奖|比赛|竞赛|大赛|名次|第\d+名|WAIC|OPC|Hackathon|黑客松|微电影节|award|prize|competition|contest/i.test(recent)) {
    return "奖项 比赛 获奖经历 awards prizes competitions";
  }
  if (/项目|创业|公司|产品|App|账号|抖音|MCN|project|startup|product/i.test(recent)) {
    return "项目 创业 产品经历 projects startups products";
  }
  if (/学校|大学|专业|毕业|南艺|南京艺术学院|education|school|college/i.test(recent)) {
    return "学习经历 education";
  }
  if (/家庭|父亲|母亲|伴侣|配偶|亲人|宠物|family|partner|spouse|pet/i.test(recent)) {
    return "家庭关系 family";
  }
  if (/低谷|抑郁|崩盘|失败|转折|人生阶段|failure|turning point/i.test(recent)) {
    return "人生低谷 转折经历";
  }
  return "";
}

function detectIntent(text) {
  if (/奖|获奖|比赛|竞赛|大赛|名次|第\d+名|WAIC|OPC|Hackathon|黑客松|微电影节|award|awards|prize|competition|contest|FutureTech|Douyin/i.test(text)) {
    return "awards";
  }
  if (/项目|创业|公司|产品|App|账号|抖音|MCN|project|startup|product/i.test(text)) return "projects";
  if (/学校|大学|专业|毕业|南艺|南京艺术学院|education|school|college/i.test(text)) return "education";
  return "general";
}

function isUnderspecified(text) {
  const clean = String(text || "").replace(/\s+/g, "");
  return clean.length <= 8 || /^(具体一点|详细点|展开说|然后呢|还有呢|继续|说下去|再具体点|more|details?|specific)[？?。！!]*$/i.test(clean);
}

function isFactSeeking(text, recentTopic = "") {
  return /具体|详细|多少|哪些|哪几个|什么时候|哪年|哪里|地点|奖|比赛|获奖|经历|事实|证据|资料库|档案|原文|编造|幻觉|specific|detail|more|award|prize|competition|contest|fact|evidence|source|hallucination/i.test(`${text} ${recentTopic}`);
}

function buildFocusedQuery(text) {
  const terms = String(text || "").match(/[a-z0-9_+#.-]{2,}|[\p{Script=Han}]{2,}/giu) || [];
  const keep = terms.filter((term) => !/具体一点|详细点|展开|然后|还有|继续|说下去|more|detail|specific/i.test(term));
  return [...new Set(keep)].slice(0, 18).join(" ");
}

function scanTermsForPlan(plan) {
  if (plan.intent === "awards") {
    return [
      "获奖",
      "奖项",
      "获奖项目",
      "奖项性质",
      "主办方",
      "筛选过程",
      "一等奖",
      "优秀奖",
      "菁英奖",
      "WAIC",
      "OPC",
      "Hackathon",
      "黑客松",
      "微电影节",
      "FutureTech",
      "Douyin"
    ];
  }
  if (plan.intent === "projects") return ["项目", "产品", "App", "MVP", "用户", "创业", "公司", "抖音", "MCN", "project", "product"];
  if (plan.intent === "education") return ["学校", "大学", "专业", "毕业", "南艺", "南京艺术学院", "education"];
  return buildFocusedQuery(plan.rewrittenQuery || plan.originalQuery).split(/\s+/).filter(Boolean);
}
