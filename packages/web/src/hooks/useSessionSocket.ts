import { useState, useEffect, useRef, useCallback } from "react";
import type { Session, SessionStatus } from "../types";

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/manifest.json" });
  }
}

const ALERT_TRANSITIONS: Record<string, (session: Session) => string | null> = {
  waiting: (s) => `${s.projectName} is waiting for your input`,
  idle: (s) => `${s.projectName} has gone idle`,
};

export function useSessionSocket() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const prevStatusMap = useRef<Map<string, SessionStatus>>(new Map());

  const checkTransitions = useCallback((newSessions: Session[]) => {
    const prev = prevStatusMap.current;

    for (const session of newSessions) {
      const oldStatus = prev.get(session.sessionId);
      if (oldStatus && oldStatus !== session.status) {
        const getMessage = ALERT_TRANSITIONS[session.status];
        if (getMessage) {
          const body = getMessage(session);
          if (body) notify("Herdmode", body);
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
