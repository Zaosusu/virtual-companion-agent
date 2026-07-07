const VECTOR_SIZE = 256;

export function searchableText(text) {
  return tokenize(text).join(" ");
}

export function embedText(text) {
  const vector = Array.from({ length: VECTOR_SIZE }, () => 0);
  for (const token of tokenize(text)) {
    const index = hashToken(token) % VECTOR_SIZE;
    vector[index] += token.length > 1 ? 1.4 : 0.7;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function cosineSimilarity(left, right) {
  if (!left?.length || !right?.length) return 0;
  let sum = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    sum += Number(left[index] || 0) * Number(right[index] || 0);
  }
  return sum;
}

export function buildFtsQuery(text) {
  const terms = tokenize(text)
    .filter((token) => token.length >= 2)
    .slice(0, 16)
    .map((token) => `"${token.replaceAll('"', '""')}"`);
  return terms.join(" OR ");
}

function tokenize(input) {
  const text = String(input || "").toLowerCase().trim();
  if (!text) return [];

  const asciiTerms = text.match(/[a-z0-9_+#.-]{2,}/g) || [];
  const cjk = Array.from(text.replace(/[^\p{Script=Han}]/gu, ""));
  const cjkGrams = [];
  for (let index = 0; index < cjk.length; index += 1) {
    cjkGrams.push(cjk[index]);
    if (index < cjk.length - 1) cjkGrams.push(`${cjk[index]}${cjk[index + 1]}`);
    if (index < cjk.length - 2) cjkGrams.push(`${cjk[index]}${cjk[index + 1]}${cjk[index + 2]}`);
  }

  return [...new Set([...asciiTerms, ...cjkGrams])];
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
