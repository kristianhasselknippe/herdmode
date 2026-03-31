import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "../../server/src/app";
import { addClient, removeClient, startWatcher, stopWatcher } from "../../server/src/ws";

const PORT = 13117;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let httpServer: ReturnType<typeof serve> | null = null;

function getResourcePath(relativePath: string): string {
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

  const wss = new WebSocketServer({ server: server as any });
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

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
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
        isQuitting = true;
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
            isQuitting = true;
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

let isQuitting = false;

app.whenReady().then(() => {
  httpServer = startServer();
  createMenu();
  createTray();
  createWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopWatcher();
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});

app.on("window-all-closed", () => {
  // Don't quit on window close — tray keeps it alive
});

app.on("activate", () => {
  mainWindow?.show();
});
