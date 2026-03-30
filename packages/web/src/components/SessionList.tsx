import { useState } from "react";
import type { Session } from "../types";
import { SessionCard } from "./SessionCard";

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  width: number;
}

type Tab = "active" | "history";

export function SessionList({ sessions, selectedId, onSelect, width }: Props) {
  const [tab, setTab] = useState<Tab>("active");

  const activeSessions = sessions.filter((s) => s.status !== "ended");
  const historySessions = sessions.filter((s) => s.status === "ended");

  const displayed = tab === "active" ? activeSessions : historySessions;

  return (
    <div className="session-list" style={{ width, minWidth: width }}>
      <div className="session-tabs">
        <button
          className={`session-tab ${tab === "active" ? "active" : ""}`}
          onClick={() => setTab("active")}
        >
          Active ({activeSessions.length})
        </button>
        <button
          className={`session-tab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}
        >
          History ({historySessions.length})
        </button>
      </div>
      {displayed.length === 0 ? (
        <div className="detail-placeholder">
          {tab === "active" ? "No active sessions" : "No ended sessions"}
        </div>
      ) : (
        displayed.map((session) => (
          <SessionCard
            key={session.sessionId}
            session={session}
            selected={session.sessionId === selectedId}
            onSelect={() => onSelect(session.sessionId)}
          />
        ))
      )}
    </div>
  );
}
