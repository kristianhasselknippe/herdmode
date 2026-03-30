import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestData, CheckRun, ReviewDecision } from "./types";

const execFileAsync = promisify(execFile);

const GH_FIELDS = "number,title,url,state,reviewDecision,statusCheckRollup,mergedAt";
const SKIP_BRANCHES = new Set(["main", "master", "develop", "development"]);
const CACHE_TTL_MS = 60_000;
const POLL_INTERVAL_MS = 30_000;

interface CacheEntry {
  data: PullRequestData | null;
  fetchedAt: number;
}

const prCache = new Map<string, CacheEntry>();
let ghAvailable = true;
let ghChecked = false;

function cacheKey(cwd: string, branch: string): string {
  return `${cwd}::${branch}`;
}

interface GhCheckRun {
  __typename: string;
  name: string;
  status: string;
  conclusion: string | null;
}

interface GhPR {
  number: number;
  title: string;
  url: string;
  state: string;
  reviewDecision: string | null;
  statusCheckRollup: GhCheckRun[] | null;
  mergedAt: string | null;
}

function mapChecks(raw: GhCheckRun[] | null): CheckRun[] {
  if (!raw) return [];
  return raw.map((c) => ({
    name: c.name,
    status: c.status.toLowerCase() as CheckRun["status"],
    conclusion: c.conclusion ? (c.conclusion.toLowerCase() as CheckRun["conclusion"]) : null,
  }));
}

function deriveChecksPassing(checks: CheckRun[]): boolean | null {
  if (checks.length === 0) return null;
  const anyFailed = checks.some(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "cancelled"
  );
  if (anyFailed) return false;
  const allDone = checks.every((c) => c.status === "completed");
  if (!allDone) return null;
  return true;
}

function mapPR(raw: GhPR): PullRequestData {
  const checks = mapChecks(raw.statusCheckRollup);
  const state = raw.mergedAt ? "merged" : raw.state.toLowerCase() as PullRequestData["state"];
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state,
    reviewDecision: (raw.reviewDecision as ReviewDecision) ?? null,
    checks,
    checksPassing: deriveChecksPassing(checks),
  };
}

async function checkGhAvailable(): Promise<boolean> {
  if (ghChecked) return ghAvailable;
  ghChecked = true;
  try {
    await execFileAsync("gh", ["auth", "status"], { timeout: 5_000 });
    ghAvailable = true;
  } catch {
    console.log("GitHub integration disabled: gh CLI not available or not authenticated");
    ghAvailable = false;
  }
  return ghAvailable;
}

async function fetchPR(cwd: string, branch: string): Promise<PullRequestData | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "list", "--head", branch, "--json", GH_FIELDS, "--limit", "1"],
      { cwd, timeout: 10_000 }
    );
    const prs: GhPR[] = JSON.parse(stdout);
    if (prs.length === 0) return null;
    return mapPR(prs[0]);
  } catch {
    return null;
  }
}

export function getCachedPR(cwd: string, branch: string): PullRequestData | undefined {
  if (SKIP_BRANCHES.has(branch)) return undefined;
  const entry = prCache.get(cacheKey(cwd, branch));
  return entry?.data ?? undefined;
}

export async function forceRefreshPR(cwd: string, branch: string): Promise<PullRequestData | null> {
  if (SKIP_BRANCHES.has(branch) || !ghAvailable) return null;
  const data = await fetchPR(cwd, branch);
  prCache.set(cacheKey(cwd, branch), { data, fetchedAt: Date.now() });
  return data;
}

export function startGitHubPolling(
  getActiveBranches: () => Array<{ cwd: string; branch: string }>,
  onUpdate: () => void
) {
  async function poll() {
    if (!(await checkGhAvailable())) return;

    const branches = getActiveBranches();
    const now = Date.now();
    const stale: Array<{ cwd: string; branch: string }> = [];

    for (const { cwd, branch } of branches) {
      if (SKIP_BRANCHES.has(branch)) continue;
      const key = cacheKey(cwd, branch);
      const entry = prCache.get(key);
      if (!entry || now - entry.fetchedAt > CACHE_TTL_MS) {
        stale.push({ cwd, branch });
      }
    }

    if (stale.length === 0) return;

    const results = await Promise.allSettled(
      stale.map(({ cwd, branch }) => fetchPR(cwd, branch).then((data) => ({ cwd, branch, data })))
    );

    let changed = false;
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { cwd, branch, data } = result.value;
      const key = cacheKey(cwd, branch);
      const prev = prCache.get(key);
      prCache.set(key, { data, fetchedAt: Date.now() });
      if (JSON.stringify(prev?.data) !== JSON.stringify(data)) {
        changed = true;
      }
    }

    if (changed) onUpdate();
  }

  setInterval(poll, POLL_INTERVAL_MS);
  // Run first poll after a short delay to let sessions load first
  setTimeout(poll, 3_000);
}
