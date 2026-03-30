import type { Session } from "../types";

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  session: Session;
  selected: boolean;
  onSelect: () => void;
}

export function SessionCard({ session, selected, onSelect }: Props) {
  const completedTasks = session.tasks.filter(
    (t) => t.status === "completed"
  ).length;
  const totalTasks = session.tasks.length;
  const progress = totalTasks > 0 ? completedTasks / totalTasks : 0;

  return (
    <div
      className={`session-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="session-card-header">
        <h3>{session.projectName}</h3>
        <span className={`status-badge ${session.isAlive ? "alive" : "ended"}`}>
          {session.isAlive ? "Active" : "Ended"}
        </span>
      </div>
      <div className="session-card-meta">
        <span>{timeAgo(session.startedAt)}</span>
        {session.gitBranch && (
          <span className="tag">{session.gitBranch}</span>
        )}
        <span>{session.recentMessageCount} messages</span>
        {totalTasks > 0 && (
          <span>
            {completedTasks}/{totalTasks} tasks
          </span>
        )}
      </div>
      {totalTasks > 0 && (
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
