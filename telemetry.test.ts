import assert from "node:assert/strict";
import test from "node:test";
import { cacheUsage, contextFill, fit, formatDuration, formatNumber, loadedSkills, mcpToolCount, parseProviderUsage, planModeFromStatus, sessionMode, sessionStartedAt, skillFromPath, TokenSpeed, usageText, workspace } from "./telemetry.ts";

test("aggregates cache usage from assistant messages", () => {
  const usage = { input: 10, cacheRead: 90, totalTokens: 100, cost: { total: 0.25 } };
  assert.deepEqual(
    cacheUsage([
      { type: "message", message: { role: "assistant", usage: usage as never } },
      { type: "message", message: { role: "user" } },
    ]),
    { input: 10, cacheRead: 90, cost: 0.25, percent: 90 },
  );
});

test("parses supported provider quotas and rejects malformed values", () => {
  assert.deepEqual(
    parseProviderUsage("openai-codex", {
      "x-codex-primary-used-percent": "21",
      "x-codex-primary-window-minutes": "300",
      "x-codex-secondary-used-percent": "8",
      "x-codex-secondary-window-minutes": "10080",
    }),
    {
      provider: "openai-codex",
      windows: [
        { label: "5h", usedPercent: 21 },
        { label: "weekly", usedPercent: 8 },
      ],
    },
  );
  assert.equal(parseProviderUsage("anthropic", {
    "anthropic-ratelimit-unified-5h-utilization": "nope",
    "anthropic-ratelimit-unified-7d-utilization": "0.1",
  }), undefined);
  assert.deepEqual(parseProviderUsage("wally", {
    "X-RateLimit-Limit-Requests": "100",
    "X-RateLimit-Remaining-Requests": "25",
    "X-RateLimit-Remaining-Tokens": "12000",
  }), {
    provider: "wally",
    windows: [
      { label: "req", usedPercent: 75 },
      { label: "tok", remaining: 12000 },
    ],
  });
});

test("finds loaded skills and active MCP tools", () => {
  assert.deepEqual(loadedSkills([{
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", name: "read", arguments: { path: "/skills/ponytail/SKILL.md" } }],
    },
  }]), ["ponytail"]);
  assert.equal(mcpToolCount(["github_search", "read"], [
    { name: "github_search", sourceInfo: { path: "/extensions/mcp-github.ts", source: "mcp-github" } },
    { name: "read", sourceInfo: { path: "builtin", source: "builtin" } },
  ]), 1);
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

test("shortens workspace paths and picks a known context fill", () => {
  assert.equal(workspace("/Users/me/proj", "/Users/me"), "~/proj");
  assert.equal(workspace("/Users/me", "/Users/me"), "~");
  assert.equal(workspace("/tmp/x", "/Users/me"), "/tmp/x");
  assert.deepEqual(contextFill({ tokens: 50_000, contextWindow: 200_000, percent: 25 }, 1), { tokens: 50_000, contextWindow: 200_000, percent: 25 });
  assert.equal(contextFill({ tokens: null, contextWindow: 200_000, percent: null }, 1), undefined);
  assert.equal(contextFill(undefined, 1), undefined);
});

test("derives skill names, provider usage text and skill paths consistently", () => {
  assert.equal(skillFromPath("/skills/ponytail/SKILL.md"), "ponytail");
  assert.equal(skillFromPath("C:\\x\\council\\SKILL.md"), "council");
  assert.equal(skillFromPath("/skills/README.md"), undefined);
  assert.equal(usageText({ provider: "p", windows: [{ label: "5h", usedPercent: 21.4 }] }, "p"), "5h 21%");
  assert.equal(usageText({ provider: "p", windows: [{ label: "tok", remaining: 12_000 }] }, "p"), "tok 12k left");
  assert.equal(usageText(undefined, "openai-codex"), "SSE required");
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
