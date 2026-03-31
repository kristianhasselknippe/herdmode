export interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

export type SessionStatus = "working" | "waiting" | "idle" | "waiting_on_agent" | "ended";

export type SessionProvider = "claude" | "opencode";

export interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | null;
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

export interface PullRequestData {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  reviewDecision: ReviewDecision;
  checks: CheckRun[];
  checksPassing: boolean | null;
}

export interface Session {
  pid?: number;
  sessionId: string;
  cwd: string;
  projectName: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
  isAlive: boolean;
  status: SessionStatus;
  gitBranch?: string;
  tasks: Task[];
  recentMessageCount: number;
  tokenUsage: number;
  lastActivityAt?: number;
  pullRequest?: PullRequestData;
  provider: SessionProvider;
  model?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface RawSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
}
