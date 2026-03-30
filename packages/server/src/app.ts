import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { readAllSessions } from "./sessions";
import { focusSessionWindow } from "./focus";
import { forceRefreshPR } from "./github";

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

  app.post("/api/sessions/:id/refresh-pr", async (c) => {
    const id = c.req.param("id");
    const sessions = await readAllSessions();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return c.json({ error: "Not found" }, 404);
    if (!session.gitBranch) return c.json({ error: "No branch" }, 400);
    const pr = await forceRefreshPR(session.cwd, session.gitBranch);
    return c.json({ pullRequest: pr });
  });

  if (staticRoot) {
    app.use("/*", serveStatic({ root: staticRoot }));
  }

  return app;
}
