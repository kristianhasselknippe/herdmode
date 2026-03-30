import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionProvider } from "./types";
import { readAllSessions, SESSIONS_DIR } from "../sessions";

const CLAUDE_DIR = join(homedir(), ".claude");
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
