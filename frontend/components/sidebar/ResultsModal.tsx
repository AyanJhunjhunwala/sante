"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";
import SessionSummaryPanel from "@/components/summary/SessionSummaryPanel";

export default function ResultsModal() {
  const router = useRouter();
  const resultsStatus = useSessionStore((s) => s.resultsStatus);
  const summaryReport = useSessionStore((s) => s.summaryReport);
  const resultsError = useSessionStore((s) => s.resultsError);
  const resetSession = useSessionStore((s) => s.resetSession);

  const handleBackToHome = () => {
    resetSession();
    router.push("/");
  };

  if (resultsStatus === "idle") return null;

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {resultsStatus === "loading" && (
          <div style={centerCol}>
            <div style={spinnerStyle} />
            <p style={{ margin: 0, color: "var(--text)", fontSize: 18, fontWeight: 700 }}>
              Building your professional session report&hellip;
            </p>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
              Synthesizing phonemes, disfluencies, acoustics, and sectioned AI insights
            </p>
          </div>
        )}

        {resultsStatus === "error" && (
          <div style={centerCol}>
            <p style={{ margin: 0, color: "var(--red)", fontSize: 14 }}>
              {resultsError || "Analysis failed. Please try again."}
            </p>
            <button onClick={handleBackToHome} style={btnStyle}>
              Back to Home
            </button>
          </div>
        )}

        {resultsStatus === "success" && summaryReport && (
          <SessionSummaryPanel
            report={summaryReport}
            onClose={handleBackToHome}
            showCloseButton
            autoGenerateAI
          />
        )}
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(15,23,42,0.45)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "22px",
  overflowY: "auto",
};

const cardStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: "22px",
  padding: "26px 28px",
  width: "min(1280px, 96vw)",
  height: "min(920px, 95vh)",
  overflowY: "auto",
  boxShadow: "0 24px 80px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.04)",
  animation: "results-enter 0.35s ease",
};

const centerCol: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 18,
};

const spinnerStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  border: "3px solid var(--border)",
  borderTopColor: "var(--blue)",
  animation: "spin 0.8s linear infinite",
};

const btnStyle: CSSProperties = {
  background: "var(--blue)",
  color: "#ffffff",
  border: "none",
  borderRadius: "999px",
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
