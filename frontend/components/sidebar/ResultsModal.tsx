"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";

const CheckIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="32"
    height="32"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const WarningIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="32"
    height="32"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export default function ResultsModal() {
  const router = useRouter();
  const resultsStatus = useSessionStore((s) => s.resultsStatus);
  const analysisResults = useSessionStore((s) => s.analysisResults);
  const resultsError = useSessionStore((s) => s.resultsError);
  const resetSession = useSessionStore((s) => s.resetSession);

  // Animate bars from 0% to actual value
  const [calmWidth, setCalmWidth] = useState(0);
  const [stressWidth, setStressWidth] = useState(0);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (
      resultsStatus === "success" &&
      analysisResults &&
      !animatedRef.current
    ) {
      animatedRef.current = true;
      const timer = setTimeout(() => {
        setCalmWidth(analysisResults.notStressed);
        setStressWidth(analysisResults.stressed);
      }, 100);
      return () => clearTimeout(timer);
    }
    if (resultsStatus !== "success") {
      animatedRef.current = false;
      setCalmWidth(0);
      setStressWidth(0);
    }
  }, [resultsStatus, analysisResults]);

  if (resultsStatus === "idle") return null;

  const handleBackToHome = () => {
    resetSession();
    router.push("/");
  };

  const isStressed = analysisResults?.prediction === "STRESSED";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "24px",
          padding: "48px 40px",
          maxWidth: "460px",
          width: "100%",
          boxShadow: "0 24px 80px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.04)",
          textAlign: "center",
          animation: "results-enter 0.4s ease",
        }}
      >
        {/* Loading state */}
        {resultsStatus === "loading" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                border: "3px solid var(--border)",
                borderTopColor: "var(--blue)",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div>
              <p
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "var(--text)",
                  margin: "0 0 8px",
                }}
              >
                Analyzing your voice...
              </p>
              <p
                style={{
                  fontSize: "13px",
                  color: "var(--text-muted)",
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                Running stress detection model — this may take a moment on first
                run
              </p>
            </div>
          </div>
        )}

        {/* Success state */}
        {resultsStatus === "success" && analysisResults && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: isStressed
                  ? "var(--red-soft)"
                  : "var(--emerald-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isStressed ? "var(--red)" : "var(--emerald)",
              }}
            >
              {isStressed ? WarningIcon : CheckIcon}
            </div>

            {/* Prediction heading */}
            <div>
              <h2
                style={{
                  fontSize: "24px",
                  fontWeight: 700,
                  color: isStressed ? "var(--red)" : "var(--emerald)",
                  margin: "0 0 6px",
                  letterSpacing: "-0.5px",
                }}
              >
                {isStressed ? "Stressed" : "Not Stressed"}
              </h2>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                {analysisResults.confidence.toFixed(1)}% confidence
              </p>
            </div>

            {/* Bars */}
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                textAlign: "left",
              }}
            >
              {/* Not Stressed bar */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                >
                  <span>Not Stressed</span>
                  <span>{analysisResults.notStressed.toFixed(1)}%</span>
                </div>
                <div
                  style={{
                    flex: 1,
                    height: "10px",
                    background: "var(--border-light)",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: "999px",
                      background: "var(--emerald)",
                      width: `${calmWidth}%`,
                      transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
                    }}
                  />
                </div>
              </div>

              {/* Stressed bar */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                >
                  <span>Stressed</span>
                  <span>{analysisResults.stressed.toFixed(1)}%</span>
                </div>
                <div
                  style={{
                    flex: 1,
                    height: "10px",
                    background: "var(--border-light)",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: "999px",
                      background: "var(--red)",
                      width: `${stressWidth}%`,
                      transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Disclaimer */}
            <p
              style={{
                fontSize: "11px",
                color: "var(--text-dim)",
                margin: "4px 0 0",
                lineHeight: 1.6,
              }}
            >
              This is a research tool, not a medical diagnosis. Consult a
              professional for clinical assessments.
            </p>

            {/* Back to Home */}
            <button
              onClick={handleBackToHome}
              style={{
                background: "var(--blue)",
                color: "#ffffff",
                border: "none",
                borderRadius: "999px",
                padding: "12px 28px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s ease",
                marginTop: "4px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--blue-dark)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--blue)";
              }}
            >
              Back to Home
            </button>
          </div>
        )}

        {/* Error state */}
        {resultsStatus === "error" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <p
              style={{
                fontSize: "15px",
                color: "var(--red)",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {resultsError || "Analysis failed. Please try again."}
            </p>
            <button
              onClick={handleBackToHome}
              style={{
                background: "var(--blue)",
                color: "#ffffff",
                border: "none",
                borderRadius: "999px",
                padding: "12px 28px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--blue-dark)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--blue)";
              }}
            >
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
