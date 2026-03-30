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
