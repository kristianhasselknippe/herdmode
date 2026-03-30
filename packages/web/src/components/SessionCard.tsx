import type { Session, SessionStatus } from "../types";

const STATUS_CONFIG: Record<SessionStatus, { label: string; className: string }> = {
  working: { label: "Working", className: "working" },
  waiting: { label: "Waiting", className: "waiting" },
  idle: { label: "Idle", className: "idle" },
  waiting_on_agent: { label: "Waiting on Agent", className: "waiting-on-agent" },
  ended: { label: "Ended", className: "ended" },
};

const PROVIDER_CONFIG: Record<string, { label: string; className: string }> = {
  claude: { label: "CC", className: "provider-claude" },
  opencode: { label: "OC", className: "provider-opencode" },
};

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
  const providerCfg = PROVIDER_CONFIG[session.provider] || PROVIDER_CONFIG.claude;

  return (
    <div
      className={`session-card status-${session.status} ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="session-card-header">
        <span className={`provider-badge ${providerCfg.className}`}>
          {providerCfg.label}
        </span>
        <h3>{session.projectName}</h3>
        <span className={`status-badge ${STATUS_CONFIG[session.status].className}`}>
          {STATUS_CONFIG[session.status].label}
        </span>
      </div>
      <div className="session-card-meta">
        <span>{timeAgo(session.startedAt)}</span>
        {session.model && (
          <span className="tag model-tag">{session.model}</span>
        )}
        {session.gitBranch && (
          <span className="tag">
            {session.pullRequest && (
              <span className={`ci-dot ${session.pullRequest.checksPassing === true ? "passing" : session.pullRequest.checksPassing === false ? "failing" : "pending"}`} />
            )}
            {session.gitBranch}
          </span>
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
