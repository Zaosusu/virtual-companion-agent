const crisisPatterns = [
  /自杀|轻生|不想活|结束生命|活不下去|伤害自己|割腕|跳楼/,
  /suicide|kill myself|self[- ]?harm/i
];

const medicalLegalFinancePatterns = [
  /诊断|吃什么药|处方|法律意见|投资建议|买哪只股票|贷款|借贷|medical|legal|investment/i
];

export function detectSafety(message) {
  if (crisisPatterns.some((pattern) => pattern.test(message))) {
    return { level: "crisis", note: "Detected possible self-harm or life-threatening language." };
  }
  if (medicalLegalFinancePatterns.some((pattern) => pattern.test(message))) {
    return { level: "bounded", note: "Detected high-stakes domain; companion should stay supportive and non-prescriptive." };
  }
  return { level: "normal", note: "" };
}
