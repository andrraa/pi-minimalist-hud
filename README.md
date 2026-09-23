# pi-minimalist-hud

A compact, two-line telemetry footer for [Pi](https://pi.dev). Everything you need while a session is running — token usage, context fill, cost, token speed, workspace, model, skills, MCP tools — without stealing vertical space.

```
🔢 TOKEN/CACHE 1.2M/10.4M (88%)  │  🧠 CTX 42.1k/200k (21%)  │  🧭 MODE PLAN  │  ⚡ SPEED 62 tok/s
📁 ~/Projects/api (main)  │  💰 $0.418  │  🤖 anthropic/claude-sonnet-4-5  │  🕒 12m 4s  │  🧩 SKILL ponytail
```

Items whose priority is too low to fit the current terminal width are dropped automatically, so the HUD degrades gracefully instead of wrapping.

## Install

```bash
pi install npm:@mrwyck/pi-minimalist-hud
```

From a local checkout:

```bash
pi --extension ./index.ts
```

> **Only one custom footer can be active.** Disable other footer extensions first, e.g. `@firstpick/pi-extension-git-footer-status`.

## What each item means

| Item | Meaning |
| --- | --- |
| `TOKEN/CACHE` | Uncached prompt tokens / total prompt tokens, with cache-hit rate. `1.2M/10.4M (88%)` means 88% of the prompt was served from cache. |
| `CTX` | Context-window fill for the active model. Turns warning-colored past 75% — the signal to `/compact`. |
| `COST` | Accumulated session cost, summed from per-message usage reported by the provider. |
| `MODE` | `PLAN` / `VIBE`. Reads [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) state, falling back to that extension's live status. Shows `MODE ?` when plan mode is not installed at all, rather than guessing. |
| `SPEED` | Rolling output tokens/second over a 2-second window, from streamed deltas. |
| `WORKSPACE` | `$HOME`-relative working directory, plus the current Git branch. |
| `SKILL` | Skills whose `SKILL.md` was read through Pi's `read` tool in the active session. |
| `MCP` | Count of active MCP tools, inferred from tool name and source metadata. |

## Development

```bash
npm install
npm test        # node:test, no test framework
npm run typecheck
```

Pure logic lives in `telemetry.ts` and is covered by `telemetry.test.ts`. `index.ts` only wires Pi events to that logic and renders the footer.

## Limitations

- The `MCP` count is a heuristic over tool name and source path; a non-MCP tool with `mcp` in its metadata can be counted. It appears only when the count is non-zero.
- Provider quota windows are deliberately not shown: every provider exposes them differently, and a row that is meaningless or wrong on half the providers costs more attention than it earns. Use `/usage` or the provider's own dashboard when you need it.
- Token speed is estimated from `chars / 4` until the provider reports real output tokens for the message.
- `SKILL` reflects skills read in the current session, not every skill installed.

## Releasing

Publishing is automated by `.github/workflows/publish.yml` on version tags, using npm trusted publishing (OIDC — no `NPM_TOKEN` secret to rotate):

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "chore: release 0.2.0"
git tag v0.2.0
git push && git push --tags
```

One-time setup: on npmjs.com, open the package → **Settings → Trusted Publisher → GitHub Actions**, and set repository `andrraa/pi-minimalist-hud`, workflow `publish.yml`. The workflow refuses to publish if the tag and `package.json` version disagree.

## License

MIT