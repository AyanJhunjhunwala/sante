"use client";

import { useSessionStore } from "@/store/sessionStore";
import {
  VAD_THRESHOLD_MIN,
  VAD_THRESHOLD_MAX,
  VAD_THRESHOLD_STEP,
} from "@/lib/constants";

export default function NoiseThresholdPanel() {
  const vadThreshold = useSessionStore((s) => s.vadThreshold);
  const setVadThreshold = useSessionStore((s) => s.setVadThreshold);

  return (
    <div
      style={{
        background: "var(--bg-white)",
        border: "1px solid var(--border-light)",
        borderRadius: "16px",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1.2px",
            color: "var(--text-muted)",
          }}
        >
          Noise Threshold
        </div>
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {vadThreshold.toFixed(2)}
        </div>
      </div>

      <input
        type="range"
        min={VAD_THRESHOLD_MIN}
        max={VAD_THRESHOLD_MAX}
        step={VAD_THRESHOLD_STEP}
        value={vadThreshold}
        onChange={(e) => setVadThreshold(Number.parseFloat(e.target.value))}
        style={{
          width: "100%",
          accentColor: "var(--indigo)",
          cursor: "pointer",
        }}
      />

      <div
        style={{
          marginTop: "6px",
          fontSize: "11px",
          color: "var(--text-muted)",
        }}
      >
        Higher = stricter in noisy rooms.
      </div>
    </div>
  );
}
