export function shouldRunKeywordScan({ retrievalPlan, preliminary = [] }) {
  return (retrievalPlan.factSeeking || retrievalPlan.intent !== "general")
    && (preliminary.length < 2 || retrievalPlan.intent === "awards");
}

export function classifyRetrievalQuality(useful = []) {
  const bestScore = useful[0]?.evidenceScore || 0;
  const quality = bestScore >= 0.52 ? "good" : bestScore >= 0.34 ? "partial" : "poor";
  return { bestScore, quality };
}

export function evaluateEvidence(items, plan) {
  return items.map((item) => ({
    ...item,
    evidenceScore: Number(evidenceScore(item, plan).toFixed(4)),
    evidenceRank: evidenceRank(item, plan),
    evidenceGrade: gradeEvidence(item, plan),
    evidenceIssues: evidenceIssues(item, plan)
  }));
}

export function evidenceScore(item, plan) {
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

function evidenceRank(item, plan) {
  const content = String(item.content || "");
  if (plan.intent === "awards") return awardStructureCount(content) * 10 + Number(item.scanHits || 0);
  return Number(item.scanHits || 0);
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
