"use client";

import { useSessionStore } from "@/store/sessionStore";
import type { PhonemeToken } from "@/lib/types";

function getChipStyle(dysLabel: string): {
  color: string;
  background: string;
  border?: string;
} {
  switch (dysLabel) {
    case "normal":
      return {
        color: "var(--text-secondary)",
        background: "var(--bg-white)",
        border: "1px solid var(--border-light)",
      };
    case "repetition":
      return {
        color: "#d97706",
        background: "rgba(217,119,6,0.1)",
      };
    case "prolongation":
      return {
        color: "#ea580c",
        background: "rgba(234,88,12,0.1)",
      };
    default:
      return {
        color: "#dc2626",
        background: "rgba(220,38,38,0.1)",
      };
  }
}

const chipBase: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "12px",
  padding: "2px 6px",
  borderRadius: "6px",
  fontWeight: 600,
  display: "inline-block",
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1px",
  color: "var(--text-muted)",
  marginBottom: "6px",
};

export default function PhonemePanel() {
  const phonemeFrame = useSessionStore((s) => s.phonemeFrame);

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
        Phonemes
      </div>

      {!phonemeFrame ? (
        <div
          style={{
            fontSize: "13px",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Waiting for phonemes...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Expected row */}
          <div>
            <div style={rowLabelStyle}>Expected</div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
              }}
            >
              {phonemeFrame.ref_phonemes.map((ph, i) => (
                <span
                  key={i}
                  style={{
                    ...chipBase,
                    color: "var(--text-muted)",
                    background: "var(--bg-white)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  {ph}
                </span>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div
            style={{
              height: "1px",
              background: "var(--border-light)",
              margin: "2px 0",
            }}
          />

          {/* Detected row */}
          <div>
            <div style={{ ...rowLabelStyle, color: "var(--text-secondary)" }}>
              Detected
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
              }}
            >
              {phonemeFrame.decode_phonemes.map((token: PhonemeToken, i) => {
                const { color, background, border } = getChipStyle(
                  token.dys_label,
                );
                return (
                  <span
                    key={i}
                    style={{
                      ...chipBase,
                      color,
                      background,
                      ...(border ? { border } : {}),
                    }}
                  >
                    {token.phoneme}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
