import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";

export type Tone = "accent" | "success" | "warning" | "error";
export type Item = { text: string; priority: number; tone: Tone };

/** Skill name from a `read` path pointing at `.../<skill>/SKILL.md`. */
export function skillFromPath(path: string) {
  return path.match(/(?:^|[/\\])([^/\\]+)[/\\]SKILL\.md$/i)?.[1];
}

/** Drop the lowest-priority items until the joined line fits `width`. */
export function fit(items: Item[], width: number): Item[] {
  const visible = [...items];
  const text = () => visible.map((item) => item.text).join("  |  ");
  while (visible.length > 1 && visibleWidth(text()) > width) {
    const lowest = Math.min(...visible.map((item) => item.priority));
    visible.splice(visible.findIndex((item) => item.priority === lowest), 1);
  }
  return visible;
}

/** Project directory name, for a footer that should not spend 30 columns on a path. */
export function projectName(cwd: string, home = homedir()) {
  if (cwd === home) return "~";
  return cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;
}

type Entry = {
  type?: string;
  timestamp?: string;
  customType?: string;
  data?: unknown;
  message?: {
    role?: string;
    timestamp?: number;
    usage?: AssistantMessage["usage"];
    content?: unknown;
  };
};

export function cacheUsage(entries: readonly Entry[]) {
  let input = 0;
  let cacheRead = 0;
  let cost = 0;
  let tokens = 0;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant" || !entry.message.usage) continue;
    const usage = entry.message.usage;
    input += usage.input;
    cacheRead += usage.cacheRead;
    cost += usage.cost?.total ?? 0;
    tokens += usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  }
  const total = input + cacheRead;
  return { input, cacheRead, cost, tokens, percent: total ? (cacheRead / total) * 100 : 0 };
}

/** Context-window fill from the last request's token count. */
export function contextFill(tokens: number, contextWindow: number) {
  if (!contextWindow || contextWindow <= 0) return undefined;
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
}

export function loadedSkills(entries: readonly Entry[]) {
  const skills = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const item of entry.message.content) {
      if (!item || typeof item !== "object") continue;
      const call = item as { type?: unknown; name?: unknown; arguments?: { path?: unknown } };
      const path = call.type === "toolCall" && call.name === "read" && typeof call.arguments?.path === "string"
        ? call.arguments.path
        : undefined;
      const name = path ? skillFromPath(path) : undefined;
      if (name) skills.add(name);
    }
  }
  return [...skills];
}

export function mcpToolCount(activeNames: readonly string[]) {
  return activeNames.filter((name) => /(?:^|[^a-z])mcp(?:[^a-z]|$)/i.test(name)).length;
}

export function sessionStartedAt(entries: readonly Entry[], fallback = Date.now()) {
  const first = entries[0];
  const messageTime = first?.message?.timestamp;
  if (typeof messageTime === "number") return messageTime < 100_000_000_000 ? messageTime * 1_000 : messageTime;
  const entryTime = first?.timestamp ? Date.parse(first.timestamp) : Number.NaN;
  return Number.isFinite(entryTime) ? entryTime : fallback;
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Plan/VIBE from persisted `@narumitw/pi-plan-mode` state, or undefined when that extension never ran. */
export function sessionMode(entries: readonly Entry[]): "PLAN" | "VIBE" | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== "plan-mode-state") continue;
    return typeof entry.data === "object" && entry.data !== null && (entry.data as { enabled?: unknown }).enabled === true
      ? "PLAN"
      : "VIBE";
  }
  return undefined;
}

/**
 * Live plan-mode signal. `sessionMode` only sees persisted state, which a fresh
 * session has not written yet — the extension's own status text covers that gap.
 */
export function planModeFromStatus(statuses: ReadonlyMap<string, string> | undefined): boolean | undefined {
  const status = statuses?.get("plan-mode");
  if (status === undefined) return undefined;
  return status === "plan active" || status === "plan ready";
}

export class TokenSpeed {
  private startedAt = 0;
  private chars = 0;
  private usageOutput = 0;
  private estimatedOutput = 0;
  private samples: { at: number; tokens: number }[] = [];
  value: number | undefined;

  start(at = Date.now()) {
    this.startedAt = at;
    this.chars = 0;
    this.usageOutput = 0;
    this.estimatedOutput = 0;
    this.samples = [];
    this.value = undefined;
  }

  update(delta: string, outputTokens: number | undefined, at = Date.now()) {
    if (!this.startedAt) return;
    this.chars += delta.length;
    let added = 0;
    if (typeof outputTokens === "number" && outputTokens > this.usageOutput) {
      added = outputTokens - this.usageOutput;
      this.usageOutput = outputTokens;
      this.estimatedOutput = outputTokens;
    } else if (!this.usageOutput) {
      const estimate = Math.ceil(this.chars / 4);
      added = Math.max(0, estimate - this.estimatedOutput);
      this.estimatedOutput = estimate;
    }
    if (added) this.samples.push({ at, tokens: added });
    this.samples = this.samples.filter((sample) => at - sample.at <= 2_000);
    if (!this.samples.length) return;
    const elapsed = Math.max(250, at - this.samples[0]!.at);
    this.value = this.samples.reduce((sum, sample) => sum + sample.tokens, 0) / (elapsed / 1_000);
  }

  stop() {
    this.startedAt = 0;
    this.samples = [];
  }
}

export function formatNumber(value: number) {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
