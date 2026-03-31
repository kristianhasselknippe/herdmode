import { useState, useEffect, useRef } from "react";
import type { Session, Task, ChatMessage } from "../types";
import { GitHubPR } from "./integrations/GitHubPR";
import { LinearStub } from "./integrations/LinearStub";
import { NotionStub } from "./integrations/NotionStub";
import { SlackStub } from "./integrations/SlackStub";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function taskIcon(status: Task["status"]): string {
  switch (status) {
    case "completed":
      return "\u2713";
    case "in_progress":
      return "\u25CB";
    case "pending":
      return "\u2022";
  }
}

interface Props {
  session: Session;
}

function focusSession(pid: number) {
  fetch(`/api/sessions/${pid}/focus`, { method: "POST" });
}

function formatTime(timestamp: string): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildBreadcrumb(cwd: string, projectName: string): string[] {
  const parts = cwd.split("/").filter(Boolean);
  // Take last 2 path segments before project name
  const relevant = parts.slice(-2);
  return ["PROJECTS", ...relevant.map((p) => p.toUpperCase()), projectName.toUpperCase()];
}

export function SessionDetail({ session }: Props) {
  const canFocus = session.isAlive && session.pid;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${session.sessionId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setMessages(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session.sessionId, session.lastActivityAt]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const breadcrumb = buildBreadcrumb(session.cwd, session.projectName);
  const completedTasks = session.tasks.filter((t) => t.status === "completed").length;
  const totalTasks = session.tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const statusLabel = session.status === "waiting_on_agent" ? "WAITING ON AGENT" : session.status.toUpperCase();

  return (
    <div className="detail-panel">
      {/* Breadcrumb */}
      <div className="detail-breadcrumb">
        {breadcrumb.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="breadcrumb-sep">&rsaquo;</span>}
            <span className={i === breadcrumb.length - 1 ? "breadcrumb-active" : ""}>{part}</span>
          </span>
        ))}
      </div>

      {/* Hero Header */}
      <div className="detail-hero">
        <div className="detail-hero-text">
          <h2 className="detail-title">{session.projectName}</h2>
          <div className="detail-subtitle">
            <span className={`status-indicator status-indicator-${session.status}`} />
            <span>{statusLabel}</span>
            <span className="subtitle-sep">&middot;</span>
            <span>{session.provider}</span>
            {session.model && (
              <>
                <span className="subtitle-sep">&middot;</span>
                <span>{session.model}</span>
              </>
            )}
            {session.gitBranch && (
              <>
                <span className="subtitle-sep">&middot;</span>
                <span>{session.gitBranch}</span>
              </>
            )}
            <span className="subtitle-sep">&middot;</span>
            <span>{session.recentMessageCount} messages</span>
            <span className="subtitle-sep">&middot;</span>
            <span>{formatTokens(session.tokenUsage)} tokens</span>
          </div>
        </div>
        <div className="detail-hero-actions">
          {canFocus && (
            <button
              className="focus-btn"
              onClick={() => focusSession(session.pid!)}
              title="Focus terminal window"
            >
              Focus Terminal
            </button>
          )}
        </div>
      </div>

      {/* Two-column body */}
      <div className="detail-columns">
        {/* Left column - Chat */}
        <div className="detail-col-main">
          {messages.length > 0 && (
            <div className="detail-card">
              <div className="detail-card-header">
                <h3>CHAT HISTORY</h3>
                <span className={`card-status-dot status-dot-${session.status}`} />
              </div>
              <div className="chat-history">
                {messages.map((msg, i) => (
                  <div key={i} className={`chat-message chat-${msg.role}`}>
                    <div className="chat-message-header">
                      <span className="chat-role">{msg.role === "user" ? "You" : "Assistant"}</span>
                      {msg.timestamp && <span className="chat-time">{formatTime(msg.timestamp)}</span>}
                    </div>
                    <div className="chat-message-text">{msg.text}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          {messages.length === 0 && (
            <div className="detail-card">
              <div className="detail-card-header">
                <h3>SESSION INFO</h3>
              </div>
              <div className="detail-meta">
                <span>Path: <code>{session.cwd}</code></span>
                <span>Session: <code>{session.sessionId.slice(0, 8)}</code>
                  {session.pid && <> &middot; PID: <code>{session.pid}</code></>}
                </span>
                <span>{session.entrypoint} &middot; {session.kind}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right column - Tasks, PR, Integrations */}
        <div className="detail-col-side">
          {totalTasks > 0 && (
            <div className="detail-card">
              <div className="detail-card-header">
                <h3>TASK PROGRESS</h3>
                <span className="card-progress-pct">{progress}%</span>
              </div>
              <div className="task-progress-bar">
                <div className="task-progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="task-list">
                {session.tasks.map((task) => (
                  <div key={task.id} className="task-item">
                    <span className={`task-icon ${task.status}`}>{taskIcon(task.status)}</span>
                    <span>{task.subject}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="detail-card">
            <div className="detail-card-header">
              <h3>INTEGRATIONS</h3>
            </div>
            <GitHubPR session={session} />
            <LinearStub />
            <NotionStub />
            <SlackStub />
          </div>
        </div>
      </div>
    </div>
  );
}
