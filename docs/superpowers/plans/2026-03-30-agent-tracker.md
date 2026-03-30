# Agent Tracker PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local PWA that displays live Claude Code session status with integration stub UI.

**Architecture:** Bun monorepo with a Hono backend that reads `~/.claude/` session files and serves a REST API + WebSocket, and a React + Vite frontend that renders a live session dashboard. The backend watches session files for changes and pushes updates to connected clients.

**Tech Stack:** Bun 1.3.6, Hono, React 19, Vite, TypeScript

---

## File Map

### Workspace Root
- `package.json` — Bun workspace config, root scripts (`dev`, `build`)
- `tsconfig.base.json` — Shared TS config (strict, ESNext)

### `packages/server/`
- `package.json` — Server deps (hono)
- `tsconfig.json` — Extends base, node types
- `src/types.ts` — Shared `Session` and `Task` interfaces
- `src/sessions.ts` — Read session JSON files, check process liveness
- `src/tasks.ts` — Read task JSON files for a session
- `src/projects.ts` — Read JSONL conversation data for enrichment
- `src/ws.ts` — WebSocket client set + broadcast + file watcher
- `src/index.ts` — Hono app, REST routes, WebSocket upgrade, server start

### `packages/web/`
- `package.json` — Frontend deps (react, react-dom, vite)
- `tsconfig.json` — Extends base, DOM types, React JSX
- `vite.config.ts` — Dev server proxy to :3001, PWA plugin
- `index.html` — App entry HTML
- `public/manifest.json` — PWA manifest
- `src/types.ts` — Frontend copy of Session/Task types
- `src/main.tsx` — React root mount
- `src/App.tsx` — Layout shell, state management, selected session
- `src/App.css` — Global styles, dark theme, layout
- `src/components/SessionList.tsx` — Sorted session card list
- `src/components/SessionCard.tsx` — Individual session summary card
- `src/components/SessionDetail.tsx` — Expanded session view with tasks
- `src/components/integrations/GitHubStub.tsx` — GitHub placeholder
- `src/components/integrations/LinearStub.tsx` — Linear placeholder
- `src/components/integrations/NotionStub.tsx` — Notion placeholder
- `src/components/integrations/SlackStub.tsx` — Slack placeholder
- `src/hooks/useSessionSocket.ts` — WebSocket + REST data hook

---

### Task 1: Workspace and Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`

- [ ] **Step 1: Create root `package.json` with Bun workspaces**

```json
{
  "name": "agent-tracker",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:server": "bun run --filter server dev",
    "dev:web": "bun run --filter web dev"
  }
}
```

- [ ] **Step 2: Create shared TypeScript base config**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create server package**

```json
// packages/server/package.json
{
  "name": "server",
  "private": true,
  "scripts": {
    "dev": "bun --watch src/index.ts"
  },
  "dependencies": {
    "hono": "^4"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

```json
// packages/server/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun-types"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create web package**

```json
// packages/web/package.json
{
  "name": "web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4",
    "typescript": "^5",
    "vite": "^6"
  }
}
```

```json
// packages/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create Vite config with proxy**

```typescript
// packages/web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 6: Create index.html**

```html
<!-- packages/web/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#1a1a2e" />
    <link rel="manifest" href="/manifest.json" />
    <title>Agent Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Install dependencies**

```bash
cd /home/krishass/dev/agent-tracker && bun install
```

- [ ] **Step 8: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold bun monorepo with server and web packages"
```

---

### Task 2: Shared Types and Server Data Layer

**Files:**
- Create: `packages/server/src/types.ts`
- Create: `packages/server/src/sessions.ts`
- Create: `packages/server/src/tasks.ts`
- Create: `packages/server/src/projects.ts`

- [ ] **Step 1: Create shared types**

```typescript
// packages/server/src/types.ts
export interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

export interface Session {
  pid: number;
  sessionId: string;
  cwd: string;
  projectName: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
  isAlive: boolean;
  gitBranch?: string;
  tasks: Task[];
  recentMessageCount: number;
  tokenUsage: number;
}

export interface RawSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
}
```

- [ ] **Step 2: Implement session reading**

```typescript
// packages/server/src/sessions.ts
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { RawSessionFile, Session } from "./types";
import { getTasksForSession } from "./tasks";
import { getProjectData } from "./projects";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readAllSessions(): Promise<Session[]> {
  let files: string[];
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const sessions: Session[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = await readFile(join(SESSIONS_DIR, file), "utf-8");
      const raw: RawSessionFile = JSON.parse(content);
      const tasks = await getTasksForSession(raw.sessionId);
      const projectData = await getProjectData(raw.cwd, raw.sessionId);

      sessions.push({
        pid: raw.pid,
        sessionId: raw.sessionId,
        cwd: raw.cwd,
        projectName: raw.name || basename(raw.cwd),
        startedAt: raw.startedAt,
        kind: raw.kind,
        entrypoint: raw.entrypoint,
        name: raw.name,
        isAlive: isProcessAlive(raw.pid),
        gitBranch: projectData.gitBranch,
        tasks,
        recentMessageCount: projectData.messageCount,
        tokenUsage: projectData.tokenUsage,
      });
    } catch {
      // skip malformed files
    }
  }

  return sessions.sort((a, b) => {
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return b.startedAt - a.startedAt;
  });
}
```

- [ ] **Step 3: Implement task reading**

```typescript
// packages/server/src/tasks.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Task } from "./types";

const TASKS_DIR = join(homedir(), ".claude", "tasks");

export async function getTasksForSession(sessionId: string): Promise<Task[]> {
  const dir = join(TASKS_DIR, sessionId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const tasks: Task[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = await readFile(join(dir, file), "utf-8");
      const task: Task = JSON.parse(content);
      tasks.push(task);
    } catch {
      // skip malformed
    }
  }

  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}
```

- [ ] **Step 4: Implement project data enrichment**

The JSONL files have lines with `type`, `message` (with `usage`), `gitBranch`, and `timestamp` fields. We read the last 50 lines to get recent data without loading entire conversation histories.

```typescript
// packages/server/src/projects.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

interface ProjectData {
  gitBranch?: string;
  messageCount: number;
  tokenUsage: number;
}

function encodePath(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export async function getProjectData(
  cwd: string,
  sessionId: string
): Promise<ProjectData> {
  const projectDir = join(PROJECTS_DIR, encodePath(cwd));
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

  let content: string;
  try {
    content = await readFile(jsonlPath, "utf-8");
  } catch {
    return { messageCount: 0, tokenUsage: 0 };
  }

  const lines = content.trim().split("\n");
  let gitBranch: string | undefined;
  let messageCount = 0;
  let tokenUsage = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "user" || entry.type === "assistant") {
        messageCount++;
      }
      if (entry.gitBranch && entry.gitBranch !== "HEAD") {
        gitBranch = entry.gitBranch;
      }
      if (entry.message?.usage) {
        const u = entry.message.usage;
        tokenUsage +=
          (u.input_tokens || 0) + (u.output_tokens || 0);
      }
    } catch {
      // skip malformed lines
    }
  }

  return { gitBranch, messageCount, tokenUsage };
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/
git commit -m "feat(server): add session, task, and project data readers"
```

---

### Task 3: WebSocket Watcher and Hono Server

**Files:**
- Create: `packages/server/src/ws.ts`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Implement WebSocket manager with file watching**

```typescript
// packages/server/src/ws.ts
import { watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ServerWebSocket } from "bun";
import { readAllSessions } from "./sessions";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>) {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>) {
  clients.delete(ws);
}

async function broadcast() {
  const sessions = await readAllSessions();
  const message = JSON.stringify({ type: "sessions-updated", sessions });
  for (const ws of clients) {
    ws.send(message);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startWatcher() {
  try {
    watch(SESSIONS_DIR, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(broadcast, 200);
    });
    console.log(`Watching ${SESSIONS_DIR} for changes`);
  } catch (err) {
    console.error("Failed to watch sessions directory:", err);
  }
}
```

- [ ] **Step 2: Implement Hono server with REST + WebSocket**

```typescript
// packages/server/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readAllSessions } from "./sessions";
import { addClient, removeClient, startWatcher } from "./ws";

const app = new Hono();

app.use("/api/*", cors());

app.get("/api/sessions", async (c) => {
  const sessions = await readAllSessions();
  return c.json(sessions);
});

app.get("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const sessions = await readAllSessions();
  const session = sessions.find((s) => s.sessionId === id);
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

startWatcher();

const server = Bun.serve({
  port: 3001,
  fetch: app.fetch,
  websocket: {
    open(ws) {
      addClient(ws);
    },
    close(ws) {
      removeClient(ws);
    },
    message() {},
  },
});

// Upgrade WebSocket requests
const originalFetch = app.fetch;
app.fetch = async (request, ...args) => {
  const url = new URL(request.url);
  if (url.pathname === "/ws") {
    const upgraded = server.upgrade(request);
    if (upgraded) return undefined as unknown as Response;
    return new Response("WebSocket upgrade failed", { status: 400 });
  }
  return originalFetch.call(app, request, ...args);
};

console.log("Agent Tracker server running on http://localhost:3001");
```

Note: Bun's `Bun.serve` handles WebSocket upgrades separately from Hono's fetch. We override fetch to intercept `/ws` before Hono routes.

Actually, Hono + Bun.serve WebSocket integration requires a different pattern. Let me correct this:

```typescript
// packages/server/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readAllSessions } from "./sessions";
import { addClient, removeClient, startWatcher } from "./ws";

const app = new Hono();

app.use("/api/*", cors());

app.get("/api/sessions", async (c) => {
  const sessions = await readAllSessions();
  return c.json(sessions);
});

app.get("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const sessions = await readAllSessions();
  const session = sessions.find((s) => s.sessionId === id);
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

startWatcher();

Bun.serve({
  port: 3001,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      addClient(ws);
    },
    close(ws) {
      removeClient(ws);
    },
    message() {},
  },
});

console.log("Agent Tracker server running on http://localhost:3001");
```

- [ ] **Step 3: Test the server manually**

```bash
cd /home/krishass/dev/agent-tracker && bun run dev:server
```

In another terminal:
```bash
curl http://localhost:3001/api/sessions | jq '.[0] | {projectName, isAlive, sessionId}'
```

Expected: JSON array of sessions with enriched data, `isAlive` correctly reflecting running processes.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/
git commit -m "feat(server): add Hono REST API and WebSocket with file watcher"
```

---

### Task 4: Frontend Types, Hook, and App Shell

**Files:**
- Create: `packages/web/src/types.ts`
- Create: `packages/web/src/hooks/useSessionSocket.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/App.css`

- [ ] **Step 1: Create frontend types**

```typescript
// packages/web/src/types.ts
export interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

export interface Session {
  pid: number;
  sessionId: string;
  cwd: string;
  projectName: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
  isAlive: boolean;
  gitBranch?: string;
  tasks: Task[];
  recentMessageCount: number;
  tokenUsage: number;
}
```

- [ ] **Step 2: Create WebSocket + REST hook**

```typescript
// packages/web/src/hooks/useSessionSocket.ts
import { useState, useEffect, useRef, useCallback } from "react";
import type { Session } from "../types";

export function useSessionSocket() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "sessions-updated") {
        setSessions(data.sessions);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 1000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    // Fetch initial state
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {});

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return { sessions, connected };
}
```

- [ ] **Step 3: Create main entry and App shell**

```tsx
// packages/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

```tsx
// packages/web/src/App.tsx
import { useState } from "react";
import { useSessionSocket } from "./hooks/useSessionSocket";
import { SessionList } from "./components/SessionList";
import { SessionDetail } from "./components/SessionDetail";
import type { Session } from "./types";

export default function App() {
  const { sessions, connected } = useSessionSocket();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null;
  const activeCount = sessions.filter((s) => s.isAlive).length;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Agent Tracker</h1>
        <div className="topbar-right">
          <span className="badge">{activeCount} active</span>
          <span className={`connection-dot ${connected ? "connected" : ""}`} />
        </div>
      </header>
      <main className="layout">
        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {selectedSession ? (
          <SessionDetail session={selectedSession} />
        ) : (
          <div className="detail-placeholder">
            Select a session to view details
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create global styles**

```css
/* packages/web/src/App.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #1a1a2e;
  --surface: #16213e;
  --accent: #0f3460;
  --active: #4ecca3;
  --text: #e8e8e8;
  --text-dim: #8892a4;
  --danger: #e74c3c;
  --border: #2a2a4a;
}

body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.topbar h1 {
  font-size: 18px;
  font-weight: 600;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  background: var(--accent);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}

.connection-dot.connected {
  background: var(--active);
}

.layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.session-list {
  width: 380px;
  min-width: 380px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.session-card:hover,
.session-card.selected {
  border-color: var(--active);
}

.session-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.session-card-header h3 {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.status-badge.alive {
  background: rgba(78, 204, 163, 0.15);
  color: var(--active);
}

.status-badge.ended {
  background: rgba(136, 146, 164, 0.15);
  color: var(--text-dim);
}

.session-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.tag {
  background: var(--accent);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.progress-bar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  margin-top: 10px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--active);
  border-radius: 2px;
  transition: width 0.3s;
}

.detail-panel {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.detail-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 14px;
}

.detail-header {
  margin-bottom: 24px;
}

.detail-header h2 {
  font-size: 20px;
  margin-bottom: 8px;
}

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--text-dim);
}

.detail-meta code {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  background: var(--accent);
  padding: 1px 4px;
  border-radius: 3px;
}

.section {
  margin-top: 24px;
}

.section h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border-radius: 6px;
  font-size: 13px;
}

.task-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}

.integration-stub {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 8px;
}

.integration-stub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.integration-stub-header h4 {
  font-size: 14px;
}

.integration-stub button {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: not-allowed;
}

.integration-stub .placeholder {
  margin-top: 12px;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-dim);
  text-align: center;
}

@media (max-width: 768px) {
  .layout {
    flex-direction: column;
  }
  .session-list {
    width: 100%;
    min-width: 100%;
    max-height: 40vh;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/hooks/ packages/web/src/main.tsx packages/web/src/App.tsx packages/web/src/App.css
git commit -m "feat(web): add types, WebSocket hook, and App shell with styles"
```

---

### Task 5: Session List and Session Card Components

**Files:**
- Create: `packages/web/src/components/SessionList.tsx`
- Create: `packages/web/src/components/SessionCard.tsx`

- [ ] **Step 1: Create SessionCard component**

```tsx
// packages/web/src/components/SessionCard.tsx
import type { Session } from "../types";

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  session: Session;
  selected: boolean;
  onSelect: () => void;
}

export function SessionCard({ session, selected, onSelect }: Props) {
  const completedTasks = session.tasks.filter(
    (t) => t.status === "completed"
  ).length;
  const totalTasks = session.tasks.length;
  const progress = totalTasks > 0 ? completedTasks / totalTasks : 0;

  return (
    <div
      className={`session-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="session-card-header">
        <h3>{session.projectName}</h3>
        <span className={`status-badge ${session.isAlive ? "alive" : "ended"}`}>
          {session.isAlive ? "Active" : "Ended"}
        </span>
      </div>
      <div className="session-card-meta">
        <span>{timeAgo(session.startedAt)}</span>
        {session.gitBranch && (
          <span className="tag">{session.gitBranch}</span>
        )}
        <span>{session.recentMessageCount} messages</span>
        {totalTasks > 0 && (
          <span>
            {completedTasks}/{totalTasks} tasks
          </span>
        )}
      </div>
      {totalTasks > 0 && (
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create SessionList component**

```tsx
// packages/web/src/components/SessionList.tsx
import type { Session } from "../types";
import { SessionCard } from "./SessionCard";

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SessionList({ sessions, selectedId, onSelect }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="session-list">
        <div className="detail-placeholder">No sessions found</div>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          selected={session.sessionId === selectedId}
          onSelect={() => onSelect(session.sessionId)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/SessionList.tsx packages/web/src/components/SessionCard.tsx
git commit -m "feat(web): add SessionList and SessionCard components"
```

---

### Task 6: Session Detail Component

**Files:**
- Create: `packages/web/src/components/SessionDetail.tsx`

- [ ] **Step 1: Create SessionDetail component**

```tsx
// packages/web/src/components/SessionDetail.tsx
import type { Session, Task } from "../types";
import { GitHubStub } from "./integrations/GitHubStub";
import { LinearStub } from "./integrations/LinearStub";
import { NotionStub } from "./integrations/NotionStub";
import { SlackStub } from "./integrations/SlackStub";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function taskIcon(status: Task["status"]): string {
  switch (status) {
    case "completed":
      return "\u2713";
    case "in_progress":
      return "\u25CB";
    case "pending":
      return "\u2022";
  }
}

interface Props {
  session: Session;
}

export function SessionDetail({ session }: Props) {
  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h2>{session.projectName}</h2>
        <div className="detail-meta">
          <span>
            Path: <code>{session.cwd}</code>
          </span>
          <span>
            Session: <code>{session.sessionId.slice(0, 8)}</code> &middot; PID:{" "}
            <code>{session.pid}</code>
          </span>
          <span>
            {session.entrypoint} &middot; {session.kind}
            {session.gitBranch && <> &middot; {session.gitBranch}</>}
          </span>
          <span>
            {session.recentMessageCount} messages &middot;{" "}
            {formatTokens(session.tokenUsage)} tokens
          </span>
        </div>
      </div>

      {session.tasks.length > 0 && (
        <div className="section">
          <h3>Tasks</h3>
          <div className="task-list">
            {session.tasks.map((task) => (
              <div key={task.id} className="task-item">
                <span className="task-icon">{taskIcon(task.status)}</span>
                <span>{task.subject}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h3>Integrations</h3>
        <GitHubStub />
        <LinearStub />
        <NotionStub />
        <SlackStub />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/SessionDetail.tsx
git commit -m "feat(web): add SessionDetail component with task list"
```

---

### Task 7: Integration Stub Components

**Files:**
- Create: `packages/web/src/components/integrations/GitHubStub.tsx`
- Create: `packages/web/src/components/integrations/LinearStub.tsx`
- Create: `packages/web/src/components/integrations/NotionStub.tsx`
- Create: `packages/web/src/components/integrations/SlackStub.tsx`

- [ ] **Step 1: Create all four integration stubs**

```tsx
// packages/web/src/components/integrations/GitHubStub.tsx
export function GitHubStub() {
  return (
    <div className="integration-stub">
      <div className="integration-stub-header">
        <h4>GitHub</h4>
        <button title="Coming soon">Connect GitHub</button>
      </div>
      <div className="placeholder">
        Link pull requests, issues, and code reviews to this session
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/components/integrations/LinearStub.tsx
export function LinearStub() {
  return (
    <div className="integration-stub">
      <div className="integration-stub-header">
        <h4>Linear</h4>
        <button title="Coming soon">Connect Linear</button>
      </div>
      <div className="placeholder">
        Track related Linear issues and project progress
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/components/integrations/NotionStub.tsx
export function NotionStub() {
  return (
    <div className="integration-stub">
      <div className="integration-stub-header">
        <h4>Notion / Obsidian</h4>
        <button title="Coming soon">Connect Notes</button>
      </div>
      <div className="placeholder">
        Attach design docs, meeting notes, and reference material
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/components/integrations/SlackStub.tsx
export function SlackStub() {
  return (
    <div className="integration-stub">
      <div className="integration-stub-header">
        <h4>Slack</h4>
        <button title="Coming soon">Connect Slack</button>
      </div>
      <div className="placeholder">
        Link relevant Slack threads and discussions
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/integrations/
git commit -m "feat(web): add integration stub components for GitHub, Linear, Notion, Slack"
```

---

### Task 8: PWA Manifest and Final Wiring

**Files:**
- Create: `packages/web/public/manifest.json`

- [ ] **Step 1: Create PWA manifest**

```json
// packages/web/public/manifest.json
{
  "name": "Agent Tracker",
  "short_name": "AgentTracker",
  "description": "Monitor active Claude Code sessions",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#1a1a2e",
  "background_color": "#1a1a2e",
  "icons": [
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>",
      "sizes": "any",
      "type": "image/svg+xml"
    }
  ]
}
```

- [ ] **Step 2: Verify full app runs end to end**

Start both server and frontend:

```bash
cd /home/krishass/dev/agent-tracker && bun run dev
```

Open `http://localhost:5173` in a browser. Verify:
- Session list loads with current sessions
- Active sessions show green badge, ended show gray
- Clicking a session shows detail panel with tasks
- Integration stubs appear in detail panel
- WebSocket connection dot is green

- [ ] **Step 3: Commit**

```bash
git add packages/web/public/manifest.json
git commit -m "feat(web): add PWA manifest"
```

- [ ] **Step 4: Create .gitignore and final commit**

```
# .gitignore
node_modules/
dist/
.vite/
bun.lock
```

```bash
git add .gitignore
git commit -m "chore: add gitignore"
```
