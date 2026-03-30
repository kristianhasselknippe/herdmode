import { watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ServerWebSocket } from "bun";
import { readAllSessions } from "./sessions";

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>) {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>) {
  clients.delete(ws);
}

async function broadcast() {
  const sessions = await readAllSessions();
  const message = JSON.stringify({ type: "sessions-updated", sessions });
  for (const ws of clients) {
    ws.send(message);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startWatcher() {
  try {
    watch(SESSIONS_DIR, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(broadcast, 200);
    });
    console.log(`Watching ${SESSIONS_DIR} for changes`);
  } catch (err) {
    console.error("Failed to watch sessions directory:", err);
  }
}
