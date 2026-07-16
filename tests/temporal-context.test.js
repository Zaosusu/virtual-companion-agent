import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemporalContext,
  formatTemporalContextInstruction,
  normalizeTemporalContext
} from "../src/orchestrator/temporalContext.js";

test("temporal context preserves local time and conversation gap", () => {
  const context = buildTemporalContext({
    now: new Date("2026-07-16T12:30:00.000Z"),
    timeZone: "Asia/Shanghai",
    history: [
      { role: "user", createdAt: "2026-07-15T11:00:00.000Z" },
      { role: "assistant", createdAt: "2026-07-15T11:02:00.000Z" }
    ]
  });
  const instruction = formatTemporalContextInstruction(context);

  assert.equal(context.timeZone, "Asia/Shanghai");
  assert.equal(context.recentTimeline.length, 2);
  assert.match(instruction, /2026/);
  assert.match(instruction, /晚上/);
  assert.match(instruction, /1 天 1 小时/);
  assert.match(instruction, /不要每轮报时/);
});

test("temporal context normalizes invalid values", () => {
  const normalized = normalizeTemporalContext({
    now: "not-a-date",
    timeZone: "invalid/time-zone",
    recentTimeline: [{ role: "assistant", at: "bad" }]
  }, { fallbackNow: new Date("2026-07-16T00:00:00.000Z") });

  assert.equal(normalized.timeZone, "Asia/Shanghai");
  assert.equal(normalized.now, "2026-07-16T00:00:00.000Z");
  assert.deepEqual(normalized.recentTimeline, []);
});
