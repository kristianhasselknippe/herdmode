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
