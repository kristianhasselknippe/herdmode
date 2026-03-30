# Opencode Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor anomalyco/opencode sessions alongside Claude Code sessions in a unified list via a provider abstraction layer.

**Architecture:** A `SessionProvider` interface abstracts session reading. `ClaudeProvider` wraps existing logic. `OpencodeProvider` reads from SQLite at `~/.local/share/opencode/opencode.db`. Providers are registered in `ws.ts` and their results merged before broadcast. The `Session` type gains `provider` and `model` fields.

**Tech Stack:** Bun, `bun:sqlite` (built-in), Hono, React 19, WebSocket

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `packages/server/src/providers/types.ts` | `SessionProvider` interface definition |
| `packages/server/src/providers/claude.ts` | `ClaudeProvider` — wraps existing `sessions.ts`/`projects.ts`/`tasks.ts` |
| `packages/server/src/providers/opencode.ts` | `OpencodeProvider` — reads SQLite DB, derives status, detects processes |
| `packages/server/src/providers/index.ts` | Registry: creates provider instances, exports `getAllSessions()` |

### Modified Files
| File | Change |
|---|---|
| `packages/server/src/types.ts` | Add `provider` and `model` to `Session`; make `pid` optional |
| `packages/web/src/types.ts` | Mirror same changes |
| `packages/server/src/ws.ts` | Use `getAllSessions()` from providers instead of direct `readAllSessions()` |
| `packages/server/src/app.ts` | Use `getAllSessions()` from providers |
| `packages/server/src/sessions.ts` | Export `deriveStatus` and `isProcessAlive` for reuse by `ClaudeProvider` |
| `packages/web/src/components/SessionCard.tsx` | Add provider badge and model label |
| `packages/web/src/components/SessionDetail.tsx` | Show provider, model in metadata; conditionally show focus button |
| `packages/web/src/App.css` | Add `.provider-badge` styles |

---

### Task 1: Add `provider` and `model` fields to Session type

**Files:**
- Modify: `packages/server/src/types.ts:30-47`
- Modify: `packages/web/src/types.ts:30-47`

- [ ] **Step 1: Update server types**

In `packages/server/src/types.ts`, add `provider` and `model` to `Session`, and make `pid` optional (opencode sessions don't have PIDs):

```typescript
export type SessionProvider = "claude" | "opencode";

export interface Session {
  pid?: number;
  sessionId: string;
  cwd: string;
  projectName: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
  isAlive: boolean;
  status: SessionStatus;
  gitBranch?: string;
  tasks: Task[];
  recentMessageCount: number;
  tokenUsage: number;
  lastActivityAt?: number;
  pullRequest?: PullRequestData;
  provider: SessionProvider;
  model?: string;
}
```

- [ ] **Step 2: Update web types**

In `packages/web/src/types.ts`, make the exact same changes — add `SessionProvider` type alias, add `provider` and `model` to `Session`, make `pid` optional.

- [ ] **Step 3: Update `sessions.ts` to populate new fields**

In `packages/server/src/sessions.ts`, inside `readAllSessions()` where the session object is constructed (line 86-105), add:

```typescript
provider: "claude" as const,
model: projectData.model,
```

- [ ] **Step 4: Extract `model` from Claude JSONL**

In `packages/server/src/projects.ts`, add `model?: string` to the `ProjectData` interface. In the JSONL parsing loop, after the existing `lastStopReason` extraction (line 73), add:

```typescript
if (entry.message?.model) {
  model = entry.message.model;
}
```

Return `model` in the result object.

- [ ] **Step 5: Fix focus endpoint for optional PID**

In `packages/server/src/app.ts`, the focus endpoint at line 26-32 uses `pid` from the URL param — no change needed since it's already parsed from the URL, not from the session object. But update the session detail display to conditionally show PID (handled in Task 7).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/types.ts packages/web/src/types.ts packages/server/src/sessions.ts packages/server/src/projects.ts
git commit -m "feat: add provider and model fields to Session type"
```

---

### Task 2: Create SessionProvider interface and provider registry

**Files:**
- Create: `packages/server/src/providers/types.ts`
- Create: `packages/server/src/providers/index.ts`

- [ ] **Step 1: Create the provider interface**

Create `packages/server/src/providers/types.ts`:

```typescript
import type { Session } from "../types";

export interface SessionProvider {
  name: string;
  readAllSessions(): Promise<Session[]>;
  watchPaths(): string[];
}
```

- [ ] **Step 2: Create the provider registry**

Create `packages/server/src/providers/index.ts`:

```typescript
import type { SessionProvider } from "./types";

const providers: SessionProvider[] = [];

export function registerProvider(provider: SessionProvider) {
  providers.push(provider);
  console.log(`Registered session provider: ${provider.name}`);
}

export async function getAllSessions() {
  const results = await Promise.all(
    providers.map((p) => p.readAllSessions())
  );
  const sessions = results.flat();
  return sessions.sort((a, b) => {
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return b.startedAt - a.startedAt;
  });
}

export function getAllWatchPaths(): string[] {
  return providers.flatMap((p) => p.watchPaths());
}

export type { SessionProvider } from "./types";
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/
git commit -m "feat: add SessionProvider interface and registry"
```

---

### Task 3: Create ClaudeProvider

**Files:**
- Create: `packages/server/src/providers/claude.ts`
- Modify: `packages/server/src/sessions.ts` (export helpers)

- [ ] **Step 1: Export helpers from sessions.ts**

In `packages/server/src/sessions.ts`, add `export` to `isProcessAlive` (line 11) and `deriveStatus` (line 23). Also export the `SESSIONS_DIR` constant (line 9):

```typescript
export const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

export function isProcessAlive(pid: number): boolean {
```

```typescript
export function deriveStatus(alive: boolean, projectData: ProjectData): SessionStatus {
```

- [ ] **Step 2: Create ClaudeProvider**

Create `packages/server/src/providers/claude.ts`:

```typescript
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionProvider } from "./types";
import { readAllSessions } from "../sessions";

const CLAUDE_DIR = join(homedir(), ".claude");
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

export class ClaudeProvider implements SessionProvider {
  name = "claude";

  async readAllSessions() {
    return readAllSessions();
  }

  watchPaths(): string[] {
    const paths = [SESSIONS_DIR];
    return paths;
  }
}

// Returns additional paths that need watching (subdirectories of projects/ and tasks/)
// Called after initial setup to discover subdirectories
export async function getClaudeExtraWatchPaths(): Promise<string[]> {
  const paths: string[] = [];
  try {
    const projectDirs = await readdir(PROJECTS_DIR);
    for (const dir of projectDirs) {
      paths.push(join(PROJECTS_DIR, dir));
    }
  } catch {
    // projects dir may not exist
  }
  try {
    const taskDirs = await readdir(TASKS_DIR);
    for (const dir of taskDirs) {
      paths.push(join(TASKS_DIR, dir));
    }
  } catch {
    // tasks dir may not exist
  }
  return paths;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/claude.ts packages/server/src/sessions.ts
git commit -m "feat: create ClaudeProvider wrapping existing session reading"
```

---

### Task 4: Create OpencodeProvider

**Files:**
- Create: `packages/server/src/providers/opencode.ts`

- [ ] **Step 1: Create the opencode provider**

Create `packages/server/src/providers/opencode.ts`:

```typescript
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Session, Task, SessionStatus } from "../types";
import type { SessionProvider } from "./types";
import { getCachedPR } from "../github";

const OPENCODE_DIR = join(homedir(), ".local", "share", "opencode");
const DB_PATH = join(OPENCODE_DIR, "opencode.db");

const IDLE_THRESHOLD_MS = 60_000;
const TOOL_APPROVAL_THRESHOLD_MS = 10_000;

interface OpencodeProcess {
  pid: number;
  cwd: string;
}

function getRunningOpencodeProcesses(): OpencodeProcess[] {
  const processes: OpencodeProcess[] = [];
  try {
    const procDirs = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of procDirs) {
      try {
        const exe = readlinkSync(`/proc/${pid}/exe`);
        if (!exe.includes("opencode")) continue;
        const cwd = readlinkSync(`/proc/${pid}/cwd`);
        processes.push({ pid: Number(pid), cwd });
      } catch {
        // Process may have exited or we lack permission
      }
    }
  } catch {
    // /proc not available
  }
  return processes;
}

function deriveOpencodeStatus(
  alive: boolean,
  lastRole: string | undefined,
  lastFinish: string | undefined,
  lastToolName: string | undefined,
  lastActivityAt: number | undefined
): SessionStatus {
  if (!alive) return "ended";
  if (!lastRole) return "waiting";

  const timeSinceActivity = lastActivityAt
    ? Date.now() - lastActivityAt
    : Infinity;

  if (lastRole === "user") return "working";

  if (lastRole === "assistant" && lastFinish === "tool-calls") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) {
      return lastToolName === "subagent" ? "waiting_on_agent" : "idle";
    }
    if (timeSinceActivity > TOOL_APPROVAL_THRESHOLD_MS) {
      return lastToolName === "subagent" ? "waiting_on_agent" : "waiting";
    }
    return "working";
  }

  if (lastRole === "assistant" && lastFinish === "stop") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) return "idle";
    return "waiting";
  }

  if (timeSinceActivity < IDLE_THRESHOLD_MS) return "waiting";
  return "idle";
}

export class OpencodeProvider implements SessionProvider {
  name = "opencode";
  private db: Database | null = null;

  private getDb(): Database | null {
    if (this.db) return this.db;
    if (!existsSync(DB_PATH)) return null;
    try {
      this.db = new Database(DB_PATH, { readonly: true });
      this.db.exec("PRAGMA journal_mode=WAL");
      return this.db;
    } catch {
      return null;
    }
  }

  async readAllSessions(): Promise<Session[]> {
    const db = this.getDb();
    if (!db) return [];

    const runningProcesses = getRunningOpencodeProcesses();

    // Count processes per cwd for alive detection
    const processesByCwd = new Map<string, number>();
    for (const proc of runningProcesses) {
      processesByCwd.set(proc.cwd, (processesByCwd.get(proc.cwd) || 0) + 1);
    }

    const rows = db
      .query(
        `SELECT
          s.id, s.title, s.slug, s.directory, s.time_created, s.time_updated,
          s.workspace_id, s.parent_id,
          p.name as project_name, p.worktree,
          w.branch as workspace_branch
        FROM session s
        JOIN project p ON s.project_id = p.id
        LEFT JOIN workspace w ON s.workspace_id = w.id
        WHERE s.time_archived IS NULL
        ORDER BY s.time_updated DESC`
      )
      .all() as Array<{
      id: string;
      title: string;
      slug: string;
      directory: string;
      time_created: number;
      time_updated: number;
      workspace_id: string | null;
      parent_id: string | null;
      project_name: string | null;
      worktree: string;
      workspace_branch: string | null;
    }>;

    // For alive detection: group sessions by cwd, mark top N as alive
    const sessionsByCwd = new Map<string, typeof rows>();
    for (const row of rows) {
      const cwd = row.directory || row.worktree;
      if (!sessionsByCwd.has(cwd)) sessionsByCwd.set(cwd, []);
      sessionsByCwd.get(cwd)!.push(row);
    }

    const aliveSessionIds = new Set<string>();
    for (const [cwd, cwdSessions] of sessionsByCwd) {
      const count = processesByCwd.get(cwd) || 0;
      // Sessions already sorted by time_updated DESC from query
      for (let i = 0; i < count && i < cwdSessions.length; i++) {
        aliveSessionIds.add(cwdSessions[i].id);
      }
    }

    const sessions: Session[] = [];

    for (const row of rows) {
      // Skip sub-agent sessions (they have a parent_id)
      if (row.parent_id) continue;

      const sessionId = row.id;
      const cwd = row.directory || row.worktree;
      const alive = aliveSessionIds.has(sessionId);

      // Get last message data for status derivation
      const lastMsg = db
        .query(
          `SELECT data FROM message
           WHERE session_id = ?
           ORDER BY time_created DESC LIMIT 1`
        )
        .get(sessionId) as { data: string } | null;

      let lastRole: string | undefined;
      let lastFinish: string | undefined;
      let lastActivityAt: number | undefined;
      let model: string | undefined;
      let lastToolName: string | undefined;

      if (lastMsg) {
        try {
          const data = JSON.parse(lastMsg.data);
          lastRole = data.role;
          lastFinish = data.finish;
          lastActivityAt = data.time?.completed || data.time?.created;
          if (data.role === "assistant") {
            model = data.modelID;
          }
        } catch {
          // malformed JSON
        }
      }

      // If last message was user, get the most recent assistant message for model info
      if (lastRole === "user") {
        const lastAssistant = db
          .query(
            `SELECT data FROM message
             WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
             ORDER BY time_created DESC LIMIT 1`
          )
          .get(sessionId) as { data: string } | null;
        if (lastAssistant) {
          try {
            const data = JSON.parse(lastAssistant.data);
            model = data.modelID;
          } catch {}
        }
      }

      // Get last tool name from parts
      if (lastRole === "assistant" && lastFinish === "tool-calls") {
        const lastToolPart = db
          .query(
            `SELECT data FROM part
             WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'
             ORDER BY time_created DESC LIMIT 1`
          )
          .get(sessionId) as { data: string } | null;
        if (lastToolPart) {
          try {
            const data = JSON.parse(lastToolPart.data);
            lastToolName = data.tool;
          } catch {}
        }
      }

      // Get message count and token usage
      const stats = db
        .query(
          `SELECT
            COUNT(*) as msg_count,
            COALESCE(SUM(
              COALESCE(json_extract(data, '$.tokens.input'), 0) +
              COALESCE(json_extract(data, '$.tokens.output'), 0)
            ), 0) as token_usage
          FROM message WHERE session_id = ?`
        )
        .get(sessionId) as { msg_count: number; token_usage: number };

      // Get todos
      const todoRows = db
        .query(
          `SELECT content, status, priority, position
           FROM todo WHERE session_id = ?
           ORDER BY position ASC`
        )
        .all(sessionId) as Array<{
        content: string;
        status: string;
        priority: string;
        position: number;
      }>;

      const tasks: Task[] = todoRows.map((t) => ({
        id: String(t.position),
        subject: t.content,
        description: "",
        status: t.status === "completed" ? "completed" : t.status === "in_progress" ? "in_progress" : "pending",
        blocks: [],
        blockedBy: [],
      }));

      // Git branch: prefer workspace branch, fall back to git CLI
      let gitBranch = row.workspace_branch || undefined;
      if (!gitBranch) {
        try {
          const proc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
            cwd,
            timeout: 3_000,
          });
          const branch = proc.stdout.toString().trim();
          if (branch && branch !== "HEAD") gitBranch = branch;
        } catch {}
      }

      sessions.push({
        sessionId,
        cwd,
        projectName: row.project_name || row.title || row.slug,
        startedAt: row.time_created,
        kind: "opencode",
        entrypoint: "cli",
        name: row.title,
        isAlive: alive,
        status: deriveOpencodeStatus(alive, lastRole, lastFinish, lastToolName, lastActivityAt),
        gitBranch,
        tasks,
        recentMessageCount: stats.msg_count,
        tokenUsage: stats.token_usage,
        lastActivityAt,
        pullRequest: gitBranch ? getCachedPR(cwd, gitBranch) : undefined,
        provider: "opencode",
        model,
      });
    }

    return sessions;
  }

  watchPaths(): string[] {
    if (!existsSync(OPENCODE_DIR)) return [];
    return [OPENCODE_DIR];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/providers/opencode.ts
git commit -m "feat: create OpencodeProvider reading from SQLite"
```

---

### Task 5: Wire providers into ws.ts and app.ts

**Files:**
- Modify: `packages/server/src/ws.ts:1-106`
- Modify: `packages/server/src/app.ts:1-49`

- [ ] **Step 1: Update ws.ts to use provider registry**

Replace the imports and watcher setup in `packages/server/src/ws.ts`. Key changes:

1. Replace `import { readAllSessions } from "./sessions"` with `import { getAllSessions, getAllWatchPaths, registerProvider } from "./providers"`
2. Import both providers: `import { ClaudeProvider, getClaudeExtraWatchPaths } from "./providers/claude"` and `import { OpencodeProvider } from "./providers/opencode"`
3. In `broadcast()`, replace `readAllSessions()` with `getAllSessions()`
4. In `startWatcher()`, register providers and use `getAllWatchPaths()` plus `getClaudeExtraWatchPaths()` for extra subdirectory watching

Full updated `ws.ts`:

```typescript
import { watch } from "node:fs";
import type { WebSocket } from "ws";
import { getAllSessions, getAllWatchPaths, registerProvider } from "./providers";
import { ClaudeProvider, getClaudeExtraWatchPaths } from "./providers/claude";
import { OpencodeProvider } from "./providers/opencode";
import { startGitHubPolling } from "./github";

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
}

export function removeClient(ws: WebSocket) {
  clients.delete(ws);
}

let lastSnapshot = "";

async function broadcast() {
  if (clients.size === 0) return;
  const sessions = await getAllSessions();
  const message = JSON.stringify({ type: "sessions-updated", sessions });
  if (message === lastSnapshot) return;
  lastSnapshot = message;
  for (const ws of clients) {
    ws.send(message);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBroadcast() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(broadcast, 200);
}

function watchDir(dir: string, label: string) {
  try {
    watch(dir, { recursive: false }, scheduleBroadcast);
    console.log(`Watching ${label}: ${dir}`);
  } catch {
    // Directory may not exist yet
  }
}

export async function startWatcher() {
  // Register all providers
  registerProvider(new ClaudeProvider());
  registerProvider(new OpencodeProvider());

  // Watch provider-declared paths
  for (const path of getAllWatchPaths()) {
    watchDir(path, path);
  }

  // Watch Claude subdirectories (projects/*, tasks/*)
  const extraPaths = await getClaudeExtraWatchPaths();
  for (const path of extraPaths) {
    watchDir(path, path);
  }

  setInterval(broadcast, 2000);

  startGitHubPolling(
    () => {
      if (!lastSnapshot) return [];
      try {
        const { sessions } = JSON.parse(lastSnapshot);
        const seen = new Set<string>();
        const result: Array<{ cwd: string; branch: string }> = [];
        for (const s of sessions) {
          if (!s.isAlive || !s.gitBranch) continue;
          const key = `${s.cwd}::${s.gitBranch}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ cwd: s.cwd, branch: s.gitBranch });
        }
        return result;
      } catch {
        return [];
      }
    },
    scheduleBroadcast
  );

  console.log("File watchers started + 2s polling fallback");
}
```

- [ ] **Step 2: Update app.ts to use provider registry**

In `packages/server/src/app.ts`, replace `import { readAllSessions } from "./sessions"` with `import { getAllSessions } from "./providers"`. Update both route handlers to use `getAllSessions()`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { getAllSessions } from "./providers";
import { focusSessionWindow } from "./focus";
import { forceRefreshPR } from "./github";

export function createApp(staticRoot?: string) {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/sessions", async (c) => {
    const sessions = await getAllSessions();
    return c.json(sessions);
  });

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  app.post("/api/sessions/:pid/focus", async (c) => {
    const pid = Number(c.req.param("pid"));
    if (isNaN(pid)) return c.json({ error: "Invalid PID" }, 400);
    const result = await focusSessionWindow(pid);
    if (result.ok) return c.json({ ok: true });
    return c.json({ error: result.error }, 500);
  });

  app.post("/api/sessions/:id/refresh-pr", async (c) => {
    const id = c.req.param("id");
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    if (!session.gitBranch) return c.json({ error: "No branch" }, 400);
    const pr = await forceRefreshPR(session.cwd, session.gitBranch);
    return c.json({ pullRequest: pr });
  });

  if (staticRoot) {
    app.use("/*", serveStatic({ root: staticRoot }));
  }

  return app;
}
```

- [ ] **Step 3: Update index.ts for async startWatcher**

In `packages/server/src/index.ts`, `startWatcher()` is now async. Change line 25 from `startWatcher();` to `startWatcher();` — no change needed since the promise is fire-and-forget. But if you want to await it, wrap in an IIFE or just let it run.

- [ ] **Step 4: Verify the server starts**

```bash
cd /home/krishass/dev/herdmode && bun run dev
```

Expected: Server starts on port 3001, logs show both providers registered and watching paths.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws.ts packages/server/src/app.ts
git commit -m "feat: wire provider registry into ws.ts and app.ts"
```

---

### Task 6: Update SessionCard to show provider badge and model

**Files:**
- Modify: `packages/web/src/components/SessionCard.tsx:1-76`
- Modify: `packages/web/src/App.css`

- [ ] **Step 1: Add provider badge and model to SessionCard**

In `packages/web/src/components/SessionCard.tsx`, add a provider badge in the header and model in the meta row. Update the component:

```typescript
import type { Session, SessionStatus } from "../types";

const STATUS_CONFIG: Record<SessionStatus, { label: string; className: string }> = {
  working: { label: "Working", className: "working" },
  waiting: { label: "Waiting", className: "waiting" },
  idle: { label: "Idle", className: "idle" },
  waiting_on_agent: { label: "Waiting on Agent", className: "waiting-on-agent" },
  ended: { label: "Ended", className: "ended" },
};

const PROVIDER_CONFIG: Record<string, { label: string; className: string }> = {
  claude: { label: "CC", className: "provider-claude" },
  opencode: { label: "OC", className: "provider-opencode" },
};

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
  const providerCfg = PROVIDER_CONFIG[session.provider] || PROVIDER_CONFIG.claude;

  return (
    <div
      className={`session-card status-${session.status} ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="session-card-header">
        <span className={`provider-badge ${providerCfg.className}`}>
          {providerCfg.label}
        </span>
        <h3>{session.projectName}</h3>
        <span className={`status-badge ${STATUS_CONFIG[session.status].className}`}>
          {STATUS_CONFIG[session.status].label}
        </span>
      </div>
      <div className="session-card-meta">
        <span>{timeAgo(session.startedAt)}</span>
        {session.model && (
          <span className="tag model-tag">{session.model}</span>
        )}
        {session.gitBranch && (
          <span className="tag">
            {session.pullRequest && (
              <span className={`ci-dot ${session.pullRequest.checksPassing === true ? "passing" : session.pullRequest.checksPassing === false ? "failing" : "pending"}`} />
            )}
            {session.gitBranch}
          </span>
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

- [ ] **Step 2: Add provider badge CSS**

Append to `packages/web/src/App.css`:

```css
/* ---- Provider Badge ---- */

.provider-badge {
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 3px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  flex-shrink: 0;
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
}

.provider-badge.provider-claude {
  background: rgba(204, 120, 50, 0.15);
  color: #e8956a;
  border: 1px solid rgba(204, 120, 50, 0.3);
}

.provider-badge.provider-opencode {
  background: rgba(80, 200, 120, 0.12);
  color: #50c878;
  border: 1px solid rgba(80, 200, 120, 0.25);
}

.model-tag {
  font-size: 9.5px;
  opacity: 0.8;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/SessionCard.tsx packages/web/src/App.css
git commit -m "feat: show provider badge and model on session cards"
```

---

### Task 7: Update SessionDetail for provider/model and conditional focus

**Files:**
- Modify: `packages/web/src/components/SessionDetail.tsx:1-92`

- [ ] **Step 1: Update SessionDetail**

In `packages/web/src/components/SessionDetail.tsx`, add provider and model to the metadata section, and only show the focus button for Claude sessions (since opencode has no PID):

```typescript
import type { Session, Task } from "../types";
import { GitHubPR } from "./integrations/GitHubPR";
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

function focusSession(pid: number) {
  fetch(`/api/sessions/${pid}/focus`, { method: "POST" });
}

export function SessionDetail({ session }: Props) {
  const canFocus = session.isAlive && session.provider === "claude" && session.pid;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-title-row">
          <h2>{session.projectName}</h2>
          {canFocus && (
            <button
              className="focus-btn"
              onClick={() => focusSession(session.pid!)}
              title="Focus terminal window"
            >
              Focus Terminal
            </button>
          )}
        </div>
        <div className="detail-meta">
          <span>
            Provider: <strong>{session.provider}</strong>
            {session.model && <> &middot; Model: <code>{session.model}</code></>}
          </span>
          <span>
            Path: <code>{session.cwd}</code>
          </span>
          <span>
            Session: <code>{session.sessionId.slice(0, 8)}</code>
            {session.pid && <> &middot; PID: <code>{session.pid}</code></>}
          </span>
          <span>
            Status: <strong>{session.status}</strong> &middot;{" "}
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
                <span className={`task-icon ${task.status}`}>{taskIcon(task.status)}</span>
                <span>{task.subject}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h3>Integrations</h3>
        <GitHubPR session={session} />
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
git commit -m "feat: show provider/model in detail view, conditional focus button"
```

---

### Task 8: Smoke test end-to-end

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

```bash
cd /home/krishass/dev/herdmode && bun run dev
```

Expected: Server starts, logs show "Registered session provider: claude" and "Registered session provider: opencode".

- [ ] **Step 2: Check the API response**

```bash
curl -s http://localhost:3001/api/sessions | jq '.[0:3] | .[] | {sessionId, provider, model, status, projectName}'
```

Expected: Sessions from both providers appear. Claude sessions have `"provider": "claude"` and opencode sessions have `"provider": "opencode"`. Both have `model` populated when available.

- [ ] **Step 3: Open the web UI**

Open `http://localhost:5173` in a browser. Verify:
- Sessions from both providers appear in the list
- Provider badges ("CC" / "OC") are visible on cards
- Model labels appear on cards
- Clicking an opencode session shows detail with provider/model info
- Focus button only appears for alive Claude sessions
- GitHub PR integration works for both provider types (if they have branches)

- [ ] **Step 4: Commit any fixes**

If any issues found during smoke testing, fix and commit with descriptive message.
