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

  test("isEnded returns ended even when process is alive", () => {
    const hookState = makeHookState({ isEnded: true });
    expect(deriveStatus(true, emptyProjectData, hookState)).toBe("ended");
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
