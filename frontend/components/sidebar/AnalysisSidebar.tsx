"use client";

import type { RefObject } from "react";
import { useSessionStore } from "@/store/sessionStore";
import { SEGMENT_LABELS } from "@/lib/constants";
import WaveformPanel from "./WaveformPanel";
import NoiseThresholdPanel from "./NoiseThresholdPanel";
import F0PitchPanel from "./F0PitchPanel";
import WPMPanel from "./WPMPanel";
import LiveTranscriptPanel from "./LiveTranscriptPanel";

interface AnalysisSidebarProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export default function AnalysisSidebar({ canvasRef }: AnalysisSidebarProps) {
  const segment = useSessionStore((s) => s.segment);
  const segmentLabel = segment ? SEGMENT_LABELS[segment] : "";

  return (
    <div
      style={{
        background: "var(--bg)",
        borderLeft: "1px solid var(--border-light)",
        width: "340px",
        display: "flex",
        flexDirection: "column",
        padding: "20px 16px",
        gap: "14px",
        overflowY: "auto",
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "4px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1.4px",
            color: "var(--text-muted)",
          }}
        >
          Live Analysis
        </span>
        {segment && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--blue)",
              background: "var(--blue-soft)",
              padding: "3px 8px",
              borderRadius: "999px",
              letterSpacing: "0.4px",
            }}
          >
            {segmentLabel}
          </span>
        )}
      </div>

      <WaveformPanel canvasRef={canvasRef} />
      <NoiseThresholdPanel />
      <F0PitchPanel />
      <WPMPanel />
      <LiveTranscriptPanel />
    </div>
  );
}
