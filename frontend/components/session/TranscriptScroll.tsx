"use client";

import { useEffect, useRef } from "react";
import { useSessionStore } from "@/store/sessionStore";
import { stripSectionPrefix } from "@/lib/transcriptSections";

export default function TranscriptScroll() {
  const conversationLog = useSessionStore((s) => s.conversationLog);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversationLog]);

  // Detect index where the phase switches from "conversation" to "read_aloud"
  const phaseSwitchIndex = conversationLog.findIndex(
    (t) => t.phase === "read_aloud",
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        borderRadius: "16px",
        border: "1px solid var(--border-light)",
        overflow: "hidden",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: "10px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1.5px",
          color: "var(--text-muted)",
          padding: "14px 32px 10px",
          borderBottom: "1px solid var(--border-light)",
          flexShrink: 0,
        }}
      >
        Conversation
      </div>

      {/* Scroll area */}
      <div
        ref={scrollRef}
        className="thin-scrollbar"
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          padding: "14px 32px 16px",
        }}
      >
        {conversationLog.length === 0 ? (
          <div
            style={{
              fontSize: "13px",
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "32px 0",
              fontStyle: "italic",
            }}
          >
            The conversation will appear here...
          </div>
        ) : (
          conversationLog.map((turn, idx) => {
            const displayText =
              turn.role === "assistant"
                ? stripSectionPrefix(turn.text)
                : turn.text;

            return (
              <div key={turn.id}>
                {/* Phase divider */}
                {idx === phaseSwitchIndex && phaseSwitchIndex > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      margin: "8px 0 18px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: "1px",
                        background: "var(--border-light)",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "1.5px",
                        color: "var(--indigo)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Read Aloud
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: "1px",
                        background: "var(--border-light)",
                      }}
                    />
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "flex-start",
                    fontSize: "13px",
                    lineHeight: 1.7,
                    padding: "8px 12px",
                    borderRadius: "10px",
                    background:
                      turn.role === "user"
                        ? "var(--blue-soft)"
                        : "var(--bg-white)",
                    border:
                      turn.role === "user"
                        ? "1px solid rgba(59,130,246,0.22)"
                        : "1px solid var(--border-light)",
                    boxShadow:
                      turn.role === "user"
                        ? "0 1px 3px rgba(59,130,246,0.08)"
                        : "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                      paddingTop: "3px",
                      minWidth: "44px",
                      flexShrink: 0,
                      color:
                        turn.role === "user"
                          ? "var(--blue)"
                          : "var(--indigo)",
                    }}
                  >
                    {turn.role === "user" ? "You" : "Santé"}
                  </span>

                  <span
                    style={{
                      color:
                        turn.role === "user"
                          ? "var(--text)"
                          : "var(--text-secondary)",
                      opacity: turn.status === "draft" ? 0.7 : 1,
                      transition: "opacity 0.2s ease",
                    }}
                  >
                    {displayText}
                    {turn.status === "draft" && (
                      <span
                        style={{
                          display: "inline-block",
                          width: "2px",
                          height: "13px",
                          background: "var(--indigo)",
                          marginLeft: "2px",
                          verticalAlign: "middle",
                          animation: "blink 1s ease-in-out infinite",
                        }}
                      />
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
