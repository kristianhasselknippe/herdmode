# Opencode Support Design

Add monitoring support for anomalyco/opencode sessions alongside existing Claude Code sessions in herdmode.

## Overview

Opencode sessions appear in the same unified list as Claude Code sessions, with identical status/task/PR/branch features. A provider abstraction layer enables clean separation and future extensibility.

## Architecture: Session Provider Interface

A `SessionProvider` interface that each tool implements:

```typescript
interface SessionProvider {
  name: string;                          // "claude" | "opencode"
  readAllSessions(): Promise<Session[]>;
  watchPaths(): string[];                // paths for fs.watch
  pollInterval?: number;                 // override default 2s if needed
}
```

The `Session` type gains two new fields:
- `provider: "claude" | "opencode"` — identifies the source tool
- `model?: string` — e.g. "gemini-3.1-pro", "claude-sonnet-4"

Existing Claude reading logic moves into a `ClaudeProvider` class. A new `OpencodeProvider` reads from SQLite.

## Opencode Data Source

All data lives in a SQLite database at `~/.local/share/opencode/opencode.db`. Accessed via `bun:sqlite` in read-only WAL mode to avoid interfering with running opencode instances.

### Field Mapping

| Opencode | Herdmode Session field |
|---|---|
| `session.id` | `sessionId` |
| `session.title` | `name` |
| `project.worktree` | `cwd` |
| `project.name` | `projectName` |
| `session.time_created` | `startedAt` |
| Latest `message.data.finish` | Used for status derivation (`"stop"` = end_turn, `"tool-calls"` = tool_use) |
| Latest `part` with `data.type = "tool"` | `lastToolName` for sub-agent detection |
| Latest `message.data.time.completed` | `lastActivityAt` |
| Latest `message.data.modelID` | `model` |
| `todo` table rows | `tasks[]` (`content` -> `subject`, `status` -> `status`) |
| `workspace.branch` | `gitBranch` (fallback: `git rev-parse` in cwd) |

### Status Derivation

Same logic as Claude sessions, adapted for opencode's data:
- **alive check**: Process detection (see below)
- **working**: Last message from user, or recent `tool-calls` finish reason
- **waiting**: Assistant finished with `"stop"`, or >10s gap after `tool-calls`
- **waiting_on_agent**: Like waiting, but last tool part indicates sub-agent
- **idle**: No activity for >60s
- **ended**: No matching opencode process found

## Process Detection (Alive Check)

Opencode has no PID file, so alive status is determined by scanning running processes:

1. On each poll, scan for running opencode processes and resolve their working directories via `/proc/<pid>/cwd`
2. Count how many opencode processes are running per directory
3. For sessions in a given directory, sort by `time_updated` descending
4. Mark the N most recently updated sessions as alive (where N = number of running opencode processes in that directory)
5. Remaining sessions in that directory are marked ended
6. Cache the process list for the duration of a single poll cycle

### Edge Cases
- **No opencode installed**: `OpencodeProvider` checks for DB existence on startup, returns empty array if not found
- **Opencode process exits between polls**: Next poll marks it ended (2s max delay)
- **PID-to-session mismatch in same dir**: Recency heuristic is imperfect but acceptable — exact mapping would require opencode to expose session-to-PID binding

## Server Orchestration

### Provider Registration (ws.ts)

```typescript
const providers: SessionProvider[] = [new ClaudeProvider(), new OpencodeProvider()];

async function getAllSessions(): Promise<Session[]> {
  const results = await Promise.all(providers.map(p => p.readAllSessions()));
  return results.flat().sort(/* alive first, then by startedAt desc */);
}
```

### File Watching

Each provider declares `watchPaths()`:
- **Claude**: `~/.claude/sessions/`, `~/.claude/projects/*/`, `~/.claude/tasks/*/`
- **Opencode**: `~/.local/share/opencode/` (SQLite WAL file changes trigger fs events)

### Polling

Existing 2s fallback poll calls `getAllSessions()` covering both providers. SQLite reads add negligible overhead.

### GitHub Integration

No changes needed. `github.ts` works by `cwd + branch` — opencode sessions provide both, so PR polling picks them up automatically.

## Frontend Changes

### Session Type (both types.ts files)

Add to `Session`:
- `provider: "claude" | "opencode"`
- `model?: string`

### SessionCard.tsx
- Small provider badge: "CC" for Claude, "OC" for opencode
- Model label below the status badge (shown for all sessions)

### SessionDetail.tsx
- Provider and model shown in metadata section
- Everything else (tasks, PR, branch) renders identically

### Focus Button
- Only shown for Claude sessions initially
- Opencode focus support deferred to future work

### Notifications
- Work identically — status transitions trigger same 5s debounced notifications regardless of provider

### Styling
- One new provider badge CSS class, no other additions needed

## Files to Create/Modify

### New Files
- `packages/server/src/providers/types.ts` — `SessionProvider` interface
- `packages/server/src/providers/claude.ts` — `ClaudeProvider` (refactored from existing code)
- `packages/server/src/providers/opencode.ts` — `OpencodeProvider` (new)
- `packages/server/src/providers/index.ts` — provider registry

### Modified Files
- `packages/server/src/types.ts` — add `provider` and `model` to `Session`
- `packages/web/src/types.ts` — same additions
- `packages/server/src/ws.ts` — use provider registry instead of direct `readAllSessions()`
- `packages/server/src/sessions.ts` — refactor into `ClaudeProvider` (may keep as helper)
- `packages/server/src/projects.ts` — becomes internal to `ClaudeProvider`
- `packages/web/src/components/SessionCard.tsx` — provider badge + model label
- `packages/web/src/components/SessionDetail.tsx` — provider/model in metadata

## Non-Goals
- Opencode terminal focus (deferred)
- Opencode SSE connection for real-time status (process detection is sufficient)
- Shared type package between server and web (maintain existing manual sync convention)
