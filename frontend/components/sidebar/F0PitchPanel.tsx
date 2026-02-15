"use client";

import { useSessionStore } from "@/store/sessionStore";

const GRAPH_W = 280;
const GRAPH_H = 100;
const F0_MIN = 75;
const F0_MAX = 400;
const VISIBLE_WINDOW = 30; // seconds of history visible
const CURSOR_RATIO = 2 / 3; // latest point at 2/3 across

function f0ToY(f0: number): number {
  const clamped = Math.max(F0_MIN, Math.min(F0_MAX, f0));
  const ratio = (clamped - F0_MIN) / (F0_MAX - F0_MIN);
  return GRAPH_H - ratio * (GRAPH_H - 8) - 4;
}

export default function F0PitchPanel() {
  const pitchHistory = useSessionStore((s) => s.pitchHistory);

  const voiced = pitchHistory.filter((p) => p.f0 !== null);
  const latestF0 = voiced.length > 0 ? voiced[voiced.length - 1].f0 : null;

  // Sliding window: latest point at CURSOR_RATIO, older points scroll left
  let points: { x: number; y: number }[] = [];
  if (pitchHistory.length >= 1 && voiced.length >= 1) {
    const now = pitchHistory[pitchHistory.length - 1].time;
    const windowStart = now - VISIBLE_WINDOW;

    points = voiced
      .filter((p) => p.time >= windowStart)
      .map((p) => {
        const elapsed = p.time - now;
        const x = (CURSOR_RATIO + elapsed / VISIBLE_WINDOW) * GRAPH_W;
        return { x, y: f0ToY(p.f0!) };
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
          F0 Pitch
        </span>
        {latestF0 !== null && (
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--blue)",
              letterSpacing: "-0.3px",
            }}
          >
            {Math.round(latestF0)} Hz
          </span>
        )}
      </div>

      {pitchHistory.length === 0 ? (
        <div
          style={{
            fontSize: "13px",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Waiting for voice...
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
          width="100%"
          height={GRAPH_H}
          style={{ display: "block", overflow: "hidden" }}
        >
          {/* Grid lines */}
          {[100, 150, 200, 250, 300, 350].map((hz) => {
            const y = f0ToY(hz);
            return (
              <g key={hz}>
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
                  {hz}
                </text>
              </g>
            );
          })}

          {/* Pitch line */}
          {polyline && (
            <polyline
              points={polyline}
              fill="none"
              stroke="var(--blue)"
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
              fill="var(--blue)"
            />
          )}
        </svg>
      )}

      <div
        style={{
          fontSize: "11px",
          color: "var(--text-dim)",
          marginTop: "6px",
          lineHeight: 1.4,
        }}
      >
        {voiced.length > 0
          ? `${voiced.length} voiced sample${voiced.length !== 1 ? "s" : ""}`
          : "Fundamental frequency tracking"}
      </div>
    </div>
  );
}
