# pi-minimalist-hud

A compact, two-line telemetry footer for [Pi](https://pi.dev). Everything you need while a session is running — cache rate, context fill, cost, token speed, workspace, model, skills, MCP tools — without stealing vertical space.

Everything fits in ~90 columns, so at typical terminal widths nothing is dropped.

```
🔢 88% cache  │  📦 42.1k/200k (21%)  │  🧭 PLAN  │  ⚡ 62 tok/s
📁 pi-hud (main)  │  💰 $0.42  │  🤖 claude-sonnet-4-5  │  🕒 12m  │  🧩 ponytail  │  🔌 3
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
| `🔢` | Cache-hit rate — the share of prompt tokens the provider served from cache. `88% cache` is the number that actually varies; raw uncached/total counts are available in `/usage`. |
| `📦` | Context-window fill for the active model. Turns yellow past 60% and red past 85%, and gains a `!` at 90% — the signal to `/compact`. |
| `💰` | Accumulated session cost, summed from per-message usage reported by the provider. |
| `🧭` | `PLAN` / `VIBE`. Reads [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) state, falling back to that extension's live status. Shows `?` when plan mode is not installed at all, rather than guessing. |
| `⚡` | Rolling output tokens/second over a 2-second window, from streamed deltas. |
| `🧠` | Active thinking level. |
| `📁` | Project directory name plus the current Git branch — not the full path, which does not change and does not fit. |
| `🕒` | Elapsed session time. |
| `🧩` | Skills whose `SKILL.md` was read through Pi's `read` tool in the active session. Hidden when none have been loaded. |
| `🔌` | Count of active MCP tools, inferred from tool names. |

## Development

```bash
npm install
npm test        # node:test, no test framework
npm run typecheck
```

Pure logic lives in `telemetry.ts` and is covered by `telemetry.test.ts`. `index.ts` only wires Pi events to that logic and renders the footer.

## Limitations

- The `🔌` count is a heuristic over tool names; a non-MCP tool whose name contains `mcp` can be counted. It appears only when the count is non-zero.
- Context fill is derived from the last request's token count, so it reads slightly low mid-stream and corrects as soon as the response's usage arrives.
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