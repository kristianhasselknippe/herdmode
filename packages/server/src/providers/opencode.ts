import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Session, Task, SessionStatus, ChatMessage } from "../types";
import type { SessionProvider } from "./types";
import { getCachedPR } from "../github";

const execFileAsync = promisify(execFile);

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

// Run all queries in a single sqlite3 invocation using delimiter rows
async function queryDbBatch(queries: string[]): Promise<any[][]> {
  const SEP = "__QUERY_SEP__";
  // Prefix each query with a delimiter SELECT so empty results are still trackable
  const combined = queries
    .map((q) => `SELECT '${SEP}' as _sep; ${q}`)
    .join("; ");

  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-json", "-readonly", DB_PATH, combined],
      { encoding: "utf-8", timeout: 10_000 }
    );
    if (!stdout.trim()) return queries.map(() => []);

    // sqlite3 -json outputs one JSON array per statement, but arrays with
    // multiple rows span multiple lines. Extract each top-level [...] block.
    const parsed: any[][] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < stdout.length; i++) {
      if (stdout[i] === "[") {
        if (depth === 0) start = i;
        depth++;
      } else if (stdout[i] === "]") {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            parsed.push(JSON.parse(stdout.slice(start, i + 1)));
          } catch {
            // skip unparseable blocks
          }
          start = -1;
        }
      }
    }

    // Group by delimiter: each delimiter line starts a new query result
    const results: any[][] = [];
    let current: any[] = [];
    for (const arr of parsed) {
      if (arr.length === 1 && arr[0]._sep === SEP) {
        // Start of a new query result group
        results.push(current);
        current = [];
      } else {
        // Data rows — flatten the array into current
        current.push(...arr);
      }
    }
    results.push(current);

    // First group (before first delimiter) is always empty, skip it
    const final = results.slice(1);
    while (final.length < queries.length) final.push([]);
    return final;
  } catch {
    return queries.map(() => []);
  }
}

async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 3_000,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

export class OpencodeProvider implements SessionProvider {
  name = "opencode";

  async readAllSessions(): Promise<Session[]> {
    if (!existsSync(DB_PATH)) return [];

    const runningProcesses = getRunningOpencodeProcesses();

    const processesByCwd = new Map<string, number[]>();
    for (const proc of runningProcesses) {
      if (!processesByCwd.has(proc.cwd)) processesByCwd.set(proc.cwd, []);
      processesByCwd.get(proc.cwd)!.push(proc.pid);
    }

    // Single sqlite3 invocation with all 6 queries
    const sessionQuery = `SELECT
      s.id, s.title, s.slug, s.directory, s.time_created, s.time_updated,
      s.workspace_id, s.parent_id,
      p.name as project_name, p.worktree,
      w.branch as workspace_branch
    FROM session s
    JOIN project p ON s.project_id = p.id
    LEFT JOIN workspace w ON s.workspace_id = w.id
    WHERE s.time_archived IS NULL
    ORDER BY s.time_updated DESC`;

    const lastMsgQuery = `SELECT session_id, data FROM (
      SELECT session_id, data, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) as rn
      FROM message WHERE session_id IN (SELECT id FROM session WHERE time_archived IS NULL AND parent_id IS NULL)
    ) WHERE rn = 1`;

    const lastAssistantQuery = `SELECT session_id, data FROM (
      SELECT session_id, data, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) as rn
      FROM message WHERE session_id IN (SELECT id FROM session WHERE time_archived IS NULL AND parent_id IS NULL)
        AND json_extract(data, '$.role') = 'assistant'
    ) WHERE rn = 1`;

    const lastToolQuery = `SELECT session_id, data FROM (
      SELECT session_id, data, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC) as rn
      FROM part WHERE session_id IN (SELECT id FROM session WHERE time_archived IS NULL AND parent_id IS NULL)
        AND json_extract(data, '$.type') = 'tool'
    ) WHERE rn = 1`;

    const statsQuery = `SELECT session_id,
      COUNT(*) as msg_count,
      COALESCE(SUM(
        COALESCE(json_extract(data, '$.tokens.input'), 0) +
        COALESCE(json_extract(data, '$.tokens.output'), 0)
      ), 0) as token_usage
    FROM message WHERE session_id IN (SELECT id FROM session WHERE time_archived IS NULL AND parent_id IS NULL)
    GROUP BY session_id`;

    const todoQuery = `SELECT session_id, content, status, priority, position
     FROM todo WHERE session_id IN (SELECT id FROM session WHERE time_archived IS NULL AND parent_id IS NULL)
     ORDER BY session_id, position ASC`;

    const [rows, lastMessages, lastAssistantMessages, lastToolParts, statsRows, todoRows] =
      await queryDbBatch([sessionQuery, lastMsgQuery, lastAssistantQuery, lastToolQuery, statsQuery, todoQuery]);

    if (!rows || rows.length === 0) return [];

    // Build lookup maps
    const lastMsgMap = new Map<string, any>();
    for (const msg of lastMessages) {
      try { lastMsgMap.set(msg.session_id, JSON.parse(msg.data)); } catch {}
    }

    const lastAssistantMap = new Map<string, any>();
    for (const msg of lastAssistantMessages) {
      try { lastAssistantMap.set(msg.session_id, JSON.parse(msg.data)); } catch {}
    }

    const lastToolMap = new Map<string, any>();
    for (const part of lastToolParts) {
      try { lastToolMap.set(part.session_id, JSON.parse(part.data)); } catch {}
    }

    const statsMap = new Map<string, { msg_count: number; token_usage: number }>();
    for (const s of statsRows) {
      statsMap.set(s.session_id, { msg_count: s.msg_count, token_usage: s.token_usage });
    }

    const todoMap = new Map<string, Array<{ content: string; status: string; position: number }>>();
    for (const t of todoRows) {
      if (!todoMap.has(t.session_id)) todoMap.set(t.session_id, []);
      todoMap.get(t.session_id)!.push(t);
    }

    // Alive detection
    const sessionsByCwd = new Map<string, typeof rows>();
    for (const row of rows) {
      const cwd = row.directory || row.worktree;
      if (!sessionsByCwd.has(cwd)) sessionsByCwd.set(cwd, []);
      sessionsByCwd.get(cwd)!.push(row);
    }

    const aliveSessionPids = new Map<string, number>();
    for (const [cwd, cwdSessions] of sessionsByCwd) {
      const pids = processesByCwd.get(cwd) || [];
      for (let i = 0; i < pids.length && i < cwdSessions.length; i++) {
        aliveSessionPids.set(cwdSessions[i].id, pids[i]);
      }
    }

    // Resolve git branches in parallel for sessions missing workspace branch
    const branchPromises = new Map<string, Promise<string | undefined>>();
    for (const row of rows) {
      if (row.parent_id || row.workspace_branch) continue;
      const cwd = row.directory || row.worktree;
      if (!branchPromises.has(cwd)) {
        branchPromises.set(cwd, getGitBranch(cwd));
      }
    }
    const branchResults = new Map<string, string | undefined>();
    for (const [cwd, promise] of branchPromises) {
      branchResults.set(cwd, await promise);
    }

    const sessions: Session[] = [];

    for (const row of rows) {
      if (row.parent_id) continue;

      const sessionId = row.id;
      const cwd = row.directory || row.worktree;
      const alivePid = aliveSessionPids.get(sessionId);
      const alive = alivePid !== undefined;

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

      if (lastRole === "user") {
        const assistantData = lastAssistantMap.get(sessionId);
        if (assistantData) model = assistantData.modelID;
      }

      if (lastRole === "assistant" && lastFinish === "tool-calls") {
        const toolData = lastToolMap.get(sessionId);
        if (toolData) lastToolName = toolData.tool;
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

      const gitBranch = row.workspace_branch || branchResults.get(cwd) || undefined;

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
        pid: alivePid,
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

export async function getOpencodeMessages(sessionId: string): Promise<ChatMessage[]> {
  if (!existsSync(DB_PATH)) return [];

  const query = `SELECT m.data as msg_data, p.data as part_data, m.time_created
    FROM part p
    JOIN message m ON p.message_id = m.id
    WHERE p.session_id = '${sessionId.replace(/'/g, "''")}'
      AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created ASC, p.time_created ASC`;

  const [rows] = await queryDbBatch([query]);
  if (!rows || rows.length === 0) return [];

  const messages: ChatMessage[] = [];
  for (const row of rows) {
    try {
      const msgData = JSON.parse(row.msg_data);
      const partData = JSON.parse(row.part_data);
      if (!partData.text) continue;
      messages.push({
        role: msgData.role === "user" ? "user" : "assistant",
        text: partData.text,
        timestamp: new Date(row.time_created).toISOString(),
      });
    } catch {
      // skip malformed rows
    }
  }

  return messages;
}
