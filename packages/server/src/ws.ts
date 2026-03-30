import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ServerWebSocket } from "bun";
import { readAllSessions } from "./sessions";

const CLAUDE_DIR = join(homedir(), ".claude");
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>) {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>) {
  clients.delete(ws);
}

let lastSnapshot = "";

async function broadcast() {
  if (clients.size === 0) return;
  const sessions = await readAllSessions();
  const message = JSON.stringify({ type: "sessions-updated", sessions });
  // Only send if data actually changed
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

async function watchProjectSubdirs() {
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      watchDir(join(PROJECTS_DIR, dir), `project/${dir}`);
    }
  } catch {
    // projects dir may not exist
  }
}

async function watchTaskSubdirs() {
  try {
    const dirs = await readdir(TASKS_DIR);
    for (const dir of dirs) {
      watchDir(join(TASKS_DIR, dir), `tasks/${dir}`);
    }
  } catch {
    // tasks dir may not exist
  }
}

export function startWatcher() {
  // Watch session files for new/removed sessions
  watchDir(SESSIONS_DIR, "sessions");

  // Watch project conversation files for status changes
  watchProjectSubdirs();

  // Watch task files
  watchTaskSubdirs();

  // Poll every 2s as a reliable fallback — fs.watch can miss events
  // on some filesystems or for deeply nested changes
  setInterval(broadcast, 2000);

  console.log("File watchers started + 2s polling fallback");
}
