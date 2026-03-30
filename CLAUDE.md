# Herdmode

Desktop app for monitoring active Claude Code sessions. Shows real-time status, tasks, git branches, GitHub PRs, and CI checks.

## Quick Reference

```bash
bun run dev              # Server (:3001) + Vite (:5173) with hot reload
bun run dev:desktop      # Build web + bundle Electron + launch app (:13117)
bun run build            # Full production build (AppImage + .deb)
```

## Architecture

Bun monorepo with three packages:

- **`packages/server/`** — Hono REST API + WebSocket server. Reads Claude data from `~/.claude/`, polls GitHub via `gh` CLI, watches filesystem for changes.
- **`packages/web/`** — React 19 frontend built with Vite. Connects to server via WebSocket for real-time updates.
- **`packages/desktop/`** — Electron shell that embeds the server directly (imports from `../../server/src/`) and serves the web build as static files. Bundled with esbuild because cross-package imports break tsc's rootDir.

### Data Flow

```
~/.claude/{sessions,projects,tasks}/  →  fs.watch + 2s polling fallback
     ↓
  server reads & enriches (status derivation, PR cache lookup)
     ↓
  WebSocket broadcast (200ms debounce) to all connected clients
     ↓
  React frontend updates, triggers desktop notifications on status change
```

### Key Server Files

| File | Purpose |
|---|---|
| `sessions.ts` | Reads `~/.claude/sessions/*.json`, enriches with project data, derives status |
| `projects.ts` | Parses JSONL conversation history for branch, message count, token usage, last activity. Falls back to `git rev-parse` when JSONL is missing. |
| `github.ts` | `gh` CLI wrapper with in-memory cache (60s TTL), polls every 30s. Skips default branches (main/master/develop). |
| `ws.ts` | WebSocket client management, file watchers, triggers GitHub polling |
| `focus.ts` | Focuses terminal window via process tree traversal + `hyprctl` (Hyprland-specific) |
| `app.ts` | Hono routes — `createApp(staticRoot?)` factory shared between standalone server and Electron |
| `types.ts` | Shared TypeScript interfaces — server types.ts and web types.ts must stay in sync manually |

### Session Status Logic (`sessions.ts`)

Status is derived from JSONL conversation data:
- **working** — Last message from user, or recent `tool_use` stop reason
- **waiting** — Assistant finished (`end_turn`) or tool approval pending (>10s gap after `tool_use`)
- **waiting_on_agent** — Like waiting, but last tool was `Agent` (sub-agent)
- **idle** — No activity for >60s
- **ended** — Process not alive

### GitHub Integration (`github.ts`)

- Uses `gh pr list --head <branch> --json ... --limit 1` run via `execFile` in session's cwd
- Skips branches in `SKIP_BRANCHES` set (main, master, develop, development)
- Cache keyed by `cwd::branch`, entries expire after 60s
- Frontend also has matching `SKIP_BRANCHES` in `GitHubPR.tsx` to hide the integration box entirely for default branches
- `forceRefreshPR()` bypasses cache TTL for the manual refresh button

### Notification Debouncing (`useSessionSocket.ts`)

Notifications are delayed 5s to avoid spam from rapid status flicker (e.g. tool calls). If a session goes back to `working` within 5s, the pending notification is cancelled. Idle notifications are skipped if waiting was already notified.

## Conventions

- **No npm/npx** — System uses Bun only. All scripts use `bun`/`bunx`.
- **Types are duplicated** between server and web packages (no shared package). Keep `packages/server/src/types.ts` and `packages/web/src/types.ts` in sync when changing interfaces.
- **Plain CSS** — All styles in `packages/web/src/App.css`, no CSS framework.
- **No test framework** currently set up.
- **Integration stubs** — Linear, Notion, Slack components exist as UI placeholders in `packages/web/src/components/integrations/`.
- **Electron port** is hardcoded to 13117 in `packages/desktop/src/main.ts`.
- **Standalone server port** defaults to 3001 (PORT env var) in `packages/server/src/index.ts`.

## Common Tasks

**Adding a new field to Session**: Update `types.ts` in both server and web packages. Populate it in `sessions.ts:readAllSessions()`. Use it in the appropriate React component.

**Adding a new integration**: Create a component in `packages/web/src/components/integrations/`. Add it to `SessionDetail.tsx`. If it needs server data, add the field to Session types and populate in `sessions.ts`.

**Rebuilding after server changes**: The Electron app bundles server code via esbuild. Run `bun run dev:desktop` or `cd packages/desktop && bun run build` to pick up changes. The standalone `bun run dev` uses tsx with --watch and auto-reloads.

**Testing the desktop build**: Kill any running Herdmode processes first (`pkill -f "electron dist/main.js"`), then `cd packages/desktop && bun run build && bunx electron dist/main.js`.
