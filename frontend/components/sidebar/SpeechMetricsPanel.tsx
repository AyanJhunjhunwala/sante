"use client";

import { useSessionStore } from "@/store/sessionStore";

function getPacingLabel(pacing: number): {
  label: string;
  color: string;
  bg: string;
} {
  if (pacing < 0.35) {
    return {
      label: "Slow",
      color: "#d97706",
      bg: "rgba(217,119,6,0.08)",
    };
  }
  if (pacing <= 0.65) {
    return {
      label: "Normal",
      color: "var(--blue)",
      bg: "var(--blue-soft)",
    };
  }
  return {
    label: "Fast",
    color: "var(--indigo)",
    bg: "var(--indigo-soft)",
  };
}

interface MetricRowProps {
  label: string;
  value: string;
  badge?: { label: string; color: string; bg: string };
}

function MetricRow({ label, value, badge }: MetricRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          {value}
        </span>
        {badge && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              padding: "2px 8px",
              borderRadius: "999px",
              color: badge.color,
              background: badge.bg,
            }}
          >
            {badge.label}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SpeechMetricsPanel() {
  const speechMetrics = useSessionStore((s) => s.speechMetrics);

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
          fontSize: "10px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1.5px",
          color: "var(--text-muted)",
          marginBottom: "12px",
        }}
      >
        Speech Metrics
      </div>

      {!speechMetrics ? (
        <div
          style={{
            fontSize: "13px",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Waiting for data...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <MetricRow
            label="Disfluencies"
            value={speechMetrics.disfluency.toFixed(2)}
          />
          <MetricRow
            label="Pacing"
            value={speechMetrics.pacing.toFixed(2)}
            badge={getPacingLabel(speechMetrics.pacing)}
          />
          {speechMetrics.wpm !== null && (
            <MetricRow label="WPM" value={speechMetrics.wpm.toString()} />
          )}
        </div>
      )}
    </div>
  );
}
