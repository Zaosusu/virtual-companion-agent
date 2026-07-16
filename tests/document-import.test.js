import assert from "node:assert/strict";
import test from "node:test";
import {
  isPdfCorpusFile,
  isSupportedCorpusTextFile,
  selectCorpusTextRange,
  splitCorpusText
} from "../public/corpusImport.js";
import { normalizePageText } from "../public/documentImport.js";
import { relayDocumentPageRead } from "../src/tools/documentRead.js";

test("corpus range selection supports all, head, and tail without mixing order", () => {
  const text = Array.from({ length: 6 }, (_, index) => `第 ${index + 1} 段。`).join("\n\n");
  assert.equal(splitCorpusText(text).length, 6);
  const head = selectCorpusTextRange(text, "head", 2);
  assert.equal(head.selected, 2);
  assert.match(head.text, /第 1 段/);
  assert.doesNotMatch(head.text, /第 6 段/);
  const tail = selectCorpusTextRange(text, "tail", 2);
  assert.equal(tail.selected, 2);
  assert.match(tail.text, /第 5 段/);
  assert.match(tail.text, /第 6 段/);
  const all = selectCorpusTextRange(text, "all", 1);
  assert.equal(all.selected, 6);
});

test("corpus file detection includes PDF and common UTF-8 text formats", () => {
  assert.equal(isPdfCorpusFile({ name: "archive.PDF", type: "" }), true);
  assert.equal(isPdfCorpusFile({ name: "scan", type: "application/pdf" }), true);
  assert.equal(isSupportedCorpusTextFile({ name: "notes.md", type: "" }), true);
  assert.equal(isSupportedCorpusTextFile({ name: "video.mp4", type: "video/mp4" }), false);
  assert.equal(normalizePageText("第一行   \n\n\n第二行"), "第一行\n\n第二行");
});

test("scanned PDF page relay sends a multimodal document-reading request", async () => {
  let request = null;
  const result = await relayDocumentPageRead({
    baseUrl: "https://role-api.example.com/",
    authToken: "desktop-token",
    image: { data: "aGVsbG8=", mime: "image/jpeg" },
    pageNumber: 3,
    model: "vision-model",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: "页面正文" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.text, "页面正文");
  assert.equal(request.url, "https://role-api.example.com/api/chat");
  assert.equal(request.options.headers.authorization, "Bearer desktop-token");
  assert.equal(request.body.orchestratorTask, "tool_document_read");
  assert.equal(request.body.messages[1].content[1].type, "image_url");
  assert.match(request.body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test("scanned PDF relay normalizes auth, quota, and empty-page failures", async () => {
  const auth = await relayDocumentPageRead({ image: { data: "x" } });
  assert.equal(auth.status, 401);
  assert.equal(auth.data.code, "authorization_required");

  const quota = await relayDocumentPageRead({
    baseUrl: "https://role-api.example.com",
    authToken: "token",
    image: { data: "x" },
    fetchImpl: async () => new Response(JSON.stringify({ code: "quota_exceeded" }), { status: 429 })
  });
  assert.equal(quota.status, 429);
  assert.equal(quota.data.code, "quota_exceeded");

  const empty = await relayDocumentPageRead({
    baseUrl: "https://role-api.example.com",
    authToken: "token",
    image: { data: "x" },
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })
  });
  assert.equal(empty.status, 502);
  assert.equal(empty.data.code, "document_page_empty");
});
