import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ChatMessage, TimelineData, TimelineSegment } from "./types";

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
  hasAgentTool?: boolean;
  model?: string;
}

function encodePath(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** Find the index of the last conversation root (user message with parentUuid: null).
 *  This marks the start of the current conversation after /clear or /new. */
function findLastConversationRoot(lines: string[]): number {
  let lastRootIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === "user" && entry.parentUuid === null) {
        lastRootIndex = i;
      }
    } catch {
      // skip malformed lines
    }
  }
  return lastRootIndex;
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

  const lastRootIndex = findLastConversationRoot(lines);

  let gitBranch: string | undefined;
  let messageCount = 0;
  let tokenUsage = 0;
  let lastMessageType: string | undefined;
  let lastStopReason: string | undefined;
  let lastActivityAt: number | undefined;
  let lastToolName: string | undefined;
  let hasAgentTool = false;
  let model: string | undefined;

  for (let i = lastRootIndex; i < lines.length; i++) {
    const line = lines[i];
    try {
      const entry = JSON.parse(line);
      if (entry.type === "user" || entry.type === "assistant") {
        messageCount++;
        lastMessageType = entry.type;
        if (entry.type === "assistant") {
          lastStopReason = entry.message?.stop_reason;
          if (entry.message?.model) {
            model = entry.message.model;
          }
          // Track tool names from tool_use content blocks
          hasAgentTool = false;
          const content = entry.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use" && block.name) {
                lastToolName = block.name;
                if (block.name === "Agent") {
                  hasAgentTool = true;
                }
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

  return { gitBranch, messageCount, tokenUsage, lastMessageType, lastStopReason, lastActivityAt, lastToolName, hasAgentTool, model };
}

function extractText(message: any): string {
  if (!message?.content) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block: any) => block.type === "text" && block.text)
    .map((block: any) => block.text)
    .join("\n");
}

export async function getSessionMessages(
  cwd: string,
  sessionId: string
): Promise<ChatMessage[]> {
  const projectDir = join(PROJECTS_DIR, encodePath(cwd));
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

  let content: string;
  try {
    content = await readFile(jsonlPath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n");

  const lastRootIndex = findLastConversationRoot(lines);

  const messages: ChatMessage[] = [];
  for (let i = lastRootIndex; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "user" && entry.type !== "assistant") continue;

      const text = extractText(entry.message);
      if (!text) continue;

      messages.push({
        role: entry.type,
        text,
        timestamp: entry.timestamp || "",
      });
    } catch {
      // skip malformed lines
    }
  }

  return messages;
}

interface TimelineEvent {
  timestamp: number;
  type: "user" | "assistant";
  tokens: number;
  stopReason?: string;
  hasAgentSpawn: boolean;
}

const SEGMENT_COUNT = 60;

export async function getSessionTimeline(
  cwd: string,
  sessionId: string,
  sessionStart: number
): Promise<TimelineData> {
  const projectDir = join(PROJECTS_DIR, encodePath(cwd));
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

  let content: string;
  try {
    content = await readFile(jsonlPath, "utf-8");
  } catch {
    return { sessionStart, sessionEnd: sessionStart, maxTokens: 0, segments: [] };
  }

  const lines = content.trim().split("\n");
  const lastRootIndex = findLastConversationRoot(lines);

  // Extract events from JSONL
  const events: TimelineEvent[] = [];
  for (let i = lastRootIndex; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      if (!ts) continue;

      let tokens = 0;
      let hasAgentSpawn = false;
      let stopReason: string | undefined;

      if (entry.type === "assistant") {
        stopReason = entry.message?.stop_reason;
        const usage = entry.message?.usage;
        if (usage) {
          tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
        }
        const contentBlocks = entry.message?.content;
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (block.type === "tool_use" && block.name === "Agent") {
              hasAgentSpawn = true;
            }
          }
        }
      }

      events.push({ timestamp: ts, type: entry.type, tokens, stopReason, hasAgentSpawn });
    } catch {
      // skip malformed lines
    }
  }

  if (events.length === 0) {
    return { sessionStart, sessionEnd: sessionStart, maxTokens: 0, segments: [] };
  }

  const sessionEnd = Math.max(events[events.length - 1].timestamp, Date.now());
  const duration = sessionEnd - sessionStart;
  if (duration <= 0) {
    return { sessionStart, sessionEnd, maxTokens: 0, segments: [] };
  }

  const segmentDuration = duration / SEGMENT_COUNT;

  // Bucket events into segments
  const segments: TimelineSegment[] = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const segStart = sessionStart + i * segmentDuration;
    const segEnd = segStart + segmentDuration;

    const segEvents = events.filter((e) => e.timestamp >= segStart && e.timestamp < segEnd);

    let tokens = 0;
    let hasAgentSpawn = false;
    let hasUserMessage = false;
    let lastType: string | undefined;
    let lastStopReason: string | undefined;

    for (const ev of segEvents) {
      tokens += ev.tokens;
      if (ev.hasAgentSpawn) hasAgentSpawn = true;
      if (ev.type === "user") hasUserMessage = true;
      lastType = ev.type;
      if (ev.stopReason) lastStopReason = ev.stopReason;
    }

    // Derive status for this segment
    let status: TimelineSegment["status"] = "idle";
    if (segEvents.length > 0) {
      if (lastType === "user" || lastStopReason === "tool_use") {
        status = "working";
      } else if (lastStopReason === "end_turn") {
        status = "waiting";
      } else {
        status = "working";
      }
    }

    segments.push({ startTime: segStart, endTime: segEnd, status, tokens, hasAgentSpawn, hasUserMessage });
  }

  const maxTokens = Math.max(...segments.map((s) => s.tokens), 1);

  return { sessionStart, sessionEnd, maxTokens, segments };
}
