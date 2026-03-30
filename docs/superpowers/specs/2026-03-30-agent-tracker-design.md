# Agent Tracker PWA — Design Spec

## Overview

A locally-run Progressive Web App for monitoring active Claude Code sessions and correlating them with external context (GitHub issues, Linear tickets, Notion/Obsidian notes, Slack threads). The MVP focuses on a live session dashboard with stub UI for integrations.

## Tech Stack

- **Runtime:** Bun
- **Backend:** Hono (TypeScript)
- **Frontend:** React + Vite (TypeScript)
- **Package manager:** Bun workspaces
- **PWA:** Service worker + manifest for local install

## Project Structure

```
agent-tracker/
├── package.json              # Workspace root
├── packages/
│   ├── server/               # Bun + Hono backend
│   │   ├── src/
│   │   │   ├── index.ts      # Server entry, Hono app, WebSocket upgrade
│   │   │   ├── sessions.ts   # Read/watch ~/.claude/sessions/
│   │   │   ├── projects.ts   # Read project/conversation data
│   │   │   ├── tasks.ts      # Read task data per session
│   │   │   └── ws.ts         # WebSocket client tracking + broadcast
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                  # React + Vite frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── SessionList.tsx
│       │   │   ├── SessionCard.tsx
│       │   │   ├── SessionDetail.tsx
│       │   │   └── integrations/
│       │   │       ├── GitHubStub.tsx
│       │   │       ├── LinearStub.tsx
│       │   │       ├── NotionStub.tsx
│       │   │       └── SlackStub.tsx
│       │   ├── hooks/
│       │   │   └── useSessionSocket.ts
│       │   └── types.ts
│       ├── public/
│       │   └── manifest.json
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
```

## Data Sources

All data is read from `~/.claude/` on the local filesystem. No external APIs are called in the MVP.

### Session Files

**Location:** `~/.claude/sessions/{pid}.json`

Each file contains:

```json
{
  "pid": 348032,
  "sessionId": "e3cea617-b877-480d-acde-93eab64510d1",
  "cwd": "/home/krishass/dev/agent-tracker",
  "startedAt": 1774876225392,
  "kind": "interactive",
  "entrypoint": "cli",
  "name": "optional display name"
}
```

### Project Conversations

**Location:** `~/.claude/projects/{encoded-path}/{sessionId}.jsonl`

JSONL files where each line is a message object with `type`, `message`, `timestamp`, `gitBranch`, `slug`, tool calls, and token usage.

### Tasks

**Location:** `~/.claude/tasks/{sessionId}/{taskId}.json`

JSON files with `id`, `subject`, `description`, `status` (pending/in_progress/completed), `blocks`, `blockedBy`.

## Data Model

```typescript
interface Session {
  pid: number
  sessionId: string
  cwd: string
  projectName: string        // basename of cwd
  startedAt: number          // unix ms
  kind: string
  entrypoint: string
  name?: string              // user-set display name
  isAlive: boolean           // verified via process.kill(pid, 0)
  gitBranch?: string         // from latest conversation entry
  tasks: Task[]
  recentMessageCount: number
  tokenUsage?: number        // aggregated from conversation JSONL
}

interface Task {
  id: string
  subject: string
  description: string
  status: "pending" | "in_progress" | "completed"
  blocks: string[]
  blockedBy: string[]
}
```

## API Design

### REST

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all sessions with enriched data |
| GET | `/api/sessions/:id` | Full session detail (tasks, message count, tokens) |

### WebSocket

**Endpoint:** `ws://localhost:3001/ws`

The server watches `~/.claude/sessions/` for file changes using `fs.watch`. On any change, it re-reads all session files, enriches with task/project data, and broadcasts:

```json
{
  "type": "sessions-updated",
  "sessions": [...]
}
```

## Backend Implementation

### Session Reading (`sessions.ts`)

1. Glob `~/.claude/sessions/*.json`, parse each file
2. For each session, check if process is alive: `process.kill(pid, 0)` in a try/catch
3. Derive `projectName` from `path.basename(cwd)`

### Project Enrichment (`projects.ts`)

1. Encode the session's `cwd` to match the directory naming scheme (replace `/` with `-`, strip leading `-`)
2. Find the matching JSONL file by session ID
3. Read the last N lines to extract `gitBranch`, message count, and aggregate token usage

### Task Reading (`tasks.ts`)

1. Glob `~/.claude/tasks/{sessionId}/*.json`
2. Parse and return as `Task[]`

### File Watching (`ws.ts`)

1. Maintain a `Set<ServerWebSocket>` of connected clients
2. Watch `~/.claude/sessions/` with `fs.watch`
3. Debounce changes (200ms), then read all sessions and broadcast

### Server Entry (`index.ts`)

1. Create Hono app with REST routes
2. Handle WebSocket upgrade at `/ws`
3. Start file watcher
4. Serve on port 3001

## Frontend Implementation

### App Shell (`App.tsx`)

- Top bar: "Agent Tracker" title, active session count badge
- Two-column layout: session list (left), detail panel (right)
- Responsive: single column on narrow screens

### Session List (`SessionList.tsx`)

- Receives sessions array from WebSocket hook
- Renders a `SessionCard` for each session
- Sorted by: alive sessions first, then by `startedAt` descending

### Session Card (`SessionCard.tsx`)

- Project name (bold)
- Status badge: green "Active" if `isAlive`, gray "Ended" otherwise
- Relative start time (e.g., "2h ago")
- Git branch tag
- Task progress: "3/5 tasks done" with mini progress bar
- Click to select and show detail

### Session Detail (`SessionDetail.tsx`)

- Full metadata: session ID, PID, full path, entrypoint, kind
- Task list with status icons (pending: circle, in_progress: spinner, completed: check)
- Integration stub sections (collapsible)

### Integration Stubs

Each stub component renders a card with:
- Integration icon/name
- "Not connected" status
- "Connect [Service]" button (disabled, shows tooltip "Coming soon")
- Placeholder for what linked items would look like

### WebSocket Hook (`useSessionSocket.ts`)

```typescript
function useSessionSocket(): {
  sessions: Session[]
  connected: boolean
}
```

- Connects to `ws://localhost:3001/ws`
- Fetches initial state via `GET /api/sessions` on mount
- Updates state on WebSocket messages
- Auto-reconnects on disconnect (1s delay)

### PWA Configuration

**manifest.json:**
- `name`: "Agent Tracker"
- `short_name`: "AgentTracker"
- `display`: "standalone"
- `start_url`: "/"
- `theme_color`: "#1a1a2e"
- `background_color`: "#1a1a2e"

**Service worker:** Vite PWA plugin for precaching the app shell. No offline data caching in MVP — the app needs the local server running.

## Styling

CSS modules or inline styles (no external UI library for the prototype). Dark theme to match terminal aesthetic:
- Background: `#1a1a2e`
- Surface: `#16213e`
- Primary accent: `#0f3460`
- Active indicator: `#4ecca3`
- Text: `#e8e8e8`

## Ports

- Backend API + WebSocket: `3001`
- Vite dev server: `5173` (proxies `/api` and `/ws` to 3001)

## Non-Goals (MVP)

- No authentication (local only)
- No database (reads files directly)
- No actual integration API calls
- No session management (read-only)
- No conversation content display (privacy — only metadata/counts)
