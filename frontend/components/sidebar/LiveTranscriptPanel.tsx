"use client";

import { useSessionStore } from "@/store/sessionStore";
import { stripSectionPrefix } from "@/lib/transcriptSections";

export default function LiveTranscriptPanel() {
  const conversationLog = useSessionStore((s) => s.conversationLog);
  const sessionPhase = useSessionStore((s) => s.sessionPhase);

  // Ensure turns are in sequence order, then take last 3-4
  const sorted = [...conversationLog].sort((a, b) => a.id - b.id);
  const recentTurns = sorted.slice(-4);

  const phaseLabel =
    sessionPhase === "conversation" ? "Conversation" : "Read Aloud";

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
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1.5px",
            color: "var(--text-muted)",
          }}
        >
          Live Transcript
        </div>
        <div
          style={{
            fontSize: "9px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--indigo)",
            background: "rgba(99,102,241,0.08)",
            padding: "2px 8px",
            borderRadius: "6px",
          }}
        >
          {phaseLabel}
        </div>
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
          {recentTurns.map((turn) => {
            const displayText =
              turn.role === "assistant"
                ? stripSectionPrefix(turn.text)
                : turn.text;

            return (
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
                  {displayText.length > 120
                    ? displayText.slice(0, 120) + "..."
                    : displayText}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
