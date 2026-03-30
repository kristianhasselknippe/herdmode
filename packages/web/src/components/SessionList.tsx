import type { Session } from "../types";
import { SessionCard } from "./SessionCard";

interface Props {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  width: number;
}

export function SessionList({ sessions, selectedId, onSelect, width }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="session-list" style={{ width, minWidth: width }}>
        <div className="detail-placeholder">No sessions found</div>
      </div>
    );
  }

  return (
    <div className="session-list" style={{ width, minWidth: width }}>
      {sessions.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          selected={session.sessionId === selectedId}
          onSelect={() => onSelect(session.sessionId)}
        />
      ))}
    </div>
  );
}
