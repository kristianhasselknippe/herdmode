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
