"use client";

interface VoiceOrbProps {
  aiSpeaking: boolean;
  isActive: boolean;
  timerProgress: number; // 0-1
  countdown: string;
}

export default function VoiceOrb({
  aiSpeaking,
  isActive,
  timerProgress,
  countdown,
}: VoiceOrbProps) {
  const timerDeg = timerProgress * 360;

  const ringBorderColor = aiSpeaking
    ? "rgba(99,102,241,0.15)"
    : "var(--blue-ring)";

  const orbBackground = aiSpeaking
    ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
    : "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)";

  const orbShadow = aiSpeaking
    ? "0 8px 32px rgba(99,102,241,0.3)"
    : "var(--shadow-blue)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
      }}
    >
      {/* Outer container */}
      <div
        style={{
          position: "relative",
          width: "220px",
          height: "220px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Timer ring */}
        {isActive && (
          <div
            style={{
              position: "absolute",
              width: "188px",
              height: "188px",
              borderRadius: "50%",
              background: `conic-gradient(var(--timer-color) ${timerDeg}deg, rgba(148,163,184,0.15) 0)`,
              WebkitMask:
                "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
              zIndex: 3,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Ring 1 */}
        <div
          style={{
            position: "absolute",
            width: "240px",
            height: "240px",
            borderRadius: "50%",
            border: `1.5px solid ${ringBorderColor}`,
            opacity: isActive ? 1 : 0,
            transition: "opacity 0.4s ease, border-color 0.4s ease",
            animation: isActive
              ? "ring-pulse 2.5s ease-in-out infinite"
              : "none",
          }}
        />

        {/* Ring 2 */}
        <div
          style={{
            position: "absolute",
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            border: `1.5px solid ${ringBorderColor}`,
            opacity: isActive ? 1 : 0,
            transition: "opacity 0.4s ease, border-color 0.4s ease",
            animation: isActive
              ? "ring-pulse 2.5s ease-in-out infinite 0.4s"
              : "none",
          }}
        />

        {/* Ring 3 */}
        <div
          style={{
            position: "absolute",
            width: "370px",
            height: "370px",
            borderRadius: "50%",
            border: `1.5px solid ${ringBorderColor}`,
            opacity: isActive ? 1 : 0,
            transition: "opacity 0.4s ease, border-color 0.4s ease",
            animation: isActive
              ? "ring-pulse 2.5s ease-in-out infinite 0.8s"
              : "none",
          }}
        />

        {/* Orb */}
        <div
          style={{
            width: "160px",
            height: "160px",
            borderRadius: "50%",
            background: orbBackground,
            boxShadow: orbShadow,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.4s ease, box-shadow 0.4s ease",
          }}
        >
          <span
            style={{
              fontSize: "22px",
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "#ffffff",
              fontWeight: 500,
            }}
          >
            Santé
          </span>
        </div>
      </div>

      {/* Countdown */}
      {isActive && (
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.5px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {countdown}
        </div>
      )}
    </div>
  );
}
