import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { getAllSessions } from "./providers";
import { focusSessionWindow } from "./focus";
import { forceRefreshPR } from "./github";
import { getSessionMessages, getSessionTimeline } from "./projects";
import { getOpencodeMessages } from "./providers/opencode";
import { updateHookState } from "./hook-state";
import { scheduleBroadcast } from "./ws";

export function createApp(staticRoot?: string) {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/sessions", async (c) => {
    const sessions = await getAllSessions();
    return c.json(sessions);
  });

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  app.get("/api/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    const messages = session.provider === "opencode"
      ? await getOpencodeMessages(session.sessionId)
      : await getSessionMessages(session.cwd, session.sessionId);
    return c.json(messages);
  });

  app.get("/api/sessions/:id/timeline", async (c) => {
    const id = c.req.param("id");
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    if (session.provider === "opencode") {
      return c.json({ sessionStart: session.startedAt, sessionEnd: session.startedAt, maxTokens: 0, segments: [] });
    }
    const timeline = await getSessionTimeline(session.cwd, session.sessionId, session.startedAt);
    return c.json(timeline);
  });

  app.post("/api/sessions/:pid/focus", async (c) => {
    const pid = Number(c.req.param("pid"));
    if (isNaN(pid)) return c.json({ error: "Invalid PID" }, 400);
    const result = await focusSessionWindow(pid);
    if (result.ok) return c.json({ ok: true });
    return c.json({ error: result.error }, 500);
  });

  app.post("/api/sessions/:id/refresh-pr", async (c) => {
    const id = c.req.param("id");
    const sessions = await getAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    if (!session.gitBranch) return c.json({ error: "No branch" }, 400);
    const pr = await forceRefreshPR(session.cwd, session.gitBranch);
    return c.json({ pullRequest: pr });
  });

  app.post("/api/hooks/:event", async (c) => {
    const event = c.req.param("event");
    let payload: Record<string, any>;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const sessionId = payload.session_id;
    if (!sessionId) return c.json({ error: "Missing session_id" }, 400);

    updateHookState(sessionId, event, payload);
    scheduleBroadcast();

    return c.json({ ok: true });
  });

  if (staticRoot) {
    app.use("/*", serveStatic({ root: staticRoot }));
  }

  return app;
}
