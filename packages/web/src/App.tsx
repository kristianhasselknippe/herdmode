import { useState, useRef, useCallback } from "react";
import { useSessionSocket } from "./hooks/useSessionSocket";
import { SessionList } from "./components/SessionList";
import { SessionDetail } from "./components/SessionDetail";
import type { Session } from "./types";

export default function App() {
  const { sessions, connected } = useSessionSocket();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const dragging = useRef(false);

  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null;
  const activeCount = sessions.filter((s) => s.isAlive).length;

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.max(280, Math.min(e.clientX, 700));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <img src="/herdmode-logo.png" alt="Herdmode" className="topbar-logo" />
        <h1>Herdmode</h1>
        <div className="topbar-right">
          <span className="badge">{activeCount} active</span>
          <span className={`connection-dot ${connected ? "connected" : ""}`} />
        </div>
      </header>
      <main className="layout">
        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          width={sidebarWidth}
        />
        <div className="resize-handle" onMouseDown={onMouseDown} />
        {selectedSession ? (
          <SessionDetail session={selectedSession} />
        ) : (
          <div className="detail-placeholder">
            Click a session on the left to see what it's up to
          </div>
        )}
      </main>
    </div>
  );
}
