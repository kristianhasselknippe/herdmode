# Hooks Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace heuristic-based session status detection with real-time Claude Code hook events via HTTP, keeping file-based JSONL parsing as fallback.

**Architecture:** A new `hook-state.ts` module holds a `Map<sessionId, HookSessionState>` updated by a single `POST /api/hooks/:event` route. `deriveStatus()` checks hook state first, falls back to existing JSONL heuristics when absent. A Claude Code plugin with a `/setup-herdmode` skill configures the hooks in user settings.

**Tech Stack:** Bun, Hono, TypeScript. Bun's built-in test runner for tests.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `packages/server/src/hook-state.ts` | Hook state store — Map, updateHookState(), getHookState(), clearHookState() |
| `packages/server/src/hook-state.test.ts` | Tests for hook state transitions |
| `packages/server/src/sessions.test.ts` | Tests for deriveStatus() with and without hook state |
| `plugin/.claude-plugin/plugin.json` | Minimal plugin manifest |
| `plugin/skills/setup-herdmode/SKILL.md` | Skill that configures hooks in ~/.claude/settings.json |

### Modified files

| File | Change |
|---|---|
| `packages/server/src/ws.ts:34` | Export `scheduleBroadcast` function |
| `packages/server/src/app.ts:1-74` | Add POST /api/hooks/:event route, import updateHookState + scheduleBroadcast |
| `packages/server/src/sessions.ts:23-65` | Add hookState parameter to deriveStatus(), check it before heuristics |
| `packages/server/src/sessions.ts:67-126` | readAllSessions() passes hook state, skips isSubAgentWaiting() when present |

---

### Task 1: Hook State Store

**Files:**
- Create: `packages/server/src/hook-state.ts`
- Create: `packages/server/src/hook-state.test.ts`

- [ ] **Step 1: Write failing tests for hook state transitions**

```ts
// packages/server/src/hook-state.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { updateHookState, getHookState, clearHookState } from "./hook-state";

beforeEach(() => {
  clearHookState();
});

describe("updateHookState", () => {
  test("PreToolUse sets isToolRunning and activeToolName", () => {
    updateHookState("sess-1", "PreToolUse", {
      session_id: "sess-1",
      tool_name: "Bash",
    });
    const state = getHookState("sess-1");
    expect(state).toBeDefined();
    expect(state!.isToolRunning).toBe(true);
    expect(state!.activeToolName).toBe("Bash");
  });

  test("PostToolUse clears isToolRunning and activeToolName", () => {
    updateHookState("sess-1", "PreToolUse", {
      session_id: "sess-1",
      tool_name: "Bash",
    });
    updateHookState("sess-1", "PostToolUse", {
      session_id: "sess-1",
      tool_name: "Bash",
    });
    const state = getHookState("sess-1");
    expect(state!.isToolRunning).toBe(false);
    expect(state!.activeToolName).toBeUndefined();
  });

  test("PostToolUseFailure clears isToolRunning", () => {
    updateHookState("sess-1", "PreToolUse", {
      session_id: "sess-1",
      tool_name: "Edit",
    });
    updateHookState("sess-1", "PostToolUseFailure", {
      session_id: "sess-1",
      tool_name: "Edit",
    });
    const state = getHookState("sess-1");
    expect(state!.isToolRunning).toBe(false);
    expect(state!.activeToolName).toBeUndefined();
  });

  test("SubagentStart sets hasSubAgent", () => {
    updateHookState("sess-1", "SubagentStart", {
      session_id: "sess-1",
    });
    const state = getHookState("sess-1");
    expect(state!.hasSubAgent).toBe(true);
  });

  test("SubagentStop clears hasSubAgent", () => {
    updateHookState("sess-1", "SubagentStart", {
      session_id: "sess-1",
    });
    updateHookState("sess-1", "SubagentStop", {
      session_id: "sess-1",
    });
    const state = getHookState("sess-1");
    expect(state!.hasSubAgent).toBe(false);
  });

  test("Notification with permission_prompt sets isWaitingForPermission", () => {
    updateHookState("sess-1", "Notification", {
      session_id: "sess-1",
      notification_type: "permission_prompt",
    });
    const state = getHookState("sess-1");
    expect(state!.isWaitingForPermission).toBe(true);
  });

  test("UserPromptSubmit clears isWaitingForPermission", () => {
    updateHookState("sess-1", "Notification", {
      session_id: "sess-1",
      notification_type: "permission_prompt",
    });
    updateHookState("sess-1", "UserPromptSubmit", {
      session_id: "sess-1",
    });
    const state = getHookState("sess-1");
    expect(state!.isWaitingForPermission).toBe(false);
  });

  test("Stop clears isToolRunning, activeToolName, and isWaitingForPermission", () => {
    updateHookState("sess-1", "PreToolUse", {
      session_id: "sess-1",
      tool_name: "Bash",
    });
    updateHookState("sess-1", "Notification", {
      session_id: "sess-1",
      notification_type: "permission_prompt",
    });
    updateHookState("sess-1", "Stop", { session_id: "sess-1" });
    const state = getHookState("sess-1");
    expect(state!.isToolRunning).toBe(false);
    expect(state!.activeToolName).toBeUndefined();
    expect(state!.isWaitingForPermission).toBe(false);
  });

  test("SessionStart resets all state", () => {
    updateHookState("sess-1", "PreToolUse", {
      session_id: "sess-1",
      tool_name: "Bash",
    });
    updateHookState("sess-1", "SubagentStart", {
      session_id: "sess-1",
    });
    updateHookState("sess-1", "SessionStart", {
      session_id: "sess-1",
    });
    const state = getHookState("sess-1");
    expect(state!.isToolRunning).toBe(false);
    expect(state!.hasSubAgent).toBe(false);
    expect(state!.isWaitingForPermission).toBe(false);
    expect(state!.isEnded).toBe(false);
  });

  test("SessionEnd sets isEnded", () => {
    updateHookState("sess-1", "SessionEnd", {
      session_id: "sess-1",
    });
    const state = getHookState("sess-1");
    expect(state!.isEnded).toBe(true);
  });

  test("lastEvent is always updated", () => {
    updateHookState("sess-1", "UserPromptSubmit", {
      session_id: "sess-1",
    });
    const state = getHookState("sess-1");
    expect(state!.lastEvent.event).toBe("UserPromptSubmit");
  });

  test("getHookState returns undefined for unknown session", () => {
    expect(getHookState("unknown")).toBeUndefined();
  });

  test("independent sessions do not interfere", () => {
    updateHookState("sess-1", "PreToolUse", {
      session_id: "sess-1",
      tool_name: "Bash",
    });
    updateHookState("sess-2", "SubagentStart", {
      session_id: "sess-2",
    });
    expect(getHookState("sess-1")!.isToolRunning).toBe(true);
    expect(getHookState("sess-1")!.hasSubAgent).toBe(false);
    expect(getHookState("sess-2")!.isToolRunning).toBe(false);
    expect(getHookState("sess-2")!.hasSubAgent).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun test src/hook-state.test.ts`
Expected: FAIL — module `./hook-state` not found

- [ ] **Step 3: Implement the hook state store**

```ts
// packages/server/src/hook-state.ts

export interface HookEvent {
  event: string;
  toolName?: string;
  timestamp: number;
}

export interface HookSessionState {
  sessionId: string;
  lastEvent: HookEvent;
  isToolRunning: boolean;
  activeToolName?: string;
  hasSubAgent: boolean;
  isWaitingForPermission: boolean;
  isEnded: boolean;
}

const hookStates = new Map<string, HookSessionState>();

function getOrCreate(sessionId: string): HookSessionState {
  let state = hookStates.get(sessionId);
  if (!state) {
    state = {
      sessionId,
      lastEvent: { event: "", timestamp: 0 },
      isToolRunning: false,
      hasSubAgent: false,
      isWaitingForPermission: false,
      isEnded: false,
    };
    hookStates.set(sessionId, state);
  }
  return state;
}

export function updateHookState(
  sessionId: string,
  event: string,
  payload: Record<string, any>
): void {
  const state = getOrCreate(sessionId);

  state.lastEvent = {
    event,
    toolName: payload.tool_name,
    timestamp: Date.now(),
  };

  switch (event) {
    case "PreToolUse":
      state.isToolRunning = true;
      state.activeToolName = payload.tool_name;
      break;

    case "PostToolUse":
    case "PostToolUseFailure":
      state.isToolRunning = false;
      state.activeToolName = undefined;
      break;

    case "Stop":
      state.isToolRunning = false;
      state.activeToolName = undefined;
      state.isWaitingForPermission = false;
      break;

    case "SubagentStart":
      state.hasSubAgent = true;
      break;

    case "SubagentStop":
      state.hasSubAgent = false;
      break;

    case "Notification":
      if (payload.notification_type === "permission_prompt") {
        state.isWaitingForPermission = true;
      }
      break;

    case "UserPromptSubmit":
      state.isWaitingForPermission = false;
      break;

    case "SessionStart":
      state.isToolRunning = false;
      state.activeToolName = undefined;
      state.hasSubAgent = false;
      state.isWaitingForPermission = false;
      state.isEnded = false;
      break;

    case "SessionEnd":
      state.isEnded = true;
      break;
  }
}

export function getHookState(sessionId: string): HookSessionState | undefined {
  return hookStates.get(sessionId);
}

export function clearHookState(): void {
  hookStates.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun test src/hook-state.test.ts`
Expected: All 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/hook-state.ts packages/server/src/hook-state.test.ts
git commit -m "feat: add hook state store for real-time session tracking"
```

---

### Task 2: Status Derivation with Hook State

**Files:**
- Modify: `packages/server/src/sessions.ts:23-65`
- Create: `packages/server/src/sessions.test.ts`

- [ ] **Step 1: Write failing tests for hook-aware deriveStatus**

```ts
// packages/server/src/sessions.test.ts
import { describe, test, expect } from "bun:test";
import { deriveStatus } from "./sessions";
import type { ProjectData } from "./projects";
import type { HookSessionState } from "./hook-state";

const emptyProjectData: ProjectData = {
  messageCount: 0,
  tokenUsage: 0,
};

function makeHookState(overrides: Partial<HookSessionState> = {}): HookSessionState {
  return {
    sessionId: "test",
    lastEvent: { event: "SessionStart", timestamp: Date.now() },
    isToolRunning: false,
    hasSubAgent: false,
    isWaitingForPermission: false,
    isEnded: false,
    ...overrides,
  };
}

describe("deriveStatus with hook state", () => {
  test("not alive always returns ended, even with hook state", () => {
    const hookState = makeHookState({ isToolRunning: true });
    expect(deriveStatus(false, emptyProjectData, hookState)).toBe("ended");
  });

  test("isWaitingForPermission returns waiting", () => {
    const hookState = makeHookState({ isWaitingForPermission: true });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("waiting");
  });

  test("isToolRunning returns working", () => {
    const hookState = makeHookState({ isToolRunning: true });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("working");
  });

  test("hasSubAgent returns waiting_on_agent", () => {
    const hookState = makeHookState({ hasSubAgent: true });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("waiting_on_agent");
  });

  test("UserPromptSubmit as lastEvent returns working", () => {
    const hookState = makeHookState({
      lastEvent: { event: "UserPromptSubmit", timestamp: Date.now() },
    });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("working");
  });

  test("Stop as lastEvent returns waiting", () => {
    const hookState = makeHookState({
      lastEvent: { event: "Stop", timestamp: Date.now() },
    });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("waiting");
  });

  test("isWaitingForPermission takes priority over isToolRunning", () => {
    const hookState = makeHookState({
      isWaitingForPermission: true,
      isToolRunning: true,
    });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("waiting");
  });

  test("isToolRunning takes priority over hasSubAgent", () => {
    const hookState = makeHookState({
      isToolRunning: true,
      hasSubAgent: true,
    });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("working");
  });
});

describe("deriveStatus without hook state (fallback)", () => {
  test("not alive returns ended", () => {
    expect(deriveStatus(false, emptyProjectData)).toBe("ended");
  });

  test("no conversation data returns waiting", () => {
    expect(deriveStatus(true, emptyProjectData)).toBe("waiting");
  });

  test("last message user returns working", () => {
    const pd: ProjectData = {
      ...emptyProjectData,
      lastMessageType: "user",
      lastActivityAt: Date.now(),
    };
    expect(deriveStatus(true, pd)).toBe("working");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun test src/sessions.test.ts`
Expected: FAIL — `deriveStatus` does not accept a third argument / wrong results

- [ ] **Step 3: Update deriveStatus to accept hookState parameter**

In `packages/server/src/sessions.ts`, replace the `deriveStatus` function (lines 23-65):

```ts
export function deriveStatus(
  alive: boolean,
  projectData: ProjectData,
  hookState?: HookSessionState
): SessionStatus {
  if (!alive) return "ended";

  // Hook state takes priority — no heuristics needed
  if (hookState && !hookState.isEnded) {
    if (hookState.isWaitingForPermission) return "waiting";
    if (hookState.isToolRunning) return "working";
    if (hookState.hasSubAgent) return "waiting_on_agent";

    switch (hookState.lastEvent.event) {
      case "UserPromptSubmit":
        return "working";
      case "Stop":
        return "waiting";
    }
  }

  // Fallback: existing JSONL-based heuristics
  const { lastMessageType, lastStopReason, lastActivityAt, hasAgentTool } = projectData;

  if (!lastMessageType) return "waiting";

  const timeSinceActivity = lastActivityAt
    ? Date.now() - lastActivityAt
    : Infinity;

  if (lastMessageType === "user") {
    return "working";
  }

  if (lastMessageType === "assistant" && lastStopReason === "tool_use") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) {
      if (hasAgentTool) return "waiting_on_agent";
      return "idle";
    }
    if (timeSinceActivity > TOOL_APPROVAL_THRESHOLD_MS) {
      if (hasAgentTool) return "waiting_on_agent";
      return "waiting";
    }
    return "working";
  }

  if (lastMessageType === "assistant" && lastStopReason === "end_turn") {
    if (timeSinceActivity > IDLE_THRESHOLD_MS) return "idle";
    return "waiting";
  }

  if (timeSinceActivity < IDLE_THRESHOLD_MS) return "waiting";
  return "idle";
}
```

Add the import at the top of `sessions.ts`:

```ts
import type { HookSessionState } from "./hook-state";
```

- [ ] **Step 4: Update readAllSessions to pass hook state and skip isSubAgentWaiting**

In `packages/server/src/sessions.ts`, in the `readAllSessions` function, replace lines 83-93:

```ts
      const projectData = await getProjectData(raw.cwd, raw.sessionId);

      const alive = isProcessAlive(raw.pid);
      const hookState = getHookState(raw.sessionId);
      let status = deriveStatus(alive, projectData, hookState);

      // Only do expensive sub-agent file scanning when we don't have hook state
      if (status === "waiting_on_agent" && !hookState) {
        const agentWaiting = await isSubAgentWaiting(raw.cwd, raw.sessionId);
        if (agentWaiting) status = "waiting";
      }
```

Add the import at the top of `sessions.ts`:

```ts
import { getHookState } from "./hook-state";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && bun test src/sessions.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 6: Run all tests**

Run: `cd packages/server && bun test`
Expected: All tests from both files PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/sessions.ts packages/server/src/sessions.test.ts
git commit -m "feat: hook-aware status derivation with JSONL fallback"
```

---

### Task 3: Export scheduleBroadcast from ws.ts

**Files:**
- Modify: `packages/server/src/ws.ts:34`

- [ ] **Step 1: Export the scheduleBroadcast function**

In `packages/server/src/ws.ts`, change line 34 from:

```ts
function scheduleBroadcast() {
```

to:

```ts
export function scheduleBroadcast() {
```

- [ ] **Step 2: Verify the server still compiles**

Run: `cd packages/server && bunx tsc --noEmit`
Expected: No errors (or same errors as before — this project may not have strict tsc set up)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws.ts
git commit -m "refactor: export scheduleBroadcast for use by hook endpoint"
```

---

### Task 4: HTTP Hook Endpoint

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add the hook route to app.ts**

In `packages/server/src/app.ts`, add these imports at the top:

```ts
import { updateHookState } from "./hook-state";
import { scheduleBroadcast } from "./ws";
```

Then add the route after the existing `app.post("/api/sessions/:id/refresh-pr", ...)` block (after line 67), before the static file serving:

```ts
  app.post("/api/hooks/:event", async (c) => {
    const event = c.req.param("event");
    let payload: Record<string, any>;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const sessionId = payload.session_id;
    if (!sessionId) return c.json({ error: "Missing session_id" }, 400);

    updateHookState(sessionId, event, payload);
    scheduleBroadcast();

    return c.json({ ok: true });
  });
```

- [ ] **Step 2: Verify the server still compiles**

Run: `cd packages/server && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manually test the endpoint**

Start the dev server in one terminal, then test with curl:

Run: `curl -s -X POST http://localhost:3001/api/hooks/PreToolUse -H 'Content-Type: application/json' -d '{"session_id":"test-123","tool_name":"Bash"}'`
Expected: `{"ok":true}`

Run: `curl -s -X POST http://localhost:3001/api/hooks/PreToolUse -H 'Content-Type: application/json' -d '{}'`
Expected: `{"error":"Missing session_id"}`

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat: add POST /api/hooks/:event endpoint for Claude Code hooks"
```

---

### Task 5: Plugin Manifest

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p plugin/.claude-plugin plugin/skills/setup-herdmode
```

- [ ] **Step 2: Write plugin.json**

```json
{
  "name": "herdmode",
  "description": "Real-time monitoring for Claude Code sessions"
}
```

Write to: `plugin/.claude-plugin/plugin.json`

- [ ] **Step 3: Commit**

```bash
git add plugin/.claude-plugin/plugin.json
git commit -m "feat: add herdmode plugin manifest"
```

---

### Task 6: Setup Skill

**Files:**
- Create: `plugin/skills/setup-herdmode/SKILL.md`

- [ ] **Step 1: Write the skill**

````markdown
---
name: setup-herdmode
description: Configure or remove Claude Code hooks that send real-time session events to the Herdmode monitoring server
---

# Setup Herdmode Hooks

You are configuring Claude Code hooks so that session events are sent to the Herdmode monitoring server via HTTP.

## Steps

1. Read `~/.claude/settings.json`. If the file does not exist, start with an empty JSON object `{}`.

2. Check if herdmode hooks are already configured by searching for any hook URL containing `localhost:3001/api/hooks` (or `localhost:13117/api/hooks`) in the `hooks` key.

3. **If hooks are already present**, ask the user:
   > "Herdmode hooks are already configured. Would you like to remove them?"
   - If yes: remove all hook entries whose URL contains `/api/hooks/` targeting the herdmode server. Preserve any other user-defined hooks under the same event keys. If an event key has no remaining hooks after removal, delete that event key. Write the file back and confirm removal.
   - If no: confirm no changes were made.

4. **If hooks are not present**, ask the user which port herdmode runs on. Default is 3001 for standalone, 13117 for the desktop app. Then merge the following hooks configuration into the existing `hooks` key, preserving any user-defined hooks already there:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/UserPromptSubmit" }]
    }],
    "PreToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/PreToolUse" }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/PostToolUse" }]
    }],
    "PostToolUseFailure": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/PostToolUseFailure" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/Stop" }]
    }],
    "SubagentStart": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/SubagentStart" }]
    }],
    "SubagentStop": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/SubagentStop" }]
    }],
    "Notification": [{
      "matcher": "permission_prompt",
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/Notification" }]
    }],
    "SessionStart": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/SessionStart" }]
    }],
    "SessionEnd": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/SessionEnd" }]
    }],
    "TaskCreated": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/TaskCreated" }]
    }],
    "TaskCompleted": [{
      "hooks": [{ "type": "http", "url": "http://localhost:PORT/api/hooks/TaskCompleted" }]
    }]
  }
}
```

Replace `PORT` with the user's chosen port number.

5. If an event key already exists in the user's settings (e.g., they have their own `PreToolUse` hooks), append the herdmode hook entry to the existing array for that event. Do not overwrite their hooks.

6. Write `~/.claude/settings.json` back with the merged result. Use 2-space indentation.

7. Confirm what was added:
   > "Herdmode hooks configured for localhost:PORT. Events: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStart, SubagentStop, Notification, SessionStart, SessionEnd, TaskCreated, TaskCompleted."
````

Write to: `plugin/skills/setup-herdmode/SKILL.md`

- [ ] **Step 2: Test the plugin loads**

Run: `claude --plugin-dir /home/krishass/dev/herdmode/plugin --print "list your available skills that mention herdmode"`
Expected: Output should mention `setup-herdmode`

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/setup-herdmode/SKILL.md
git commit -m "feat: add /setup-herdmode skill for configuring Claude Code hooks"
```

---

### Task 7: Integration Test

**Files:** None — this is a manual verification task.

- [ ] **Step 1: Start herdmode dev server**

Run: `cd /home/krishass/dev/herdmode && bun run dev:server`

- [ ] **Step 2: Simulate a session lifecycle with curl**

```bash
# Session starts
curl -s -X POST http://localhost:3001/api/hooks/SessionStart \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"integration-test","source":"startup"}'

# User submits prompt
curl -s -X POST http://localhost:3001/api/hooks/UserPromptSubmit \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"integration-test","prompt":"hello"}'

# Tool starts
curl -s -X POST http://localhost:3001/api/hooks/PreToolUse \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"integration-test","tool_name":"Bash","tool_input":{"command":"ls"}}'

# Tool finishes
curl -s -X POST http://localhost:3001/api/hooks/PostToolUse \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"integration-test","tool_name":"Bash"}'

# Claude stops
curl -s -X POST http://localhost:3001/api/hooks/Stop \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"integration-test"}'

# Session ends
curl -s -X POST http://localhost:3001/api/hooks/SessionEnd \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"integration-test"}'
```

Each should return `{"ok":true}`.

- [ ] **Step 3: Verify with the web UI**

Open `http://localhost:5173` and confirm sessions with hook state show accurate, instant status changes when hook events arrive.

- [ ] **Step 4: Run full test suite**

Run: `cd packages/server && bun test`
Expected: All tests pass

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: integration test fixups"
```
