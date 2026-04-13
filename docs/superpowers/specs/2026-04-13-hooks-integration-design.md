# Claude Code Hooks Integration

Replace heuristic-based status detection with real-time hook events from Claude Code. Hooks push state changes to herdmode via HTTP, giving instant and accurate session status. File-based JSONL parsing stays as fallback for sessions without hooks configured.

## Decisions

- **Hooks as primary, file polling as fallback** — hook state takes priority when present; existing JSONL heuristics remain untouched as the fallback path.
- **All hook events in Phase 1** — no subset; endpoints are cheap and uniform.
- **Port 3001** — hooks POST to the same port as the main server (configurable via `PORT` env var). The setup skill writes the user's configured port.
- **Hook events trigger immediate broadcast** — endpoints call `scheduleBroadcast()` (200ms debounce) for instant WebSocket updates. The 2s polling cycle also runs as before.
- **No staleness timeout** — existing `process.kill(pid, 0)` liveness check during polling handles crashed sessions. No new arbitrary thresholds.
- **Hook State Store approach** — a `Map<sessionId, HookSessionState>` holds real-time state. `deriveStatus()` checks it first, falls back to JSONL heuristics.

## Hook Events

All events use Claude Code's `http` hook type, POSTing JSON to `http://localhost:3001/api/hooks/:event`.

| Hook Event | State Change | Replaces |
|---|---|---|
| `UserPromptSubmit` | Clear `isWaitingForPermission` | "last message was user" JSONL check |
| `PreToolUse` | `isToolRunning = true`, set `activeToolName` | 10s timeout for "working" detection |
| `PostToolUse` | `isToolRunning = false`, clear `activeToolName` | 10s timeout for "waiting" detection |
| `PostToolUseFailure` | `isToolRunning = false`, clear `activeToolName` | 10s timeout for "waiting" detection |
| `Stop` | `isToolRunning = false`, clear `activeToolName`, clear `isWaitingForPermission` | end_turn detection from JSONL |
| `SubagentStart` | `hasSubAgent = true` | Agent file scanning + nested heuristics |
| `SubagentStop` | `hasSubAgent = false` | Agent file scanning + nested heuristics |
| `Notification(permission_prompt)` | `isWaitingForPermission = true` | 10s timeout for approval detection |
| `SessionStart` | Reset all state for session | Process liveness check |
| `SessionEnd` | `isEnded = true` | Process liveness check |
| `TaskCreated` | Trigger broadcast | Polling `~/.claude/tasks/` |
| `TaskCompleted` | Trigger broadcast | Polling `~/.claude/tasks/` |

## Hook State Store

New module: `packages/server/src/hook-state.ts`

```ts
interface HookEvent {
  event: string;
  toolName?: string;
  timestamp: number;
}

interface HookSessionState {
  sessionId: string;
  lastEvent: HookEvent;
  isToolRunning: boolean;
  activeToolName?: string;
  hasSubAgent: boolean;
  isWaitingForPermission: boolean;
  isEnded: boolean;
}
```

Keyed by `session_id` from the hook payload. Exports `updateHookState(sessionId, event, payload)` and `getHookState(sessionId)`.

## Status Derivation

`deriveStatus()` in `sessions.ts` gains a `hookState` parameter. When hook state exists:

```
if (!alive)                          → "ended"
if (hookState.isWaitingForPermission) → "waiting"
if (hookState.isToolRunning)          → "working"
if (hookState.hasSubAgent)            → "waiting_on_agent"
if (lastEvent == "UserPromptSubmit")  → "working"
if (lastEvent == "Stop")              → "waiting"
```

When no hook state exists, the entire existing heuristic block runs unchanged. `isSubAgentWaiting()` (the expensive agent file scanner) is skipped when hook state is present.

## HTTP Endpoint

Single route in `app.ts`:

```ts
app.post("/api/hooks/:event", async (c) => {
  const event = c.req.param("event");
  const payload = await c.req.json();
  const sessionId = payload.session_id;
  if (!sessionId) return c.json({ error: "Missing session_id" }, 400);
  updateHookState(sessionId, event, payload);
  scheduleBroadcast();
  return c.json({ ok: true });
});
```

`scheduleBroadcast` is exported from `ws.ts` (currently module-local).

## Setup Skill

A minimal Claude Code plugin at `plugin/` in the herdmode repo.

### Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── setup-herdmode/
        └── SKILL.md
```

### plugin.json

```json
{
  "name": "herdmode",
  "description": "Real-time monitoring for Claude Code sessions"
}
```

### Skill behavior

When invoked as `/setup-herdmode`:

1. Read `~/.claude/settings.json` (create if missing)
2. Check if herdmode hooks already present (look for `localhost:3001/api/hooks` URLs)
3. If not present, merge hooks block into existing `hooks` key preserving user-defined hooks
4. Write back and confirm
5. If already present, offer to remove them (teardown)

The skill does not start the herdmode server.

### Installation

Local development: `claude --plugin-dir /path/to/herdmode/plugin`

### Hooks configuration the skill writes

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/UserPromptSubmit" }]
    }],
    "PreToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/PreToolUse" }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/PostToolUse" }]
    }],
    "PostToolUseFailure": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/PostToolUseFailure" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/Stop" }]
    }],
    "SubagentStart": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/SubagentStart" }]
    }],
    "SubagentStop": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/SubagentStop" }]
    }],
    "Notification": [{
      "matcher": "permission_prompt",
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/Notification" }]
    }],
    "SessionStart": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/SessionStart" }]
    }],
    "SessionEnd": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/SessionEnd" }]
    }],
    "TaskCreated": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/TaskCreated" }]
    }],
    "TaskCompleted": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/TaskCompleted" }]
    }]
  }
}
```

## File Changes

### New files

| File | Purpose |
|---|---|
| `packages/server/src/hook-state.ts` | Hook state store |
| `plugin/.claude-plugin/plugin.json` | Plugin manifest |
| `plugin/skills/setup-herdmode/SKILL.md` | Setup/teardown skill |

### Modified files

| File | Change |
|---|---|
| `packages/server/src/sessions.ts` | `deriveStatus()` gains `hookState` parameter, checks it first. `readAllSessions()` passes hook state and skips `isSubAgentWaiting()` when present. |
| `packages/server/src/app.ts` | Add `POST /api/hooks/:event` route |
| `packages/server/src/ws.ts` | Export `scheduleBroadcast` |

### Untouched

- `packages/server/src/projects.ts` — JSONL parsing stays for fallback + messages/timeline
- `packages/server/src/github.ts` — PR polling is orthogonal
- `packages/server/src/tasks.ts` — Task file reading stays as fallback
- `packages/web/` — No frontend changes; Session type and WebSocket protocol unchanged
