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

function queryDb(sql: string): any[] {
  try {
    const output = execFileSync("sqlite3", ["-json", "-readonly", DB_PATH, sql], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (!output.trim()) return [];
    return JSON.parse(output);
  } catch {
    return [];
  }
}

export class OpencodeProvider implements SessionProvider {
  name = "opencode";

  async readAllSessions(): Promise<Session[]> {
    if (!existsSync(DB_PATH)) return [];

    const runningProcesses = getRunningOpencodeProcesses();

    // Count processes per cwd for alive detection
    const processesByCwd = new Map<string, number>();
    for (const proc of runningProcesses) {
      processesByCwd.set(proc.cwd, (processesByCwd.get(proc.cwd) || 0) + 1);
    }

    const rows = queryDb(
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
    );

    if (rows.length === 0) return [];

    // Batch-fetch all last messages and stats in single queries
    const sessionIds = rows.filter((r: any) => !r.parent_id).map((r: any) => r.id);
    const idList = sessionIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(",");

    // Get last message per session (using window function)
    const lastMessages = queryDb(
      `SELECT session_id, data FROM (
        SELECT session_id, data, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) as rn
        FROM message WHERE session_id IN (${idList})
      ) WHERE rn = 1`
    );
    const lastMsgMap = new Map<string, any>();
    for (const msg of lastMessages) {
      try {
        lastMsgMap.set(msg.session_id, JSON.parse(msg.data));
      } catch {}
    }

    // Get last assistant message per session (for model info when last msg is user)
    const lastAssistantMessages = queryDb(
      `SELECT session_id, data FROM (
        SELECT session_id, data, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) as rn
        FROM message WHERE session_id IN (${idList}) AND json_extract(data, '$.role') = 'assistant'
      ) WHERE rn = 1`
    );
    const lastAssistantMap = new Map<string, any>();
    for (const msg of lastAssistantMessages) {
      try {
        lastAssistantMap.set(msg.session_id, JSON.parse(msg.data));
      } catch {}
    }

    // Get last tool part per session
    const lastToolParts = queryDb(
      `SELECT session_id, data FROM (
        SELECT session_id, data, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) as rn
        FROM part WHERE session_id IN (${idList}) AND json_extract(data, '$.type') = 'tool'
      ) WHERE rn = 1`
    );
    const lastToolMap = new Map<string, any>();
    for (const part of lastToolParts) {
      try {
        lastToolMap.set(part.session_id, JSON.parse(part.data));
      } catch {}
    }

    // Get message counts and token usage per session
    const statsRows = queryDb(
      `SELECT session_id,
        COUNT(*) as msg_count,
        COALESCE(SUM(
          COALESCE(json_extract(data, '$.tokens.input'), 0) +
          COALESCE(json_extract(data, '$.tokens.output'), 0)
        ), 0) as token_usage
      FROM message WHERE session_id IN (${idList})
      GROUP BY session_id`
    );
    const statsMap = new Map<string, { msg_count: number; token_usage: number }>();
    for (const s of statsRows) {
      statsMap.set(s.session_id, { msg_count: s.msg_count, token_usage: s.token_usage });
    }

    // Get all todos
    const todoRows = queryDb(
      `SELECT session_id, content, status, priority, position
       FROM todo WHERE session_id IN (${idList})
       ORDER BY session_id, position ASC`
    );
    const todoMap = new Map<string, Array<{ content: string; status: string; position: number }>>();
    for (const t of todoRows) {
      if (!todoMap.has(t.session_id)) todoMap.set(t.session_id, []);
      todoMap.get(t.session_id)!.push(t);
    }

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
      for (let i = 0; i < count && i < cwdSessions.length; i++) {
        aliveSessionIds.add(cwdSessions[i].id);
      }
    }

    const sessions: Session[] = [];

    for (const row of rows) {
      if (row.parent_id) continue;

      const sessionId = row.id;
      const cwd = row.directory || row.worktree;
      const alive = aliveSessionIds.has(sessionId);

      const msgData = lastMsgMap.get(sessionId);
      let lastRole: string | undefined;
      let lastFinish: string | undefined;
      let lastActivityAt: number | undefined;
      let model: string | undefined;
      let lastToolName: string | undefined;

      if (msgData) {
        lastRole = msgData.role;
        lastFinish = msgData.finish;
        lastActivityAt = msgData.time?.completed || msgData.time?.created;
        if (msgData.role === "assistant") {
          model = msgData.modelID;
        }
      }

      // If last message was user, get model from last assistant message
      if (lastRole === "user") {
        const assistantData = lastAssistantMap.get(sessionId);
        if (assistantData) {
          model = assistantData.modelID;
        }
      }

      // Get last tool name
      if (lastRole === "assistant" && lastFinish === "tool-calls") {
        const toolData = lastToolMap.get(sessionId);
        if (toolData) {
          lastToolName = toolData.tool;
        }
      }

      const stats = statsMap.get(sessionId) || { msg_count: 0, token_usage: 0 };

      const todos = todoMap.get(sessionId) || [];
      const tasks: Task[] = todos.map((t) => ({
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
