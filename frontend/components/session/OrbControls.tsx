"use client";

interface OrbControlsProps {
  isMuted: boolean;
  aiSpeaking: boolean;
  onToggleMute: () => void;
  onEndSession: () => void;
}

const MicOnIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width="18"
    height="18"
    style={{ flexShrink: 0 }}
  >
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
  </svg>
);

const MicOffIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width="18"
    height="18"
    style={{ flexShrink: 0 }}
  >
    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
  </svg>
);

const StopIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width="18"
    height="18"
    style={{ flexShrink: 0 }}
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export default function OrbControls({
  isMuted,
  aiSpeaking,
  onToggleMute,
  onEndSession,
}: OrbControlsProps) {
  const getMuteLabel = () => {
    if (!isMuted) return "Mute";
    if (aiSpeaking) return "Interrupt";
    return "Unmute";
  };

  const getMuteIcon = () => {
    if (!isMuted) return MicOnIcon;
    return MicOffIcon;
  };

  const getMuteStyle = (): React.CSSProperties => {
    if (!isMuted) {
      return {
        background: "#ffffff",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
      };
    }
    if (aiSpeaking) {
      return {
        background: "var(--red-light)",
        border: "1px solid var(--red)",
        color: "var(--red)",
      };
    }
    return {
      background: "var(--red-light)",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "var(--red)",
    };
  };

  const pillBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 20px",
    borderRadius: "40px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
    outline: "none",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
      }}
    >
      {/* Mute / Unmute / Interrupt button */}
      <button
        onClick={onToggleMute}
        style={{ ...pillBase, ...getMuteStyle() }}
        onMouseEnter={(e) => {
          if (!isMuted) {
            e.currentTarget.style.background = "var(--blue-soft)";
            e.currentTarget.style.borderColor = "var(--blue)";
            e.currentTarget.style.color = "var(--blue)";
          }
        }}
        onMouseLeave={(e) => {
          const s = getMuteStyle();
          e.currentTarget.style.background = s.background as string;
          e.currentTarget.style.borderColor =
            s.border?.toString().split(" ")[2] ?? "var(--border)";
          e.currentTarget.style.color = s.color as string;
        }}
      >
        {getMuteIcon()}
        <span>{getMuteLabel()}</span>
        {aiSpeaking && (
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: "var(--red)",
              animation: "blink 1s ease-in-out infinite",
            }}
          />
        )}
      </button>

      {/* End Session button */}
      <button
        onClick={onEndSession}
        style={{
          ...pillBase,
          background: "#ffffff",
          border: "1px solid rgba(239,68,68,0.15)",
          color: "var(--red)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--red-light)";
          e.currentTarget.style.borderColor = "var(--red)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#ffffff";
          e.currentTarget.style.borderColor = "rgba(239,68,68,0.15)";
        }}
      >
        {StopIcon}
        <span>End Session</span>
      </button>
    </div>
  );
}
