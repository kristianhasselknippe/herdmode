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
