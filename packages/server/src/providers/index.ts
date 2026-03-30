import type { SessionProvider } from "./types";

const providers: SessionProvider[] = [];

export function registerProvider(provider: SessionProvider) {
  providers.push(provider);
  console.log(`Registered session provider: ${provider.name}`);
}

export async function getAllSessions() {
  const results = await Promise.all(
    providers.map((p) => p.readAllSessions())
  );
  const sessions = results.flat();
  return sessions.sort((a, b) => {
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return b.startedAt - a.startedAt;
  });
}

export function getAllWatchPaths(): string[] {
  return providers.flatMap((p) => p.watchPaths());
}

export type { SessionProvider } from "./types";
