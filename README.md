# Herdmode

A desktop app for monitoring your active Claude Code sessions. See what each agent is doing, get notified when one needs your attention, and jump to the right terminal with one click.

![Herdmode Logo](herdmode-logo.png)

## Features

- **Live session dashboard** — see all Claude Code sessions with real-time status updates
- **Status detection** — distinguishes between Working, Waiting, Idle, and Ended sessions by reading conversation state
- **Smart notifications** — debounced alerts when a session starts waiting for input, with deduplication to avoid spam
- **Tool approval detection** — shows "waiting" when an agent is blocked on tool approval, not "working"
- **Focus terminal** — click a button to switch to the terminal running that session (Hyprland + common terminal emulators)
- **Session details** — task progress, message count, token usage, git branch
- **System tray** — minimize to tray, click to restore
- **Integration stubs** — placeholder UI for GitHub, Linear, Notion/Obsidian, and Slack (not yet wired up)

## Tech Stack

Electron, Hono, React, Vite, TypeScript

## Setup

```bash
bun install
```

## Usage

### Desktop App (recommended)

```bash
# Dev mode — builds web frontend, bundles Electron, launches app
bun run dev:desktop

# Package for distribution (AppImage + .deb)
bun run build
```

Packaged artifacts are output to `packages/desktop/release/`.

### Web Development

```bash
# Start both server and frontend for web dev with HMR
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

## Project Structure

```
packages/
  web/        — React frontend (Vite + TypeScript)
  server/     — Backend logic (Hono, Node.js-compatible)
  desktop/    — Electron shell (tray, menus, packaging)
```
