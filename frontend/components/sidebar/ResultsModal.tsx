"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";
import { fetchSummaryChatReply, fetchAIReport } from "@/lib/api";
import type { SummaryReport, AcousticFeatures } from "@/lib/types";

type Section = "data" | "report";

export default function ResultsModal() {
  const router = useRouter();
  const resultsStatus = useSessionStore((s) => s.resultsStatus);
  const summaryReport = useSessionStore((s) => s.summaryReport);
  const resultsError = useSessionStore((s) => s.resultsError);
  const resetSession = useSessionStore((s) => s.resetSession);

  // Chat state
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "ai"; text: string }[]
  >([
    { role: "ai", text: "Ask about your phonemes, disfluencies, or acoustic features." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Reset chat when modal closes
  useEffect(() => {
    if (resultsStatus === "idle") {
      setChatMessages([
        {
          role: "ai",
          text: "Ask about your phonemes, disfluencies, or acoustic features.",
        },
      ]);
      setChatInput("");
    }
  }, [resultsStatus]);

  if (resultsStatus === "idle") return null;

  const handleBackToHome = () => {
    resetSession();
    router.push("/");
  };

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || !summaryReport || chatLoading) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: msg }]);
    setChatLoading(true);

    try {
      const reply = await fetchSummaryChatReply(summaryReport, msg);
      setChatMessages((prev) => [...prev, { role: "ai", text: reply }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "ai", text: "I couldn't answer that right now." },
      ]);
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        chatLogRef.current?.scrollTo(0, chatLogRef.current.scrollHeight);
      }, 50);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {/* Loading */}
        {resultsStatus === "loading" && (
          <div style={centerCol}>
            <div style={spinnerStyle} />
            <p
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--text)",
                margin: "0 0 8px",
              }}
            >
              Analyzing your voice recording&hellip;
            </p>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Detecting phonemes and building your biomarker summary
            </p>
          </div>
        )}

        {/* Summary success */}
        {resultsStatus === "success" && summaryReport && (
          <SummaryView
            report={summaryReport}
            chatMessages={chatMessages}
            chatInput={chatInput}
            chatLoading={chatLoading}
            chatLogRef={chatLogRef}
            onChatInputChange={setChatInput}
            onChatSend={handleChatSend}
            onClose={handleBackToHome}
          />
        )}

        {/* Error */}
        {resultsStatus === "error" && (
          <div style={centerCol}>
            <p
              style={{
                fontSize: 15,
                color: "var(--red)",
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {resultsError || "Analysis failed. Please try again."}
            </p>
            <button onClick={handleBackToHome} style={btnStyle}>
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Acoustic feature config: ranges for severity bars                        */
/* ────────────────────────────────────────────────────────────────────────── */

interface AcousticMeta {
  label: string;
  unit: string;
  min: number;
  max: number;
  /** If true, higher values = worse (bar turns red). Otherwise higher = better (green). */
  invertColor?: boolean;
}

const ACOUSTIC_META: Record<keyof AcousticFeatures, AcousticMeta> = {
  f0_mean:                 { label: "Pitch (F0 mean)",      unit: "st",      min: 10,   max: 55,   invertColor: false },
  f0_std:                  { label: "Pitch variability",    unit: "st",      min: 0,    max: 12,   invertColor: false },
  jitter:                  { label: "Jitter",               unit: "",        min: 0,    max: 0.06, invertColor: true },
  shimmer_db:              { label: "Shimmer",              unit: "dB",      min: 0,    max: 1.5,  invertColor: true },
  hnr:                     { label: "HNR",                  unit: "dB",      min: 0,    max: 35,   invertColor: false },
  loudness_mean:           { label: "Loudness",             unit: "",        min: 0,    max: 1,    invertColor: false },
  loudness_std:            { label: "Loudness variability", unit: "",        min: 0,    max: 0.5,  invertColor: false },
  speaking_rate:           { label: "Speaking rate",        unit: "peaks/s", min: 0,    max: 8,    invertColor: false },
  voiced_segments_per_sec: { label: "Voiced segments",      unit: "/s",      min: 0,    max: 6,    invertColor: false },
  mean_pause_length:       { label: "Mean pause",           unit: "s",       min: 0,    max: 2,    invertColor: true },
  mean_voiced_length:      { label: "Mean voiced length",   unit: "s",       min: 0,    max: 2,    invertColor: false },
};

function barPercent(val: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
}

function barColor(pct: number, invert: boolean): string {
  // pct 0..100. For normal metrics: low=muted, mid=blue, high=green.
  // For inverted (jitter/shimmer/pause): low=green, high=red.
  if (invert) {
    if (pct < 40) return "#22c55e";
    if (pct < 70) return "#eab308";
    return "#ef4444";
  }
  if (pct < 25) return "#94a3b8";
  if (pct < 60) return "#3b82f6";
  return "#22c55e";
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Summary view with two sections: Data → Report                            */
/* ────────────────────────────────────────────────────────────────────────── */

function SummaryView({
  report,
  chatMessages,
  chatInput,
  chatLoading,
  chatLogRef,
  onChatInputChange,
  onChatSend,
  onClose,
}: {
  report: SummaryReport;
  chatMessages: { role: "user" | "ai"; text: string }[];
  chatInput: string;
  chatLoading: boolean;
  chatLogRef: React.RefObject<HTMLDivElement | null>;
  onChatInputChange: (v: string) => void;
  onChatSend: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>("data");
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const userTx = report.content?.user_transcription ?? "";
  const phonemes = report.content?.phonemes ?? [];
  const dysDetect = report.content?.dys_detect ?? [];
  const acoustics = report.content?.acoustic_features ?? null;

  const dysMap = new Map<number, string>();
  dysDetect.forEach((d, i) => {
    if (d.dysfluency_type !== "normal") {
      dysMap.set(i, d.dysfluency_type);
    }
  });

  const disfluencyCount = dysDetect.filter(
    (d) => d.dysfluency_type !== "normal",
  ).length;

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const narrative = await fetchAIReport(report);
      setAiReport(narrative);
      setSection("report");
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        textAlign: "left",
      }}
    >
      {/* Header */}
      <h2
        style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 700,
          color: "var(--text)",
          textAlign: "center",
        }}
      >
        Session Summary
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-muted)",
          textAlign: "center",
        }}
      >
        {report.segment} session &middot; {report.duration_seconds.toFixed(1)}s
      </p>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
        <TabButton
          active={section === "data"}
          onClick={() => setSection("data")}
          label="Data"
        />
        <TabButton
          active={section === "report"}
          onClick={() => {
            if (aiReport) {
              setSection("report");
            } else {
              handleGenerateReport();
            }
          }}
          label={reportLoading ? "Generating..." : "AI Report"}
          disabled={reportLoading}
        />
      </div>

      {/* ── DATA SECTION ── */}
      {section === "data" && (
        <>
          {/* Grid blocks */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Block title="Transcription">
              {userTx || "No transcription captured."}
            </Block>
            <Block title="Phonemes">
              {phonemes.length === 0 ? (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  N/A
                </span>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "3px",
                    marginTop: 2,
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                >
                  {phonemes.map((ph, i) => {
                    const dysType = dysMap.get(i);
                    const chipColor = dysType === "repetition"
                      ? "#d97706"
                      : dysType === "deletion"
                        ? "#dc2626"
                        : dysType
                          ? "#ea580c"
                          : "var(--text-secondary)";
                    const chipBg = dysType === "repetition"
                      ? "rgba(217,119,6,0.1)"
                      : dysType === "deletion"
                        ? "rgba(220,38,38,0.1)"
                        : dysType
                          ? "rgba(234,88,12,0.1)"
                          : "transparent";
                    return (
                      <span
                        key={i}
                        title={dysType ?? "normal"}
                        style={{
                          fontFamily: "monospace",
                          fontSize: 11,
                          padding: "1px 5px",
                          borderRadius: 5,
                          fontWeight: 600,
                          color: chipColor,
                          background: chipBg,
                          border: "1px solid var(--border-light, #e5e7eb)",
                        }}
                      >
                        {ph}
                      </span>
                    );
                  })}
                </div>
              )}
            </Block>
            <Block title="Disfluencies">
              {disfluencyCount === 0
                ? "None detected"
                : `${disfluencyCount} detected`}
            </Block>
            <Block title="Duration">{report.duration_seconds.toFixed(1)}s</Block>
          </div>

          {/* Acoustic features with severity bars */}
          {acoustics && (
            <div
              style={{
                background: "var(--bg-subtle, #f8f9fb)",
                borderRadius: 12,
                padding: "12px 16px",
              }}
            >
              <h3 style={h3Style}>Acoustic Features</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(Object.keys(ACOUSTIC_META) as (keyof AcousticFeatures)[]).map(
                  (key) => {
                    const val = acoustics[key];
                    if (val == null) return null;
                    const meta = ACOUSTIC_META[key];
                    const pct = barPercent(val, meta.min, meta.max);
                    const color = barColor(pct, !!meta.invertColor);
                    return (
                      <div key={key}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            marginBottom: 3,
                          }}
                        >
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                            {val.toFixed(3)}
                            {meta.unit && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 400,
                                  color: "var(--text-muted)",
                                  marginLeft: 3,
                                }}
                              >
                                {meta.unit}
                              </span>
                            )}
                          </span>
                        </div>
                        {/* Bar track */}
                        <div
                          style={{
                            width: "100%",
                            height: 6,
                            borderRadius: 3,
                            background: "var(--border-light, #e5e7eb)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              borderRadius: 3,
                              background: color,
                              transition: "width 0.6s ease, background 0.4s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}

          {/* Generate Report CTA */}
          <div style={{ textAlign: "center" }}>
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              style={{
                ...btnOutlineStyle,
                opacity: reportLoading ? 0.6 : 1,
              }}
            >
              {reportLoading ? "Generating Report..." : "Generate AI Report →"}
            </button>
            {reportError && (
              <p style={{ fontSize: 12, color: "var(--red)", margin: "6px 0 0" }}>
                {reportError}
              </p>
            )}
          </div>

          {/* Chat */}
          <div
            style={{
              background: "var(--bg-subtle, #f8f9fb)",
              borderRadius: 12,
              padding: "12px 16px",
            }}
          >
            <h3 style={h3Style}>Ask about this report</h3>
            <div
              ref={chatLogRef}
              style={{
                maxHeight: 140,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {chatMessages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    padding: "6px 10px",
                    borderRadius: 8,
                    maxWidth: "85%",
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    background: m.role === "user" ? "var(--blue)" : "#fff",
                    color: m.role === "user" ? "#fff" : "var(--text)",
                    border:
                      m.role === "ai" ? "1px solid var(--border, #e5e7eb)" : "none",
                  }}
                >
                  {m.text}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => onChatInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onChatSend()}
                placeholder="Ask about this report..."
                disabled={chatLoading}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border, #e5e7eb)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                onClick={onChatSend}
                disabled={chatLoading}
                style={{
                  ...btnStyle,
                  padding: "8px 16px",
                  fontSize: 13,
                  marginTop: 0,
                  opacity: chatLoading ? 0.6 : 1,
                }}
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── AI REPORT SECTION ── */}
      {section === "report" && (
        <>
          {reportLoading && (
            <div style={centerCol}>
              <div style={spinnerSmallStyle} />
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                Generating your AI report&hellip;
              </p>
            </div>
          )}

          {aiReport && !reportLoading && (
            <div
              style={{
                background: "var(--bg-subtle, #f8f9fb)",
                borderRadius: 12,
                padding: "16px 20px",
              }}
            >
              <h3 style={{ ...h3Style, fontSize: 15, marginBottom: 12 }}>
                AI Analysis Report
              </h3>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "var(--text)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {aiReport}
              </div>
            </div>
          )}

          {reportError && !reportLoading && (
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "var(--red)", margin: "0 0 8px" }}>
                {reportError}
              </p>
              <button onClick={handleGenerateReport} style={btnOutlineStyle}>
                Retry
              </button>
            </div>
          )}
        </>
      )}

      {/* Disclaimer + close */}
      <p
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          margin: 0,
          lineHeight: 1.6,
          textAlign: "center",
        }}
      >
        This is a research tool, not a medical diagnosis. Consult a professional
        for clinical assessments.
      </p>
      <div style={{ textAlign: "center" }}>
        <button onClick={onClose} style={btnStyle}>
          Back to Home
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small helpers                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 18px",
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 999,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        background: active ? "var(--blue)" : "var(--bg-subtle, #f0f1f3)",
        color: active ? "#fff" : "var(--text-secondary)",
        transition: "all 0.2s ease",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-subtle, #f8f9fb)",
        borderRadius: 12,
        padding: "10px 14px",
      }}
    >
      <h4
        style={{
          margin: "0 0 4px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {title}
      </h4>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  );
}

/* ── Inline styles ─────────────────────────────────────────────────────── */

const overlayStyle: React.CSSProperties = {
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
  overflowY: "auto",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "24px",
  padding: "36px 32px",
  maxWidth: "560px",
  width: "100%",
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 24px 80px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.04)",
  animation: "results-enter 0.4s ease",
};

const centerCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "20px",
};

const spinnerStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  border: "3px solid var(--border)",
  borderTopColor: "var(--blue)",
  animation: "spin 0.8s linear infinite",
};

const spinnerSmallStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  border: "2px solid var(--border)",
  borderTopColor: "var(--blue)",
  animation: "spin 0.8s linear infinite",
};

const btnStyle: React.CSSProperties = {
  background: "var(--blue)",
  color: "#ffffff",
  border: "none",
  borderRadius: "999px",
  padding: "12px 28px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  transition: "background 0.2s ease",
  marginTop: 4,
};

const btnOutlineStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--blue)",
  border: "2px solid var(--blue)",
  borderRadius: "999px",
  padding: "10px 24px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.2s ease",
};

const h3Style: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
};
