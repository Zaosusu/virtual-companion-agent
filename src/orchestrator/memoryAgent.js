import { buildTurnSummary, compressConversation, extractMemoryCandidates } from "../agent.js";

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
    && (retrievalPlan.factSeeking || retrievalPlan.intent !== "general")
    && (preliminary.length < 2 || retrievalPlan.intent === "awards");

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

  const bestScore = initialUseful[0]?.evidenceScore || 0;
  const quality = bestScore >= 0.52 ? "good" : bestScore >= 0.34 ? "partial" : "poor";
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

function evaluateEvidence(items, plan) {
  return items.map((item) => ({
    ...item,
    evidenceScore: Number(evidenceScore(item, plan).toFixed(4)),
    evidenceRank: evidenceRank(item, plan),
    evidenceGrade: gradeEvidence(item, plan),
    evidenceIssues: evidenceIssues(item, plan)
  }));
}

function evidenceRank(item, plan) {
  const content = String(item.content || "");
  if (plan.intent === "awards") return awardStructureCount(content) * 10 + Number(item.scanHits || 0);
  return Number(item.scanHits || 0);
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

function evidenceScore(item, plan) {
  const content = String(item.content || "");
  const base = Number(item.score || 0);
  const fts = Number(item.ftsScore || 0);
  const semantic = Number(item.semanticScore || 0);
  const confidence = Number(item.confidence || 0.6);
  const scanBonus = item.retrievalQuery === "keyword_scan" ? Math.min(0.22, Number(item.scanHits || 0) * 0.06) : 0;
  const structureBonus = plan.intent === "awards" ? Math.min(0.3, awardStructureCount(content) * 0.08) : 0;
  const score = (base * 0.2)
    + (fts * 0.16)
    + (semantic * 0.1)
    + (confidence * 0.05)
    + factSignalScore(content, plan)
    + intentMatchScore(content, plan)
    + scanBonus
    + structureBonus
    - noiseScore(item, plan);
  return Math.min(1, Math.max(0, score));
}

function factSignalScore(content, plan) {
  let score = 0;
  if (/\d{4}|20\d{2}|19\d{2}/.test(content)) score += 0.08;
  if (/获奖|奖项|竞赛|主办方|项目|入围|决赛|一等奖|二等奖|三等奖|优秀奖|第\d+名|WAIC|OPC|Hackathon|黑客松|FutureTech|Douyin/i.test(content)) score += 0.12;
  if (/获奖项目|奖项性质|官网|筛选过程|比赛名称|成绩/.test(content)) score += 0.1;
  if (plan.factSeeking && /目录|数据结构|文件状态|已填充|内容摘要|README/.test(content)) score -= 0.14;
  return score;
}

function intentMatchScore(content, plan) {
  if (plan.intent === "awards") return awardEvidenceScore(content);
  if (plan.intent === "projects") {
    return /项目|产品|App|公司|创业|用户|MVP|抖音|账号|MCN|project|product|startup/i.test(content) ? 0.12 : -0.12;
  }
  if (plan.intent === "education") {
    return /学校|大学|专业|毕业|南艺|南京艺术学院|学生|education|school|college/i.test(content) ? 0.12 : -0.12;
  }
  return 0;
}

function awardEvidenceScore(content) {
  const structural = awardStructureCount(content);
  const contextSignals = [/WAIC|OPC|Hackathon|黑客松|微电影节|创新创业比赛|大赛|FutureTech|Douyin/i];
  const weakSignals = [/获奖/, /奖项/, /竞赛/, /决赛/, /入围/, /名次/];
  const context = contextSignals.filter((re) => re.test(content)).length;
  const weak = weakSignals.filter((re) => re.test(content)).length;
  if (structural >= 2) return 0.36;
  if (structural === 1 && (weak >= 1 || context >= 1)) return 0.28;
  if (structural === 1) return 0.18;
  if (context >= 1 && weak >= 1) return 0.16;
  if (weak >= 2) return 0.08;
  if (context >= 1 || /比赛|项目/.test(content)) return -0.18;
  return -0.24;
}

function awardStructureCount(content) {
  const structuralSignals = [
    /获奖项目/,
    /奖项性质/,
    /主办方/,
    /筛选过程/,
    /官网/,
    /比赛名称/,
    /成绩/,
    /一等奖|二等奖|三等奖|优秀奖|菁英奖|最佳[^，。；\n]{0,12}奖/,
    /第[一二三四五六七八九十\d]+名/
  ];
  return structuralSignals.filter((re) => re.test(content)).length;
}

function noiseScore(item, plan) {
  const content = String(item.content || "");
  let penalty = 0;
  if (item.kind === "persona_style" || item.kind === "persona_value" || item.kind === "persona_catchphrase") {
    penalty += plan.factSeeking ? 0.32 : 0.08;
  }
  if (/常用表达|口头禅|语气特征|互动习惯|价值观\/在意的事/.test(content)) penalty += plan.factSeeking ? 0.28 : 0.05;
  if (/人生档案馆\/README|数据结构|目录|文件状态|已填充|内容摘要/.test(content)) penalty += plan.factSeeking ? 0.2 : 0.06;
  if (plan.intent === "awards" && /家庭成员|亲密关系|伴侣|配偶|宠物|人物档案[:：]|职业头衔|公司职位/.test(content)) penalty += 0.28;
  if (content.length < 18) penalty += 0.08;
  return penalty;
}

function gradeEvidence(item, plan) {
  const content = String(item.content || "");
  const score = evidenceScore(item, plan);
  if (plan.intent === "awards" && awardEvidenceScore(content) < 0.28) return "reject";
  if (plan.factSeeking && score < 0.28) return "reject";
  if (score >= 0.52) return "strong";
  if (score >= 0.34) return "usable";
  return plan.factSeeking ? "reject" : "weak";
}

function evidenceIssues(item, plan) {
  const content = String(item.content || "");
  const issues = [];
  if (plan.factSeeking && /常用表达|口头禅|语气特征|互动习惯|价值观/.test(content)) issues.push("style_noise");
  if (/README|目录|数据结构|文件状态|已填充|内容摘要/.test(content)) issues.push("directory_noise");
  if (plan.intent === "awards" && awardEvidenceScore(content) < 0.28) issues.push("award_intent_mismatch");
  if (plan.factSeeking && !/\d{4}|奖|项目|主办方|入围|决赛|WAIC|OPC|Hackathon|黑客松|FutureTech|Douyin/i.test(content)) issues.push("low_fact_signal");
  return issues;
}
