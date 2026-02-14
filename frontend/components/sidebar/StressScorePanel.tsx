"use client";

import { useSessionStore } from "@/store/sessionStore";

function getBadgeConfig(value: number): {
  label: string;
  color: string;
  bg: string;
  fillColor: string;
} {
  if (value < 0.4) {
    return {
      label: "CALM",
      color: "var(--emerald)",
      bg: "var(--emerald-soft)",
      fillColor: "var(--emerald)",
    };
  }
  if (value <= 0.65) {
    return {
      label: "MODERATE",
      color: "#d97706",
      bg: "rgba(217,119,6,0.08)",
      fillColor: "#d97706",
    };
  }
  return {
    label: "ELEVATED",
    color: "var(--red)",
    bg: "var(--red-soft)",
    fillColor: "var(--red)",
  };
}

export default function StressScorePanel() {
  const stressScore = useSessionStore((s) => s.stressScore);

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
        Stress Estimate
      </div>

      {!stressScore ? (
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
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Badge */}
          {(() => {
            const cfg = getBadgeConfig(stressScore.value);
            return (
              <>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.8px",
                      color: cfg.color,
                      background: cfg.bg,
                      padding: "3px 10px",
                      borderRadius: "999px",
                    }}
                  >
                    {cfg.label}
                  </span>
                  <span
                    style={{
                      fontSize: "20px",
                      fontWeight: 700,
                      color: "var(--text)",
                      letterSpacing: "-0.5px",
                    }}
                  >
                    {Math.round(stressScore.value * 100)}%
                  </span>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    height: "8px",
                    borderRadius: "4px",
                    background: "var(--border-light)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: "4px",
                      background: cfg.fillColor,
                      width: `${stressScore.value * 100}%`,
                      transition: "width 0.8s ease",
                    }}
                  />
                </div>

                {/* Confidence */}
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                  }}
                >
                  {stressScore.confidence.toFixed(0)}% confidence
                </div>

                {/* Live estimate note */}
                {stressScore.isEstimate && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-dim)",
                      lineHeight: 1.5,
                    }}
                  >
                    Live estimate — final result after session
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
