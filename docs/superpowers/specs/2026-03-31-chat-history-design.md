# Chat History in Session Detail

Show the latest conversation history (user prompts and assistant text responses) when a session is selected.

## Server

### New endpoint: `GET /api/sessions/:id/messages`

- Looks up the session by `sessionId` to find its `cwd`
- Encodes the cwd to build the JSONL path: `~/.claude/projects/{encodedCwd}/{sessionId}.jsonl`
- Reads and parses the JSONL file line by line
- Filters for entries with `type: "user"` or `type: "assistant"`
- For user messages: extracts string content, or joins text blocks from content arrays
- For assistant messages: joins only content blocks where `block.type === "text"`, skipping thinking and tool_use blocks
- Returns `ChatMessage[]` ordered chronologically

### New type: `ChatMessage`

Added to `types.ts` in both server and web packages:

```ts
interface ChatMessage {
  role: "user" | "assistant"
  text: string
  timestamp: string
}
```

### Implementation location

New function `getSessionMessages(sessionId: string, sessions: Session[]): ChatMessage[]` in `projects.ts` (where JSONL parsing already lives). New route registered in `app.ts`.

## Web

### Data fetching

In `SessionDetail`, fetch `/api/sessions/${session.sessionId}/messages` when:
1. The selected session changes (new sessionId)
2. The selected session's `lastActivityAt` changes (new activity detected via WebSocket)

Use a simple `useEffect` + `fetch`. Store messages in local state.

### UI

- Scrollable chat panel in SessionDetail, below the activity summary section
- User messages and assistant messages visually distinguished (different background colors)
- Auto-scroll to bottom on load and when new messages arrive
- Timestamps shown per message
- Empty state when no messages yet

## Scope boundaries

- No pagination — JSONL files are typically manageable
- No tool usage, thinking blocks, or progress events
- No streaming — fetch full history on selection, re-fetch on updates
- No caching on the frontend beyond React state
