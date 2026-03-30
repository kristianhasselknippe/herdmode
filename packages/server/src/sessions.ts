import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { RawSessionFile, Session, SessionStatus } from "./types";
import { getTasksForSession } from "./tasks";
import { getProjectData, type ProjectData } from "./projects";

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

function deriveStatus(alive: boolean, projectData: ProjectData): SessionStatus {
  if (!alive) return "ended";

  const { lastMessageType, lastStopReason, lastActivityAt } = projectData;

  // If we have no conversation data yet, session just started
  if (!lastMessageType) return "waiting";

  const timeSinceActivity = lastActivityAt
    ? Date.now() - lastActivityAt
    : Infinity;

  // Last message was from user → agent is processing it
  if (lastMessageType === "user") {
    return "working";
  }

  // Last message was assistant with tool_use → agent is mid-work (calling tools)
  if (lastMessageType === "assistant" && lastStopReason === "tool_use") {
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
