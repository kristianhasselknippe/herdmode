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
