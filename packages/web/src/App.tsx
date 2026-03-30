import { useState } from "react";
import { useSessionSocket } from "./hooks/useSessionSocket";
import { SessionList } from "./components/SessionList";
import { SessionDetail } from "./components/SessionDetail";
import type { Session } from "./types";

export default function App() {
  const { sessions, connected } = useSessionSocket();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null;
  const activeCount = sessions.filter((s) => s.isAlive).length;

  return (
    <div className="app">
      <header className="topbar">
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
        />
        {selectedSession ? (
          <SessionDetail session={selectedSession} />
        ) : (
          <div className="detail-placeholder">
            Select a session to view details
          </div>
        )}
      </main>
    </div>
  );
}
