import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

export interface ProjectData {
  gitBranch?: string;
  messageCount: number;
  tokenUsage: number;
  lastMessageType?: string;
  lastStopReason?: string;
  lastActivityAt?: number;
  lastToolName?: string;
}

function encodePath(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 3_000,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

export async function getProjectData(
  cwd: string,
  sessionId: string
): Promise<ProjectData> {
  const projectDir = join(PROJECTS_DIR, encodePath(cwd));
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

  let content: string | null;
  try {
    content = await readFile(jsonlPath, "utf-8");
  } catch {
    content = null;
  }

  if (!content) {
    const gitBranch = await getGitBranch(cwd);
    return { gitBranch, messageCount: 0, tokenUsage: 0 };
  }

  const lines = content.trim().split("\n");
  let gitBranch: string | undefined;
  let messageCount = 0;
  let tokenUsage = 0;
  let lastMessageType: string | undefined;
  let lastStopReason: string | undefined;
  let lastActivityAt: number | undefined;
  let lastToolName: string | undefined;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "user" || entry.type === "assistant") {
        messageCount++;
        lastMessageType = entry.type;
        if (entry.type === "assistant") {
          lastStopReason = entry.message?.stop_reason;
          // Track the last tool name from tool_use content blocks
          const content = entry.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use" && block.name) {
                lastToolName = block.name;
              }
            }
          }
        }
        if (entry.timestamp) {
          lastActivityAt = new Date(entry.timestamp).getTime();
        }
      }
      if (entry.gitBranch && entry.gitBranch !== "HEAD") {
        gitBranch = entry.gitBranch;
      }
      if (entry.message?.usage) {
        const u = entry.message.usage;
        tokenUsage +=
          (u.input_tokens || 0) + (u.output_tokens || 0);
      }
    } catch {
      // skip malformed lines
    }
  }

  // Fall back to git CLI if JSONL doesn't have branch info
  if (!gitBranch) {
    gitBranch = await getGitBranch(cwd);
  }

  return { gitBranch, messageCount, tokenUsage, lastMessageType, lastStopReason, lastActivityAt, lastToolName };
}
