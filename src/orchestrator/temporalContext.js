const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const MAX_TIMELINE_ITEMS = 8;

export function buildTemporalContext({ now = new Date(), timeZone = detectedTimeZone(), history = [] } = {}) {
  const current = validDate(now) || new Date();
  const zone = normalizeTimeZone(timeZone);
  const recentTimeline = (Array.isArray(history) ? history : [])
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "",
      at: validDate(item?.createdAt || item?.timestamp)?.toISOString() || ""
    }))
    .filter((item) => item.role && item.at)
    .slice(-MAX_TIMELINE_ITEMS);
  return {
    version: 1,
    now: current.toISOString(),
    timeZone: zone,
    recentTimeline
  };
}

export function normalizeTemporalContext(value = {}, { fallbackNow = new Date() } = {}) {
  const input = value && typeof value === "object" ? value : {};
  return buildTemporalContext({
    now: validDate(input.now) || validDate(fallbackNow) || new Date(),
    timeZone: input.timeZone,
    history: Array.isArray(input.recentTimeline)
      ? input.recentTimeline.map((item) => ({ role: item?.role, createdAt: item?.at }))
      : []
  });
}

export function formatTemporalContextInstruction(value = {}, { fallbackNow = new Date() } = {}) {
  const context = normalizeTemporalContext(value, { fallbackNow });
  const now = new Date(context.now);
  const latest = context.recentTimeline.at(-1);
  const elapsedMs = latest ? Math.max(0, now.getTime() - new Date(latest.at).getTime()) : null;
  const timeline = context.recentTimeline.map((item) => {
    const label = item.role === "assistant" ? "角色回复" : "用户消息";
    return `- ${label}：${formatDateTime(new Date(item.at), context.timeZone, { includeWeekday: false })}`;
  });
  return [
    "[TIME_CONTEXT]",
    `当前用户本地时间：${formatDateTime(now, context.timeZone)}（${context.timeZone}，${localDayPhase(now, context.timeZone)}）。`,
    elapsedMs === null ? "当前没有可用的上一轮消息时间。" : `距最近一条历史消息约 ${formatElapsed(elapsedMs)}。`,
    timeline.length ? `最近消息时间线：\n${timeline.join("\n")}` : "",
    "时间规则：把今天、昨晚、明天、刚才、过一会儿、好久不见等相对时间按上述本地时间和消息间隔理解。",
    "短间隔视为连续交流；跨小时或跨天时先判断旧场景是否已经过去，不要把旧消息误当成刚刚发生。",
    "只有与用户当前内容有关时才自然体现时间变化；不要每轮报时，也不要擅自声称等待、想念或发生了用户未说明的事情。",
    "[/TIME_CONTEXT]"
  ].filter(Boolean).join("\n");
}

function detectedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function normalizeTimeZone(value) {
  const zone = String(value || "").trim().slice(0, 80) || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function validDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(date, timeZone, { includeWeekday = true } = {}) {
  const options = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  };
  if (includeWeekday) options.weekday = "long";
  return new Intl.DateTimeFormat("zh-CN", options).format(date).replace(/\//g, "-");
}

function localDayPhase(date, timeZone) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).find((part) => part.type === "hour")?.value || 0);
  if (hour < 5) return "凌晨";
  if (hour < 9) return "早晨";
  if (hour < 12) return "上午";
  if (hour < 14) return "中午";
  if (hour < 18) return "下午";
  if (hour < 23) return "晚上";
  return "深夜";
}

function formatElapsed(milliseconds) {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}
