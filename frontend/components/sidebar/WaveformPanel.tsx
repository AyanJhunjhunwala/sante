"use client";

import type { RefObject } from "react";

interface WaveformPanelProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export default function WaveformPanel({ canvasRef }: WaveformPanelProps) {
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
          marginBottom: "8px",
        }}
      >
        Waveform
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "64px",
          borderRadius: "4px",
          display: "block",
        }}
        width={600}
        height={64}
      />
    </div>
  );
}
