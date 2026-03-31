import { useState, useEffect } from "react";
import type { Session, TimelineData, TimelineSegment } from "../types";

function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

interface Props {
  session: Session;
}

export function SessionTimeline({ session }: Props) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${session.sessionId}/timeline`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.segments) setTimeline(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session.sessionId, session.lastActivityAt]);

  if (!timeline || timeline.segments.length === 0) return null;

  const duration = timeline.sessionEnd - timeline.sessionStart;
  const hovered = hoveredIndex !== null ? timeline.segments[hoveredIndex] : null;

  return (
    <div className="detail-card timeline-card">
      <div className="detail-card-header">
        <h3>SESSION TIMELINE</h3>
        <span className="timeline-duration">{formatDuration(duration)}</span>
      </div>
      <div className="timeline-strip-container">
        <div className="timeline-markers">
          {timeline.segments.map((seg, i) => (
            <div key={`marker-${i}`} className="timeline-marker-slot">
              {seg.hasAgentSpawn && <div className="timeline-marker-agent" title="Sub-agent spawned" />}
            </div>
          ))}
        </div>
        <div className="timeline-strip">
          {timeline.segments.map((seg, i) => {
            const heightPct = seg.tokens > 0
              ? 40 + 60 * (seg.tokens / timeline.maxTokens)
              : seg.status === "idle" ? 20 : 40;

            return (
              <div
                key={i}
                className={`timeline-segment timeline-segment-${seg.status}`}
                style={{ height: `${heightPct}%` }}
                onMouseEnter={(e) => {
                  setHoveredIndex(i);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
                }}
                onMouseLeave={() => {
                  setHoveredIndex(null);
                  setTooltipPos(null);
                }}
              />
            );
          })}
        </div>
        <div className="timeline-markers timeline-markers-bottom">
          {timeline.segments.map((seg, i) => (
            <div key={`dot-${i}`} className="timeline-marker-slot">
              {seg.hasUserMessage && <div className="timeline-marker-user" title="User message" />}
            </div>
          ))}
        </div>
      </div>
      <div className="timeline-time-labels">
        <span>{formatTimeShort(timeline.sessionStart)}</span>
        <span>{formatTimeShort(timeline.sessionEnd)}</span>
      </div>
      {hovered && tooltipPos && (
        <div
          className="timeline-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="timeline-tooltip-time">
            {formatTimeShort(hovered.startTime)} – {formatTimeShort(hovered.endTime)}
          </div>
          <div className="timeline-tooltip-status">
            <span className={`status-indicator status-indicator-${hovered.status}`} />
            {hovered.status}
          </div>
          {hovered.tokens > 0 && (
            <div className="timeline-tooltip-tokens">{hovered.tokens.toLocaleString()} tokens</div>
          )}
          {hovered.hasAgentSpawn && (
            <div className="timeline-tooltip-agent">Sub-agent spawned</div>
          )}
        </div>
      )}
    </div>
  );
}
