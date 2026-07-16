export function splitCorpusText(text, maxLength = 900) {
  const paragraphs = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }
    const sentences = paragraph.split(/(?<=[。！？!?])\s*/).map((item) => item.trim()).filter(Boolean);
    let current = "";
    for (const sentence of sentences) {
      if (sentence.length > maxLength) {
        if (current) chunks.push(current);
        current = "";
        for (let offset = 0; offset < sentence.length; offset += maxLength) {
          chunks.push(sentence.slice(offset, offset + maxLength));
        }
        continue;
      }
      if (current && current.length + sentence.length > maxLength) {
        chunks.push(current);
        current = "";
      }
      current += sentence;
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

export function selectCorpusTextRange(text, mode = "all", count = 100) {
  const chunks = splitCorpusText(text);
  const safeCount = Math.max(1, Math.min(1000, Number(count) || 100));
  if (mode === "head") {
    return { text: chunks.slice(0, safeCount).join("\n\n"), selected: Math.min(chunks.length, safeCount), total: chunks.length };
  }
  if (mode === "tail") {
    const selected = chunks.slice(-safeCount);
    return { text: selected.join("\n\n"), selected: selected.length, total: chunks.length };
  }
  return { text: chunks.join("\n\n"), selected: chunks.length, total: chunks.length };
}

export function isSupportedCorpusTextFile(file = {}) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  return [
    ".txt", ".md", ".markdown", ".srt", ".vtt", ".json", ".jsonl", ".csv", ".tsv", ".log",
    ".yaml", ".yml"
  ].some((ext) => name.endsWith(ext)) || [
    "text/plain", "text/markdown", "text/csv", "text/tab-separated-values",
    "application/json", "application/x-ndjson"
  ].includes(mime);
}

export function isPdfCorpusFile(file = {}) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  return name.endsWith(".pdf") || mime === "application/pdf";
}
