# Herdmode

A local PWA for monitoring your active Claude Code sessions. See what each agent is doing, get notified when one needs your attention, and jump to the right terminal with one click.

## Features

- **Live session dashboard** — see all Claude Code sessions with real-time status updates
- **Status detection** — distinguishes between Working, Waiting, Idle, and Ended sessions by reading conversation state
- **Browser notifications** — alerts you when a session starts waiting for input or goes idle
- **Focus terminal** — click a button to switch to the terminal running that session (Hyprland + common terminal emulators)
- **Session details** — task progress, message count, token usage, git branch
- **Integration stubs** — placeholder UI for GitHub, Linear, Notion/Obsidian, and Slack (not yet wired up)

## Tech Stack

Bun, Hono, React, Vite, TypeScript

## Setup

```bash
bun install
```

## Usage

```bash
# Start both server and frontend
bun run dev

# Or start them separately
bun run dev:server  # API + WebSocket on :3001
bun run dev:web     # Vite dev server on :5173
```

Open http://localhost:5173

## How It Works

The backend reads Claude Code's local data from `~/.claude/`:

- `~/.claude/sessions/*.json` — active session metadata
- `~/.claude/projects/{path}/{sessionId}.jsonl` — conversation history (used for status detection, git branch, token usage)
- `~/.claude/tasks/{sessionId}/*.json` — task progress

Changes are pushed to the frontend via WebSocket with a 2-second polling fallback.
