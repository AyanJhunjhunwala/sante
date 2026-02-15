"use client";

import { useSessionStore } from "@/store/sessionStore";

const GRAPH_W = 280;
const GRAPH_H = 80;
const WPM_MAX = 220;
const VISIBLE_WINDOW = 30; // seconds of history visible on screen
const CURSOR_RATIO = 2 / 3; // latest point sits at 2/3 across the graph

function wpmToY(wpm: number): number {
  const clamped = Math.max(0, Math.min(WPM_MAX, wpm));
  const ratio = clamped / WPM_MAX;
  return GRAPH_H - ratio * (GRAPH_H - 8) - 4;
}

function getSpeedLabel(wpm: number): { label: string; color: string; bg: string } {
  if (wpm < 100) return { label: "Slow", color: "#d97706", bg: "rgba(217,119,6,0.08)" };
  if (wpm <= 160) return { label: "Normal", color: "var(--emerald)", bg: "var(--emerald-soft)" };
  return { label: "Fast", color: "var(--indigo)", bg: "var(--indigo-soft)" };
}

export default function WPMPanel() {
  const wpmHistory = useSessionStore((s) => s.wpmHistory);
  const totalWordCount = useSessionStore((s) => s.totalWordCount);

  const latestWPM = wpmHistory.length > 0 ? wpmHistory[wpmHistory.length - 1].wpm : null;
  const speedBadge = latestWPM !== null ? getSpeedLabel(latestWPM) : null;

  // Sliding window: latest point at CURSOR_RATIO across, older points scroll left
  let points: { x: number; y: number }[] = [];
  if (wpmHistory.length >= 1) {
    const now = wpmHistory[wpmHistory.length - 1].time;
    const windowStart = now - VISIBLE_WINDOW;

    points = wpmHistory
      .filter((p) => p.time >= windowStart)
      .map((p) => {
        // Map time so that `now` = CURSOR_RATIO * GRAPH_W
        // and `now - VISIBLE_WINDOW` = left edge (negative, clipped)
        const elapsed = p.time - now; // negative for past points
        const x = (CURSOR_RATIO + elapsed / VISIBLE_WINDOW) * GRAPH_W;
        return { x, y: wpmToY(p.wpm) };
      })
      .filter((p) => p.x >= 0);
  }

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div
      style={{
        background: "var(--bg-white)",
        border: "1px solid var(--border-light)",
        borderRadius: "16px",
        padding: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "10px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1.5px",
            color: "var(--text-muted)",
          }}
        >
          Words Per Minute
        </span>
        {latestWPM !== null && speedBadge && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--text)",
                letterSpacing: "-0.3px",
              }}
            >
              {latestWPM}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                padding: "2px 8px",
                borderRadius: "999px",
                color: speedBadge.color,
                background: speedBadge.bg,
              }}
            >
              {speedBadge.label}
            </span>
          </div>
        )}
      </div>

      {wpmHistory.length === 0 ? (
        <div
          style={{
            fontSize: "13px",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Waiting for speech...
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
          width="100%"
          height={GRAPH_H}
          style={{ display: "block", overflow: "hidden" }}
        >
          {/* Normal range band (100-160 WPM) */}
          <rect
            x={0}
            y={wpmToY(160)}
            width={GRAPH_W}
            height={wpmToY(100) - wpmToY(160)}
            fill="var(--emerald-soft)"
            opacity={0.4}
          />

          {/* Grid lines */}
          {[50, 100, 150, 200].map((wpm) => {
            const y = wpmToY(wpm);
            return (
              <g key={wpm}>
                <line
                  x1={0}
                  y1={y}
                  x2={GRAPH_W}
                  y2={y}
                  stroke="var(--border-light)"
                  strokeWidth={0.5}
                />
                <text
                  x={2}
                  y={y - 2}
                  fontSize={8}
                  fill="var(--text-dim)"
                  fontFamily="inherit"
                >
                  {wpm}
                </text>
              </g>
            );
          })}

          {/* WPM line */}
          {polyline && (
            <polyline
              points={polyline}
              fill="none"
              stroke="var(--indigo)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Latest dot */}
          {points.length > 0 && (
            <circle
              cx={points[points.length - 1].x}
              cy={points[points.length - 1].y}
              r={3}
              fill="var(--indigo)"
            />
          )}
        </svg>
      )}

      <div
        style={{
          fontSize: "11px",
          color: "var(--text-dim)",
          marginTop: "6px",
        }}
      >
        {totalWordCount > 0
          ? `${totalWordCount} word${totalWordCount !== 1 ? "s" : ""} spoken`
          : "Computed from live transcription"}
      </div>
    </div>
  );
}
