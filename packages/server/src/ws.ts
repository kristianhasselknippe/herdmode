import { watch } from "node:fs";
import type { WebSocket } from "ws";
import { getAllSessions, getAllWatchPaths, registerProvider } from "./providers";
import { ClaudeProvider, getClaudeExtraWatchPaths } from "./providers/claude";
import { OpencodeProvider } from "./providers/opencode";
import { startGitHubPolling, stopGitHubPolling } from "./github";

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
}

export function removeClient(ws: WebSocket) {
  clients.delete(ws);
}

let lastSnapshot = "";

async function broadcast() {
  if (clients.size === 0) return;
  const sessions = await getAllSessions();
  const message = JSON.stringify({ type: "sessions-updated", sessions });
  if (message === lastSnapshot) return;
  lastSnapshot = message;
  for (const ws of clients) {
    ws.send(message);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollingInterval: ReturnType<typeof setInterval> | null = null;

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

export async function startWatcher() {
  // Register all providers
  registerProvider(new ClaudeProvider());
  registerProvider(new OpencodeProvider());

  // Watch provider-declared paths
  for (const path of getAllWatchPaths()) {
    watchDir(path, path);
  }

  // Watch Claude subdirectories (projects/*, tasks/*)
  const extraPaths = await getClaudeExtraWatchPaths();
  for (const path of extraPaths) {
    watchDir(path, path);
  }

  pollingInterval = setInterval(broadcast, 2000);

  startGitHubPolling(
    () => {
      if (!lastSnapshot) return [];
      try {
        const { sessions } = JSON.parse(lastSnapshot);
        const seen = new Set<string>();
        const result: Array<{ cwd: string; branch: string }> = [];
        for (const s of sessions) {
          if (!s.isAlive || !s.gitBranch) continue;
          const key = `${s.cwd}::${s.gitBranch}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ cwd: s.cwd, branch: s.gitBranch });
        }
        return result;
      } catch {
        return [];
      }
    },
    scheduleBroadcast
  );

  console.log("File watchers started + 2s polling fallback");
}

export function stopWatcher() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  stopGitHubPolling();
  for (const ws of clients) {
    ws.close();
  }
  clients.clear();
}
