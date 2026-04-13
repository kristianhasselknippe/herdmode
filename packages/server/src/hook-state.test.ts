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
