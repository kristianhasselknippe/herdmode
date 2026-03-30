import { useState, useEffect, useRef, useCallback } from "react";
import type { Session, SessionStatus } from "../types";

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/herdmode-logo.png" });
  }
}

const ALERT_TRANSITIONS: Record<string, (session: Session) => string | null> = {
  waiting: (s) => `${s.projectName} is waiting for your input`,
  idle: (s) => `${s.projectName} has gone idle`,
};

// Delay before firing a notification, so rapid status flickers
// (e.g. working→waiting→working between tool calls) don't spam.
const NOTIFY_DELAY_MS = 5_000;

export function useSessionSocket() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const prevStatusMap = useRef<Map<string, SessionStatus>>(new Map());
  const pendingNotifications = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastNotifiedStatus = useRef<Map<string, SessionStatus>>(new Map());

  const checkTransitions = useCallback((newSessions: Session[]) => {
    const prev = prevStatusMap.current;

    for (const session of newSessions) {
      const oldStatus = prev.get(session.sessionId);
      if (oldStatus && oldStatus !== session.status) {
        // Session went back to working — cancel any pending notification
        if (session.status === "working") {
          const pending = pendingNotifications.current.get(session.sessionId);
          if (pending) {
            clearTimeout(pending);
            pendingNotifications.current.delete(session.sessionId);
          }
          lastNotifiedStatus.current.delete(session.sessionId);
          prev.set(session.sessionId, session.status);
          continue;
        }

        const getMessage = ALERT_TRANSITIONS[session.status];
        if (getMessage) {
          // Skip idle if we already notified waiting for this work cycle
          if (session.status === "idle" && lastNotifiedStatus.current.get(session.sessionId) === "waiting") {
            prev.set(session.sessionId, session.status);
            continue;
          }

          // Cancel any existing pending notification for this session
          const existing = pendingNotifications.current.get(session.sessionId);
          if (existing) clearTimeout(existing);

          // Schedule notification after delay — if the status sticks, it fires
          const sid = session.sessionId;
          const status = session.status;
          const body = getMessage(session);
          if (body) {
            pendingNotifications.current.set(
              sid,
              setTimeout(() => {
                pendingNotifications.current.delete(sid);
                lastNotifiedStatus.current.set(sid, status);
                notify("Herdmode", body);
              }, NOTIFY_DELAY_MS)
            );
          }
        }
      }
    }

    const next = new Map<string, SessionStatus>();
    for (const s of newSessions) {
      next.set(s.sessionId, s.status);
    }
    prevStatusMap.current = next;
  }, []);

  const handleUpdate = useCallback(
    (newSessions: Session[]) => {
      checkTransitions(newSessions);
      setSessions(newSessions);
    },
    [checkTransitions]
  );

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "sessions-updated") {
        handleUpdate(data.sessions);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 1000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, [handleUpdate]);

  useEffect(() => {
    requestNotificationPermission();

    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: Session[]) => {
        // Initialize status map without alerting on first load
        const initial = new Map<string, SessionStatus>();
        for (const s of data) {
          initial.set(s.sessionId, s.status);
        }
        prevStatusMap.current = initial;
        setSessions(data);
      })
      .catch(() => {});

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return { sessions, connected };
}
