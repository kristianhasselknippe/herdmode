import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TERMINAL_NAMES = new Set([
  "alacritty",
  "kitty",
  "wezterm",
  "wezterm-gui",
  "foot",
  "gnome-terminal-server",
  "konsole",
  "xterm",
  "tilix",
  "terminator",
]);

async function findTerminalPid(pid: number): Promise<number | null> {
  let current = pid;
  while (current > 1) {
    try {
      const { stdout: comm } = await execFileAsync("ps", ["-o", "comm=", "-p", String(current)]);
      if (TERMINAL_NAMES.has(comm.trim())) return current;
      const { stdout: ppid } = await execFileAsync("ps", ["-o", "ppid=", "-p", String(current)]);
      current = Number(ppid.trim());
      if (isNaN(current)) return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function focusSessionWindow(
  pid: number
): Promise<{ ok: boolean; error?: string }> {
  const terminalPid = await findTerminalPid(pid);
  if (!terminalPid) {
    return { ok: false, error: "Could not find terminal window for this session" };
  }

  try {
    const { stdout: clientsJson } = await execFileAsync("hyprctl", ["clients", "-j"]);
    const clients = JSON.parse(clientsJson.trim()) as Array<{
      pid: number;
      address: string;
      workspace: { id: number };
    }>;

    const window = clients.find((c) => c.pid === terminalPid);
    if (!window) {
      return { ok: false, error: `Terminal PID ${terminalPid} not found in Hyprland clients` };
    }

    await execFileAsync("hyprctl", ["dispatch", "focuswindow", `pid:${terminalPid}`]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
