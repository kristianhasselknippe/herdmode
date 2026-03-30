# Herdmode Electron Desktop App

## Goal

Package Herdmode as an Electron desktop app with system tray, native menus, and distributable packaging (.AppImage, .deb). Running the app launches a window with the dashboard — no browser, no CLI, no external runtime dependencies.

## Architecture

```
packages/
  web/        — React frontend (unchanged, Vite builds static assets)
  server/     — Backend logic (ported to Node.js compat, used as a library)
  desktop/    — NEW: Electron shell (main process, tray, menus, packaging)
```

### Server Package Changes

The server currently uses `Bun.serve()` which is Bun-specific. Port to Node.js-compatible APIs so Electron's main process can run it directly.

**Replace:**
- `Bun.serve()` → `@hono/node-server` (`serve()` function)
- Bun's built-in WebSocket → `ws` library

**Keep unchanged:**
- All Hono routes and middleware (Hono is runtime-agnostic)
- Session/task/project reading logic (uses `node:fs`, already portable)
- File watcher logic in `ws.ts` (uses `node:fs.watch`, already portable)
- All types

**New exports:**
- `startServer(port: number): { close(): void }` — starts HTTP + WebSocket server, serves static files via Hono `serveStatic`, returns a handle to shut it down

The server package becomes a library consumed by both:
1. A standalone entry point (for dev/CLI use)
2. The Electron main process

### Web Package Changes

No code changes. The build output (`dist/`) is consumed by the server's static file serving.

**Build integration:**
- `vite build` outputs to `packages/web/dist/`
- The server's `serveStatic` middleware serves from this directory
- The Electron build step runs `vite build` first, then bundles the output

### Desktop Package (New)

**Main process (`main.ts`):**
1. Starts the server via `startServer(port)`
2. Creates a `BrowserWindow` loading `http://localhost:{port}`
3. Creates a system tray icon
4. Handles window lifecycle (close hides to tray, tray click shows window)
5. Cleans up server on app quit

**Tray:**
- Icon: `herdmode-logo.png` (resized to 16x16/22x22 for tray)
- Tooltip: "Herdmode"
- Left-click: toggle window visibility
- Right-click menu: "Show Window", "Quit"

**Native menu bar:**
- File > Quit
- View > Reload, Toggle DevTools
- Help > About

**Window behavior:**
- Single window, ~1200x800 default size
- Closing the window hides to tray instead of quitting
- App only quits via tray menu "Quit" or File > Quit

**Packaging (electron-builder):**
- Linux: `.AppImage` and `.deb`
- App name: "Herdmode"
- App icon: `herdmode-logo.png`
- macOS/Windows targets can be added later

### Dev Workflow

All existing dev workflows preserved:

| Command | What it does |
|---|---|
| `bun run dev:web` | Vite dev server with HMR + proxy to server |
| `bun run dev:server` | Server standalone (Node compat, still works under Bun) |
| `bun run dev:desktop` | Electron in dev mode, points at Vite dev server |
| `bun run build` | Builds web + packages Electron app |

### Dependencies

**packages/server (changes):**
- Add: `@hono/node-server`, `ws`, `@types/ws`
- Remove: Bun-specific APIs (just `Bun.serve()`)

**packages/desktop (new):**
- `electron` (dev dependency)
- `electron-builder` (dev dependency)
- Depends on `server` package (workspace dependency)

### What's NOT in scope

- Auto-start on login (easy to add later)
- Auto-update mechanism
- macOS/Windows packaging (Linux only for v1)
- In-app notifications (keeps using OS-level browser notifications via Electron's Notification API)
