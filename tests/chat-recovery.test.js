import assert from "node:assert/strict";
import test from "node:test";
import {
  isUncertainChatError,
  requestChatWithRecovery,
  waitForChatCompletion
} from "../public/chatRecovery.js";

test("chat recovery returns a completed server result without resending", async () => {
  let sends = 0;
  const result = await requestChatWithRecovery({
    requestId: "req-completed",
    send: async () => {
      sends += 1;
      const error = new Error("temporary gateway disconnect");
      error.status = 502;
      throw error;
    },
    getStatus: async () => ({ state: "completed", response: { request_id: "req-completed", recovered: true } })
  });
  assert.equal(sends, 1);
  assert.equal(result.recovered, true);
});

test("chat recovery retries the exact request only when the server has not seen it", async () => {
  let sends = 0;
  const result = await requestChatWithRecovery({
    requestId: "req-retry",
    send: async () => {
      sends += 1;
      if (sends === 1) {
        const error = new Error("network failed");
        error.status = 0;
        throw error;
      }
      return { request_id: "req-retry", ok: true };
    },
    getStatus: async () => ({ state: "not_found" })
  });
  assert.equal(sends, 2);
  assert.equal(result.ok, true);
});

test("chat completion polling distinguishes pending and not found", async () => {
  let polls = 0;
  const completed = await waitForChatCompletion({
    requestId: "req-poll",
    maxWaitMs: 20,
    intervalMs: 1,
    sleep: async () => {},
    getStatus: async () => {
      polls += 1;
      return polls < 2 ? { state: "pending" } : { state: "completed", response: { ok: true } };
    }
  });
  assert.equal(completed.state, "completed");
  const missing = await waitForChatCompletion({
    requestId: "req-missing",
    getStatus: async () => {
      const error = new Error("missing");
      error.status = 404;
      error.code = "request_not_found";
      throw error;
    }
  });
  assert.equal(missing.state, "not_found");
  assert.equal(isUncertainChatError({ status: 429 }), false);
  assert.equal(isUncertainChatError({ status: 504 }), true);
});
