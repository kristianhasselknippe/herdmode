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

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-title-row">
          <h2>{session.projectName}</h2>
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
        <div className="detail-meta">
          <span>
            Provider: <strong>{session.provider}</strong>
            {session.model && <> &middot; Model: <code>{session.model}</code></>}
          </span>
          <span>
            Path: <code>{session.cwd}</code>
          </span>
          <span>
            Session: <code>{session.sessionId.slice(0, 8)}</code>
            {session.pid && <> &middot; PID: <code>{session.pid}</code></>}
          </span>
          <span>
            Status: <strong>{session.status}</strong> &middot;{" "}
            {session.entrypoint} &middot; {session.kind}
            {session.gitBranch && <> &middot; {session.gitBranch}</>}
          </span>
          <span>
            {session.recentMessageCount} messages &middot;{" "}
            {formatTokens(session.tokenUsage)} tokens
          </span>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="section">
          <h3>Chat History</h3>
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

      {session.tasks.length > 0 && (
        <div className="section">
          <h3>Tasks</h3>
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

      <div className="section">
        <h3>Integrations</h3>
        <GitHubPR session={session} />
        <LinearStub />
        <NotionStub />
        <SlackStub />
      </div>
    </div>
  );
}
