# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Herdmode as an Electron desktop app with system tray, native menus, and .AppImage/.deb packaging.

**Architecture:** Port the server from Bun-specific APIs to Node.js-compatible ones (`@hono/node-server` + `ws`), then wrap it in an Electron shell that starts the server in-process, opens a BrowserWindow, and manages a system tray. The web frontend builds via Vite into static files served by the server.

**Tech Stack:** Electron, @hono/node-server, ws, electron-builder, Vite (existing), Hono (existing), React (existing)

---

## File Map

```
packages/
  server/
    src/
      index.ts          — MODIFY: replace Bun.serve with startServer() export
      ws.ts             — MODIFY: replace Bun WebSocket types with ws library
      focus.ts          — MODIFY: replace Bun shell ($) with child_process
      app.ts            — CREATE: Hono app factory (extracted from index.ts)
      sessions.ts       — no changes
      tasks.ts          — no changes
      projects.ts       — no changes
      types.ts          — no changes
    package.json        — MODIFY: add @hono/node-server, ws deps; remove bun-types
    tsconfig.json       — MODIFY: remove bun-types
  web/
    vite.config.ts      — MODIFY: add build.outDir pointing to ../server/static
    (everything else unchanged)
  desktop/              — CREATE: entire package
    src/
      main.ts           — CREATE: Electron main process
      preload.ts        — CREATE: empty preload script
    assets/
      icon.png          — CREATE: copy of herdmode-logo.png
      tray-icon.png     — CREATE: 22x22 version for tray
    package.json        — CREATE
    tsconfig.json       — CREATE
    electron-builder.yml — CREATE
package.json            — MODIFY: add build/desktop scripts
```

---

### Task 1: Extract Hono App Into Shared Module

Extract the Hono route definitions out of `index.ts` into a standalone `app.ts` so both the standalone server entry point and the Electron main process can import it.

**Files:**
- Create: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Create `app.ts` with the Hono app**

Create `packages/server/src/app.ts`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { readAllSessions } from "./sessions";
import { focusSessionWindow } from "./focus";

export function createApp(staticRoot?: string) {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/sessions", async (c) => {
    const sessions = await readAllSessions();
    return c.json(sessions);
  });

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const sessions = await readAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  app.post("/api/sessions/:pid/focus", async (c) => {
    const pid = Number(c.req.param("pid"));
    if (isNaN(pid)) return c.json({ error: "Invalid PID" }, 400);
    const result = await focusSessionWindow(pid);
    if (result.ok) return c.json({ ok: true });
    return c.json({ error: result.error }, 500);
  });

  if (staticRoot) {
    app.use("/*", serveStatic({ root: staticRoot }));
  }

  return app;
}
```

- [ ] **Step 2: Rewrite `index.ts` to use `createApp`**

Replace the entire contents of `packages/server/src/index.ts` with:

```typescript
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "./app";
import { addClient, removeClient, startWatcher } from "./ws";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

const PORT = Number(process.env.PORT) || 3001;

// Serve static files from ../web/dist if it exists (production), otherwise no static serving
const staticDir = join(dirname(dirname(__dirname)), "web", "dist");
const staticRoot = existsSync(staticDir) ? staticDir : undefined;

const app = createApp(staticRoot);

const server = serve({ fetch: app.fetch, port: PORT });

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  addClient(ws);
  ws.on("close", () => removeClient(ws));
});

startWatcher();

console.log(`Herdmode server running on http://localhost:${PORT}`);

export { server };
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/index.ts
git commit -m "refactor(server): extract Hono app into shared module"
```

---

### Task 2: Port WebSocket Module From Bun to ws

Replace the `ServerWebSocket<unknown>` Bun type with the `ws` library's `WebSocket` type.

**Files:**
- Modify: `packages/server/src/ws.ts`

- [ ] **Step 1: Rewrite `ws.ts` to use the `ws` library types**

Replace the entire contents of `packages/server/src/ws.ts` with:

```typescript
import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WebSocket } from "ws";
import { readAllSessions } from "./sessions";

const CLAUDE_DIR = join(homedir(), ".claude");
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
}

export function removeClient(ws: WebSocket) {
  clients.delete(ws);
}

let lastSnapshot = "";

async function broadcast() {
  if (clients.size === 0) return;
  const sessions = await readAllSessions();
  const message = JSON.stringify({ type: "sessions-updated", sessions });
  if (message === lastSnapshot) return;
  lastSnapshot = message;
  for (const ws of clients) {
    ws.send(message);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBroadcast() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(broadcast, 200);
}

function watchDir(dir: string, label: string) {
  try {
    watch(dir, { recursive: false }, scheduleBroadcast);
    console.log(`Watching ${label}: ${dir}`);
  } catch {
    // Directory may not exist yet
  }
}

async function watchProjectSubdirs() {
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      watchDir(join(PROJECTS_DIR, dir), `project/${dir}`);
    }
  } catch {
    // projects dir may not exist
  }
}

async function watchTaskSubdirs() {
  try {
    const dirs = await readdir(TASKS_DIR);
    for (const dir of dirs) {
      watchDir(join(TASKS_DIR, dir), `tasks/${dir}`);
    }
  } catch {
    // tasks dir may not exist
  }
}

export function startWatcher() {
  watchDir(SESSIONS_DIR, "sessions");
  watchProjectSubdirs();
  watchTaskSubdirs();
  setInterval(broadcast, 2000);
  console.log("File watchers started + 2s polling fallback");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws.ts
git commit -m "refactor(server): port WebSocket module from Bun to ws"
```

---

### Task 3: Port Focus Module From Bun Shell to child_process

Replace `Bun.$` shell template literals with `child_process.execFile`.

**Files:**
- Modify: `packages/server/src/focus.ts`

- [ ] **Step 1: Rewrite `focus.ts` to use `child_process`**

Replace the entire contents of `packages/server/src/focus.ts` with:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TERMINAL_NAMES = new Set([
  "alacritty",
  "kitty",
  "wezterm",
  "wezterm-gui",
  "foot",
  "gnome-terminal-server",
  "konsole",
  "xterm",
  "tilix",
  "terminator",
]);

async function findTerminalPid(pid: number): Promise<number | null> {
  let current = pid;
  while (current > 1) {
    try {
      const { stdout: comm } = await execFileAsync("ps", ["-o", "comm=", "-p", String(current)]);
      if (TERMINAL_NAMES.has(comm.trim())) return current;
      const { stdout: ppid } = await execFileAsync("ps", ["-o", "ppid=", "-p", String(current)]);
      current = Number(ppid.trim());
      if (isNaN(current)) return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function focusSessionWindow(
  pid: number
): Promise<{ ok: boolean; error?: string }> {
  const terminalPid = await findTerminalPid(pid);
  if (!terminalPid) {
    return { ok: false, error: "Could not find terminal window for this session" };
  }

  try {
    const { stdout: clientsJson } = await execFileAsync("hyprctl", ["clients", "-j"]);
    const clients = JSON.parse(clientsJson.trim()) as Array<{
      pid: number;
      address: string;
      workspace: { id: number };
    }>;

    const window = clients.find((c) => c.pid === terminalPid);
    if (!window) {
      return { ok: false, error: `Terminal PID ${terminalPid} not found in Hyprland clients` };
    }

    await execFileAsync("hyprctl", ["dispatch", "focuswindow", `pid:${terminalPid}`]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/focus.ts
git commit -m "refactor(server): port focus module from Bun shell to child_process"
```

---

### Task 4: Update Server Package Dependencies and Config

Swap out Bun-specific dependencies for Node.js-compatible ones.

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/tsconfig.json`

- [ ] **Step 1: Update `packages/server/package.json`**

Replace the entire contents with:

```json
{
  "name": "server",
  "private": true,
  "scripts": {
    "dev": "npx tsx --watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "hono": "^4",
    "@hono/node-server": "^1",
    "ws": "^8"
  },
  "devDependencies": {
    "@types/ws": "^8",
    "typescript": "^5",
    "tsx": "^4"
  }
}
```

- [ ] **Step 2: Update `packages/server/tsconfig.json`**

Replace the entire contents with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

Run from the repository root:

```bash
bun install
```

- [ ] **Step 4: Verify the server starts**

```bash
cd packages/server && npx tsx src/index.ts
```

Expected: `Herdmode server running on http://localhost:3001` and `File watchers started + 2s polling fallback`. Kill with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json packages/server/tsconfig.json bun.lock
git commit -m "chore(server): swap Bun deps for Node.js-compatible ones"
```

---

### Task 5: Configure Vite to Build Into Server Static Directory

Point Vite's build output to a location the server can serve.

**Files:**
- Modify: `packages/web/vite.config.ts`

- [ ] **Step 1: Update `packages/web/vite.config.ts`**

Replace the entire contents with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../web/dist",
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 2: Build the web frontend**

```bash
cd packages/web && npx vite build
```

Expected: build succeeds, output files appear in `packages/web/dist/`.

- [ ] **Step 3: Verify the server serves static files**

Start the server and open `http://localhost:3001` in a browser. The dashboard should load and function (WebSocket connection, session list, etc.).

```bash
cd packages/server && npx tsx src/index.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/vite.config.ts
git commit -m "chore(web): configure Vite build output for static serving"
```

---

### Task 6: Create Electron Desktop Package — Scaffold

Set up the `packages/desktop` package with config files and assets.

**Files:**
- Create: `packages/desktop/package.json`
- Create: `packages/desktop/tsconfig.json`
- Create: `packages/desktop/electron-builder.yml`
- Create: `packages/desktop/assets/icon.png` (copy from repo root)
- Create: `packages/desktop/assets/tray-icon.png` (generate 22x22)

- [ ] **Step 1: Create `packages/desktop/package.json`**

```json
{
  "name": "herdmode",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "dev": "electron dist/main.js",
    "build:ts": "tsc",
    "build:web": "cd ../web && npx vite build",
    "build": "npm run build:web && npm run build:ts",
    "dist": "npm run build && electron-builder",
    "start": "electron ."
  },
  "dependencies": {
    "hono": "^4",
    "@hono/node-server": "^1",
    "ws": "^8"
  },
  "devDependencies": {
    "electron": "^35",
    "electron-builder": "^26",
    "@types/ws": "^8",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create `packages/desktop/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/desktop/electron-builder.yml`**

```yaml
appId: com.herdmode.app
productName: Herdmode
directories:
  output: release
files:
  - dist/**/*
  - node_modules/**/*
extraResources:
  - from: ../web/dist
    to: web
    filter:
      - "**/*"
  - from: assets/tray-icon.png
    to: assets/tray-icon.png
linux:
  target:
    - AppImage
    - deb
  icon: assets/icon.png
  category: Development
```

- [ ] **Step 4: Copy logo assets**

```bash
mkdir -p packages/desktop/assets
cp herdmode-logo.png packages/desktop/assets/icon.png
convert herdmode-logo.png -resize 22x22 packages/desktop/assets/tray-icon.png 2>/dev/null || cp herdmode-logo.png packages/desktop/assets/tray-icon.png
```

(Uses ImageMagick `convert` if available, otherwise just copies the full-size image — Electron will scale it.)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/
git commit -m "feat(desktop): scaffold Electron package with config and assets"
```

---

### Task 7: Create Electron Main Process

Write the Electron main process that starts the embedded server, opens a window, and manages the system tray.

**Files:**
- Create: `packages/desktop/src/main.ts`
- Create: `packages/desktop/src/preload.ts`

- [ ] **Step 1: Create `packages/desktop/src/preload.ts`**

```typescript
// Empty preload — placeholder for future IPC if needed
```

- [ ] **Step 2: Create `packages/desktop/src/main.ts`**

```typescript
import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "../../server/src/app";
import { addClient, removeClient, startWatcher } from "../../server/src/ws";

const PORT = 13117;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function getResourcePath(relativePath: string): string {
  // In packaged app, resources are in process.resourcesPath
  // In dev, resolve relative to this file
  if (app.isPackaged) {
    return join(process.resourcesPath, relativePath);
  }
  return join(__dirname, "..", relativePath);
}

function startServer() {
  const webRoot = app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(__dirname, "..", "..", "web", "dist");

  const honoApp = createApp(webRoot);
  const server = serve({ fetch: honoApp.fetch, port: PORT });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    addClient(ws);
    ws.on("close", () => removeClient(ws));
  });

  startWatcher();
  console.log(`Herdmode server running on http://localhost:${PORT}`);
  return server;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: "Herdmode",
    icon: getResourcePath("assets/icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Hide to tray instead of quitting
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(
    getResourcePath("assets/tray-icon.png")
  );
  tray = new Tray(trayIcon.resize({ width: 22, height: 22 }));
  tray.setToolTip("Herdmode");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About Herdmode",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox({
              type: "info",
              title: "About Herdmode",
              message: "Herdmode",
              detail: "Wrangle your Claude Code agents.\nVersion 0.1.0",
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Extend the App type to track quitting state
declare module "electron" {
  interface App {
    isQuitting: boolean;
  }
}

app.isQuitting = false;

app.whenReady().then(() => {
  startServer();
  createMenu();
  createTray();
  createWindow();
});

app.on("window-all-closed", () => {
  // Don't quit on window close — tray keeps it alive
});

app.on("activate", () => {
  mainWindow?.show();
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/
git commit -m "feat(desktop): add Electron main process with tray and menus"
```

---

### Task 8: Update Root Package Scripts and Install

Add build/dev scripts to the root `package.json` and install all dependencies.

**Files:**
- Modify: `packages/web/package.json` (add `--outDir` to build script for clarity)
- Modify: root `package.json`

- [ ] **Step 1: Update root `package.json`**

Replace the entire contents of the root `package.json` with:

```json
{
  "name": "herdmode",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:server": "bun run --filter server dev",
    "dev:web": "bun run --filter web dev",
    "dev:desktop": "cd packages/web && npx vite build && cd ../desktop && npm run build:ts && npm run dev",
    "build": "cd packages/desktop && npm run dist"
  }
}
```

- [ ] **Step 2: Install all dependencies**

```bash
bun install
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add desktop build and dev scripts"
```

---

### Task 9: Build and Test the Electron App

Compile TypeScript, build the web frontend, and launch the Electron app to verify everything works.

**Files:** No new files — this is a verification task.

- [ ] **Step 1: Build the web frontend**

```bash
cd packages/web && npx vite build
```

Expected: build succeeds, `packages/web/dist/` contains `index.html` and asset files.

- [ ] **Step 2: Compile the desktop TypeScript**

```bash
cd packages/desktop && npx tsc
```

Expected: compiles without errors, `packages/desktop/dist/main.js` and `packages/desktop/dist/preload.js` are created.

- [ ] **Step 3: Launch the Electron app in dev mode**

```bash
cd packages/desktop && npx electron dist/main.js
```

Expected:
- Console prints `Herdmode server running on http://localhost:13117`
- A window opens showing the Herdmode dashboard
- System tray icon appears
- Closing the window hides to tray (app doesn't quit)
- Right-clicking tray shows "Show Window" and "Quit"
- "Quit" exits the app

- [ ] **Step 4: Fix any issues found during testing**

If the `serveStatic` middleware path resolution is wrong, adjust the `webRoot` path in `main.ts`. The `@hono/node-server` `serveStatic` expects a `root` relative to `process.cwd()` — if that's an issue, switch to serving from an absolute path or adjust `cwd` before starting the server.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(desktop): resolve build/runtime issues from integration testing"
```

---

### Task 10: Package the Electron App With electron-builder

Build distributable `.AppImage` and `.deb` packages.

**Files:** No source changes — build/packaging step.

- [ ] **Step 1: Run electron-builder**

```bash
cd packages/desktop && npx electron-builder --linux
```

Expected: output in `packages/desktop/release/` containing:
- `Herdmode-0.1.0.AppImage`
- `herdmode_0.1.0_amd64.deb`

- [ ] **Step 2: Test the AppImage**

```bash
chmod +x packages/desktop/release/Herdmode-0.1.0.AppImage
./packages/desktop/release/Herdmode-0.1.0.AppImage
```

Expected: app launches, dashboard works, tray icon appears.

- [ ] **Step 3: Update `.gitignore` for build artifacts**

Add to the root `.gitignore`:

```
packages/desktop/dist/
packages/desktop/release/
packages/web/dist/
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add desktop build artifacts to gitignore"
```
