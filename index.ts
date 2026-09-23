import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { cacheUsage, contextFill, fit, formatDuration, formatNumber, loadedSkills, mcpToolCount, planModeFromStatus, sessionMode, sessionStartedAt, skillFromPath, TokenSpeed, workspace, type Item } from "./telemetry.ts";

export default function piHud(pi: ExtensionAPI) {
  const speed = new TokenSpeed();
  let cache = { input: 0, cacheRead: 0, cost: 0, tokens: 0, percent: 0 };
  let skills = new Set<string>();
  let startedAt = Date.now();
  let planMode: boolean | undefined;
  let requestRender: (() => void) | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  const renderSoon = () => {
    if (!requestRender || renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      requestRender?.();
    }, 50);
    renderTimer.unref?.();
  };

  /** Persisted plan-mode state, or undefined when the extension has never run. */
  const readPlanMode = (ctx: ExtensionContext) => {
    const stored = sessionMode(ctx.sessionManager.getBranch());
    return stored === undefined ? undefined : stored === "PLAN";
  };

  const resetSession = (ctx: ExtensionContext) => {
    const branch = ctx.sessionManager.getBranch();
    cache = cacheUsage(branch);
    skills = new Set(loadedSkills(branch));
    startedAt = sessionStartedAt(branch);
    planMode = readPlanMode(ctx);
    speed.stop();
  };

  const installFooter = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    resetSession(ctx);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(() => requestRender?.(), 1_000);
    clockTimer.unref?.();

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(() => {
        planMode = readPlanMode(ctx);
        requestRender?.();
      });
      return {
        invalidate() {},
        dispose() {
          unsubscribe();
          requestRender = undefined;
        },
        render(width: number) {
          const planActive = planModeFromStatus(footerData.getExtensionStatuses());
          const mode = planActive ?? (planMode === true);
          const known = planActive !== undefined || planMode !== undefined;
          const gitBranch = footerData.getGitBranch();
          const model = ctx.model;
          const mcpCount = mcpToolCount(pi.getActiveTools());
          const speedText = speed.value === undefined ? "—" : speed.value < 100 ? speed.value.toFixed(1) : String(Math.round(speed.value));

          const promptTokens = cache.input + cache.cacheRead;
          const fill = model ? contextFill(cache.tokens, model.contextWindow) : undefined;
          const first = fit([
            { text: `🔢 TOKEN/CACHE ${formatNumber(cache.input)}/${formatNumber(promptTokens)} (${Math.round(cache.percent)}%)`, priority: 95, tone: "accent" },
            ...(fill ? [{ text: `🧠 CTX ${formatNumber(fill.tokens)}/${formatNumber(fill.contextWindow)} (${Math.round(fill.percent)}%)`, priority: fill.percent >= 75 ? 115 : 75, tone: fill.percent >= 75 ? "warning" as const : "success" as const }] : []),
            { text: `🧠 THINK ${pi.getThinkingLevel()}`, priority: 100, tone: "warning" },
            { text: `${!known ? "❔" : mode ? "🧭" : "✨"} MODE ${!known ? "?" : mode ? "PLAN" : "VIBE"}`, priority: 110, tone: mode ? "accent" : "success" },
            { text: `⚡ SPEED ${speedText} tok/s`, priority: 80, tone: "success" },
          ], width);
          const second = fit([
            { text: `📁 ${workspace(ctx.cwd)}${gitBranch ? ` (${gitBranch})` : ""}`, priority: 20, tone: "success" },
            { text: `💰 $${cache.cost.toFixed(cache.cost < 10 ? 3 : 2)}`, priority: 45, tone: "accent" },
            { text: `🤖 ${model ? `${model.provider}/${model.id}` : "no model"}`, priority: 100, tone: "accent" },
            { text: `🕒 ${formatDuration(Date.now() - startedAt)}`, priority: 60, tone: "success" },
            { text: `🧩 SKILL ${skills.size ? [...skills].join(",") : "—"}`, priority: 40, tone: "accent" },
            ...(mcpCount ? [{ text: `🔌 ${mcpCount}`, priority: 50, tone: "warning" as const }] : []),
          ], width);
          const renderLine = (items: Item[]) => truncateToWidth(
            items.map((item) => theme.fg(item.tone, item.text)).join(theme.fg("dim", "  │  ")),
            width,
          );

          return [renderLine(first), renderLine(second)];
        },
      };
    });
  };

  pi.on("session_start", (_event, ctx) => installFooter(ctx));
  pi.on("session_tree", (_event, ctx) => resetSession(ctx));
  pi.on("model_select", (_event, ctx) => {
    if (ctx.mode === "tui") requestRender?.();
  });
  pi.on("thinking_level_select", () => requestRender?.());
  pi.on("tool_call", (event) => {
    if (event.toolName !== "read") return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string") return;
    const name = skillFromPath(path);
    if (name) {
      skills.add(name);
      requestRender?.();
    }
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") speed.start();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    const update = event.assistantMessageEvent;
    if (update.type !== "text_delta" && update.type !== "thinking_delta" && update.type !== "toolcall_delta") return;
    speed.update(update.delta, update.partial.usage?.output);
    renderSoon();
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const usage = (event.message as AssistantMessage).usage;
    cache.input += usage.input;
    cache.cacheRead += usage.cacheRead;
    cache.cost += usage.cost?.total ?? 0;
    cache.tokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const total = cache.input + cache.cacheRead;
    cache.percent = total ? (cache.cacheRead / total) * 100 : 0;
    speed.stop();
    requestRender?.();
  });

  pi.on("turn_end", () => requestRender?.());

  pi.on("session_shutdown", (_event, ctx) => {
    if (renderTimer) clearTimeout(renderTimer);
    if (clockTimer) clearInterval(clockTimer);
    renderTimer = undefined;
    clockTimer = undefined;
    requestRender = undefined;
    speed.stop();
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}