import assert from "node:assert/strict";
import test from "node:test";
import { optimizeAgentDraft } from "../src/tools/agentOptimization.js";

test("agent optimization accepts only normalized editor fields", async () => {
  const requests = [];
  const result = await optimizeAgentDraft({
    draft: { name: "小沐", persona: "温柔陪伴者" },
    memories: [{ kind: "persona_corpus", content: "说话简短，喜欢先听用户说完。" }],
    llm: { apiKey: "test", baseUrl: "https://example.invalid", model: "test-model", mode: "cloud_license" },
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          name: "小沐",
          persona: "温柔、耐心，会先听用户说完的陪伴者。",
          openingSuggestions: ["聊聊今天", "告诉我发生了什么", "从一个故事开始", "第四条"],
          unsafeModelParameter: "must be removed"
        }) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(requests[0].url, "https://example.invalid/api/chat");
  assert.equal(result.agent.name, "小沐");
  assert.match(result.agent.persona, /先听用户说完/);
  assert.deepEqual(result.agent.openingSuggestions, ["聊聊今天", "告诉我发生了什么", "从一个故事开始"]);
  assert.equal("unsafeModelParameter" in result.agent, false);
});

test("agent optimization retries malformed JSON once", async () => {
  let calls = 0;
  const result = await optimizeAgentDraft({
    draft: { name: "角色", persona: "草稿" },
    targetField: "persona",
    llm: { apiKey: "test", baseUrl: "https://example.invalid/v1", model: "test-model", mode: "self_hosted" },
    fetchImpl: async () => {
      calls += 1;
      const content = calls === 1 ? "not json" : '{"persona":"修复后的完整人设"}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.agent.persona, "修复后的完整人设");
  assert.equal(result.targetField, "persona");
});
