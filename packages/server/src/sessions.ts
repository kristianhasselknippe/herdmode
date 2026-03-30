import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { RawSessionFile, Session, SessionStatus } from "./types";
import { getTasksForSession } from "./tasks";
import { getProjectData, type ProjectData } from "./projects";
import { getCachedPR } from "./github";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const IDLE_THRESHOLD_MS = 60_000; // 1 minute without activity = idle
const TOOL_APPROVAL_THRESHOLD_MS = 10_000; // 10s without follow-up = likely waiting for approval

function deriveStatus(alive: boolean, projectData: ProjectData): SessionStatus {
  if (!alive) return "ended";

  const { lastMessageType, lastStopReason, lastActivityAt, lastToolName } = projectData;

  // If we have no conversation data yet, session just started
  if (!lastMessageType) return "waiting";

  const timeSinceActivity = lastActivityAt
    ? Date.now() - lastActivityAt
    : Infinity;

  // Last message was from user → agent is processing it
  if (lastMessageType === "user") {
    return "working";
  }

  // Last message was assistant with tool_use → could be mid-work or waiting for approval.
  // If the tool was auto-approved and executed, a user message with the result would
  // follow quickly. A long gap means the user hasn't approved the tool yet.
  if (lastMessageType === "assistant" && lastStopReason === "tool_use") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) {
      // If the last tool was Agent, the session is waiting on a sub-agent
      if (lastToolName === "Agent") return "waiting_on_agent";
      return "idle";
    }
    if (timeSinceActivity > TOOL_APPROVAL_THRESHOLD_MS) {
      if (lastToolName === "Agent") return "waiting_on_agent";
      return "waiting";
    }
    return "working";
  }

  // Last message was assistant with end_turn → finished, waiting for user
  if (lastMessageType === "assistant" && lastStopReason === "end_turn") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) return "idle";
    return "waiting";
  }

  // Fallback: if recent activity, working; otherwise idle
  if (timeSinceActivity < IDLE_THRESHOLD_MS) return "waiting";
  return "idle";
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

      const alive = isProcessAlive(raw.pid);
      sessions.push({
        pid: raw.pid,
        sessionId: raw.sessionId,
        cwd: raw.cwd,
        projectName: raw.name || basename(raw.cwd),
        startedAt: raw.startedAt,
        kind: raw.kind,
        entrypoint: raw.entrypoint,
        name: raw.name,
        isAlive: alive,
        status: deriveStatus(alive, projectData),
        gitBranch: projectData.gitBranch,
        tasks,
        recentMessageCount: projectData.messageCount,
        tokenUsage: projectData.tokenUsage,
        lastActivityAt: projectData.lastActivityAt,
        pullRequest: projectData.gitBranch
          ? getCachedPR(raw.cwd, projectData.gitBranch)
          : undefined,
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
