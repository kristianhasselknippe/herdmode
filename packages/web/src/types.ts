export interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

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
  gitBranch?: string;
  tasks: Task[];
  recentMessageCount: number;
  tokenUsage: number;
}
