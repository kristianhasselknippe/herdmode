import { Hono } from "hono";
import { cors } from "hono/cors";
import { readAllSessions } from "./sessions";
import { addClient, removeClient, startWatcher } from "./ws";

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

startWatcher();

Bun.serve({
  port: 3001,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      addClient(ws);
    },
    close(ws) {
      removeClient(ws);
    },
    message() {},
  },
});

console.log("Agent Tracker server running on http://localhost:3001");
