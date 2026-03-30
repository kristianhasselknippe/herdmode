import { useState, useEffect, useRef, useCallback } from "react";
import type { Session } from "../types";

export function useSessionSocket() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "sessions-updated") {
        setSessions(data.sessions);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 1000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {});

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return { sessions, connected };
}
