import Database from "better-sqlite3";
import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
      this.db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
      this.db.pragma("journal_mode = WAL");
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
      .prepare(
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
        .prepare(
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
          .prepare(
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
          .prepare(
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
        .prepare(
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
        .prepare(
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
          const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd,
            timeout: 3_000,
            encoding: "utf-8",
          }).trim();
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
