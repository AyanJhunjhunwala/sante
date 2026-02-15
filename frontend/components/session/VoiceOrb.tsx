"use client";

interface VoiceOrbProps {
  aiSpeaking: boolean;
  isActive: boolean;
  isMuted: boolean;
  phase: string;
  currentPrompt: number;
  totalPrompts: number;
}

export default function VoiceOrb({
  aiSpeaking,
  isActive,
  isMuted,
  phase,
  currentPrompt,
  totalPrompts,
}: VoiceOrbProps) {
  const progressDeg = totalPrompts > 0 ? (currentPrompt / totalPrompts) * 360 : 0;

  const ringBorderColor = aiSpeaking
    ? "rgba(148,163,184,0.35)"
    : "var(--blue-ring)";

  const orbBackground = aiSpeaking
    ? "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)"
    : "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)";

  const orbShadow = aiSpeaking
    ? "0 8px 24px rgba(100,116,139,0.28)"
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
          width: "188px",
          height: "188px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Progress ring */}
        {isActive && (
          <div
            style={{
              position: "absolute",
              width: "160px",
              height: "160px",
              borderRadius: "50%",
              background: `conic-gradient(var(--timer-color) ${progressDeg}deg, rgba(148,163,184,0.15) 0)`,
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
            width: "208px",
            height: "208px",
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
            width: "252px",
            height: "252px",
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
            width: "300px",
            height: "300px",
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
            width: "132px",
            height: "132px",
            borderRadius: "50%",
            background: orbBackground,
            boxShadow: orbShadow,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            transition: "background 0.4s ease, box-shadow 0.4s ease",
          }}
        >
          <span
            style={{
              fontSize: "22px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#ffffff",
              fontWeight: 500,
            }}
          >
            Santé
          </span>
          {isActive && (
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "rgba(255,255,255,0.85)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {currentPrompt}/{totalPrompts}
            </span>
          )}
        </div>
      </div>

      {/* Phase label */}
      {isActive && (
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          {phase}
        </div>
      )}
    </div>
  );
}
