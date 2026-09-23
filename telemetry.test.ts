import assert from "node:assert/strict";
import test from "node:test";
import { cacheUsage, contextFill, fit, formatDuration, formatNumber, loadedSkills, mcpToolCount, planModeFromStatus, sessionMode, sessionStartedAt, skillFromPath, TokenSpeed, workspace } from "./telemetry.ts";

test("aggregates cache usage from assistant messages", () => {
  const usage = { input: 10, cacheRead: 90, output: 5, cacheWrite: 0, totalTokens: 105, cost: { total: 0.25 } };
  assert.deepEqual(
    cacheUsage([
      { type: "message", message: { role: "assistant", usage: usage as never } },
      { type: "message", message: { role: "user" } },
    ]),
    { input: 10, cacheRead: 90, cost: 0.25, tokens: 105, percent: 90 },
  );
});

test("finds loaded skills and active MCP tools", () => {
  assert.deepEqual(loadedSkills([{
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", name: "read", arguments: { path: "/skills/ponytail/SKILL.md" } }],
    },
  }]), ["ponytail"]);
  assert.equal(mcpToolCount(["github_search", "read"]), 0);
  assert.equal(mcpToolCount(["mcp__github__search", "read", "github-mcp"]), 2);
  assert.equal(mcpToolCount([]), 0);
});

test("formats elapsed session usage", () => {
  assert.equal(sessionStartedAt([{ timestamp: "2026-09-23T10:00:00.000Z" }]), Date.parse("2026-09-23T10:00:00.000Z"));
  assert.equal(formatDuration(3_723_000), "1h 2m");
  assert.equal(formatDuration(83_000), "1m 23s");
});

test("detects latest plan-mode state with VIBE fallback", () => {
  assert.equal(sessionMode([]), undefined);
  assert.equal(sessionMode([
    { type: "custom", customType: "plan-mode-state", data: { enabled: true } },
  ]), "PLAN");
  assert.equal(sessionMode([
    { type: "custom", customType: "plan-mode-state", data: { enabled: true } },
    { type: "custom", customType: "plan-mode-state", data: { enabled: false } },
  ]), "VIBE");
  assert.equal(planModeFromStatus(new Map([["plan-mode", "plan active"]])), true);
  assert.equal(planModeFromStatus(new Map([["plan-mode", "plan saved"]])), false);
  assert.equal(planModeFromStatus(new Map()), undefined);
});

test("fits footer lines by evicting the lowest priority item", () => {
  const items = [
    { text: "high", priority: 100, tone: "accent" as const },
    { text: "low", priority: 10, tone: "accent" as const },
  ];
  assert.deepEqual(fit(items, 80).map((item) => item.text), ["high", "low"]);
  assert.deepEqual(fit(items, 10).map((item) => item.text), ["high"]);
  assert.deepEqual(fit(items, 0).map((item) => item.text), ["high"]);
});

test("shortens workspace paths and derives context fill", () => {
  assert.equal(workspace("/Users/me/proj", "/Users/me"), "~/proj");
  assert.equal(workspace("/Users/me", "/Users/me"), "~");
  assert.equal(workspace("/tmp/x", "/Users/me"), "/tmp/x");
  assert.deepEqual(contextFill(50_000, 200_000), { tokens: 50_000, contextWindow: 200_000, percent: 25 });
  assert.equal(contextFill(1_000, 0), undefined);
});

test("derives skill names and formats numbers", () => {
  assert.equal(skillFromPath("/skills/ponytail/SKILL.md"), "ponytail");
  assert.equal(skillFromPath("C:\\x\\council\\SKILL.md"), "council");
  assert.equal(skillFromPath("/skills/README.md"), undefined);
  assert.equal(formatNumber(9_500), "9.5k");
});

test("computes rolling output token speed", () => {
  const speed = new TokenSpeed();
  speed.start(1_000);
  speed.update("hello", 10, 1_100);
  speed.update(" world", 20, 2_100);
  assert.equal(speed.value, 20);
  speed.stop();
});
