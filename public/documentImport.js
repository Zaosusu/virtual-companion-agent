let pdfJsModulePromise = null;

export async function extractPdfText(file, { onProgress = null, readImagePage = null } = {}) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdfDocument = await loadingTask.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      onProgress?.(pageNumber, pdfDocument.numPages, "reading");
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items || []) {
        if (typeof item.str !== "string") continue;
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : "";
      }
      let normalized = normalizePageText(pageText);
      if (!normalized) {
        if (typeof readImagePage !== "function") {
          throw new Error("这份 PDF 是扫描图片，需要登录并绑定授权码后识别。");
        }
        onProgress?.(pageNumber, pdfDocument.numPages, "recognizing");
        const image = await renderPdfPageImage(page, pageNumber);
        normalized = normalizePageText(await readImagePage({ pageNumber, image }));
      }
      if (normalized) pages.push(`--- 第 ${pageNumber} 页 ---\n${normalized}`);
      page.cleanup?.();
    }
  } finally {
    await pdfDocument.destroy();
  }
  return pages.join("\n\n").trim();
}

export function friendlyPdfError(error) {
  const message = String(error?.message || error || "");
  if (/登录|授权码|额度/.test(message)) return message.trim();
  if (/password/i.test(message)) return "PDF 有密码保护";
  if (/invalid|corrupt|malformed/i.test(message)) return "PDF 文件损坏或格式不正确";
  return message || "无法读取 PDF 内容";
}

export function normalizePageText(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("./vendor/pdfjs/pdf.js?v=4.10.38").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/public/vendor/pdfjs/pdf.worker.js?v=4.10.38";
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

async function renderPdfPageImage(page, pageNumber) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, 1800 / Math.max(1, baseViewport.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("页面图片生成失败")), "image/jpeg", 0.88);
  });
  const image = await blobToBase64Payload(blob, `document-page-${pageNumber}.jpg`);
  canvas.width = 1;
  canvas.height = 1;
  return image;
}

function blobToBase64Payload(blob, name) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("页面图片读取失败"));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve({
        data: value.includes(",") ? value.split(",").at(-1) : value,
        mime: blob.type || "image/jpeg",
        name
      });
    };
    reader.readAsDataURL(blob);
  });
}
