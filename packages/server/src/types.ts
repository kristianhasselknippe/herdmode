export interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

export type SessionStatus = "working" | "waiting" | "idle" | "ended";

export interface Session {
  pid: number;
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
