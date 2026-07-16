import assert from "node:assert/strict";
import test from "node:test";
import { createCompanionReply } from "../src/agent.js";

test("an attached image is sent as vision input instead of an image generation request", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "我看到了这张图片。" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const reply = await createCompanionReply({
      character: {
        id: "vision-role",
        name: "角色",
        persona: "自然回应用户的角色。",
        voice: { style: "自然口语" },
        runtime_config: { responseStyle: "balanced", creativityLevel: 0.6 }
      },
      memory: {},
      message: "我给你看一张图片：photo.png",
      history: [],
      llm: { apiKey: "test", baseUrl: "https://example.invalid/v1", model: "vision-model", mode: "self_hosted", imageOutputAvailable: true },
      userImage: { data: "aGVsbG8=", mime: "image/png", name: "photo.png" }
    });

    assert.equal(reply.source, "llm");
    assert.equal(reply.capability.type, "vision_input");
    const userContent = requestBody.messages.at(-1).content;
    assert.equal(Array.isArray(userContent), true);
    assert.equal(userContent[0].type, "text");
    assert.equal(userContent[1].type, "image_url");
    assert.match(userContent[1].image_url.url, /^data:image\/png;base64,/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
