import { $ } from "bun";

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

/**
 * Walk the process tree from a PID upward to find the terminal emulator ancestor.
 */
async function findTerminalPid(pid: number): Promise<number | null> {
  let current = pid;
  while (current > 1) {
    try {
      const comm = (await $`ps -o comm= -p ${current}`.text()).trim();
      if (TERMINAL_NAMES.has(comm)) return current;
      const ppid = (await $`ps -o ppid= -p ${current}`.text()).trim();
      current = Number(ppid);
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
    // Get all Hyprland clients and find the one matching the terminal PID
    const clientsJson = (await $`hyprctl clients -j`.text()).trim();
    const clients = JSON.parse(clientsJson) as Array<{
      pid: number;
      address: string;
      workspace: { id: number };
    }>;

    const window = clients.find((c) => c.pid === terminalPid);
    if (!window) {
      return { ok: false, error: `Terminal PID ${terminalPid} not found in Hyprland clients` };
    }

    await $`hyprctl dispatch focuswindow pid:${terminalPid}`.quiet();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
