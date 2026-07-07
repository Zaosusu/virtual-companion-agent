import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity, embedText, searchableText } from "../src/rag.js";

test("searchableText keeps Chinese search grams", () => {
  const text = searchableText("我喜欢深夜写作");

  assert.match(text, /喜欢/);
  assert.match(text, /写作/);
});

test("embedding similarity is higher for related text", () => {
  const query = embedText("喜欢写作");
  const related = embedText("我喜欢深夜写作");
  const unrelated = embedText("今天去跑步");

  assert.ok(cosineSimilarity(query, related) > cosineSimilarity(query, unrelated));
});
