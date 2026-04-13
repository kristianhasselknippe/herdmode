import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { RawSessionFile, Session, SessionStatus } from "./types";
import { getTasksForSession } from "./tasks";
import { getProjectData, isSubAgentWaiting, type ProjectData } from "./projects";
import type { HookSessionState } from "./hook-state";
import { getHookState } from "./hook-state";
import { getCachedPR } from "./github";

export const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const IDLE_THRESHOLD_MS = 60_000; // 1 minute without activity = idle
const TOOL_APPROVAL_THRESHOLD_MS = 10_000; // 10s without follow-up = likely waiting for approval

export function deriveStatus(
  alive: boolean,
  projectData: ProjectData,
  hookState?: HookSessionState
): SessionStatus {
  if (!alive) return "ended";

  // Hook state takes priority — no heuristics needed
  if (hookState && !hookState.isEnded) {
    if (hookState.isWaitingForPermission) return "waiting";
    if (hookState.isToolRunning) return "working";
    if (hookState.hasSubAgent) return "waiting_on_agent";

    switch (hookState.lastEvent.event) {
      case "UserPromptSubmit":
        return "working";
      case "Stop":
        return "waiting";
    }
  }

  // Fallback: existing JSONL-based heuristics
  const { lastMessageType, lastStopReason, lastActivityAt, hasAgentTool } = projectData;

  if (!lastMessageType) return "waiting";

  const timeSinceActivity = lastActivityAt
    ? Date.now() - lastActivityAt
    : Infinity;

  if (lastMessageType === "user") {
    return "working";
  }

  if (lastMessageType === "assistant" && lastStopReason === "tool_use") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) {
      if (hasAgentTool) return "waiting_on_agent";
      return "idle";
    }
    if (timeSinceActivity > TOOL_APPROVAL_THRESHOLD_MS) {
      if (hasAgentTool) return "waiting_on_agent";
      return "waiting";
    }
    return "working";
  }

  if (lastMessageType === "assistant" && lastStopReason === "end_turn") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) return "idle";
    return "waiting";
  }

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
      const hookState = getHookState(raw.sessionId);
      let status = deriveStatus(alive, projectData, hookState);

      // Only do expensive sub-agent file scanning when we don't have hook state
      if (status === "waiting_on_agent" && !hookState) {
        const agentWaiting = await isSubAgentWaiting(raw.cwd, raw.sessionId);
        if (agentWaiting) status = "waiting";
      }

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
        status,
        gitBranch: projectData.gitBranch,
        tasks,
        recentMessageCount: projectData.messageCount,
        tokenUsage: projectData.tokenUsage,
        lastActivityAt: projectData.lastActivityAt,
        pullRequest: projectData.gitBranch
          ? getCachedPR(raw.cwd, projectData.gitBranch)
          : undefined,
        provider: "claude" as const,
        model: projectData.model,
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
