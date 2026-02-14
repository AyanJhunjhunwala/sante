"use client";

import { useSessionStore } from "@/store/sessionStore";

export default function LiveTranscriptPanel() {
  const conversationLog = useSessionStore((s) => s.conversationLog);

  // Show last 3-4 turns
  const recentTurns = conversationLog.slice(-4);

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
          marginBottom: "10px",
        }}
      >
        Live Transcript
      </div>

      {recentTurns.length === 0 ? (
        <div
          style={{
            fontSize: "12px",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Waiting for speech...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {recentTurns.map((turn) => (
            <div
              key={turn.id}
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                  color: turn.role === "user" ? "var(--blue)" : "var(--indigo)",
                  paddingTop: "2px",
                  minWidth: "38px",
                  flexShrink: 0,
                }}
              >
                {turn.role === "user" ? "You" : "AI"}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                  opacity: turn.status === "draft" ? 0.7 : 1,
                }}
              >
                {turn.text.length > 120
                  ? turn.text.slice(0, 120) + "..."
                  : turn.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
