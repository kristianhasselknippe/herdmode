import type { Session } from "../types";

export interface SessionProvider {
  name: string;
  readAllSessions(): Promise<Session[]>;
  watchPaths(): string[];
}
