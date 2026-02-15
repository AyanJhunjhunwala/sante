"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";
import { exportSummaryPdf, fetchAIReport, fetchSummaryChatReply } from "@/lib/api";
import type { AcousticFeatures, SummaryEstimate, SummaryReport } from "@/lib/types";

type Section = "overview" | "raw" | "report";

interface AcousticMeta {
  label: string;
  unit: string;
  min: number;
  max: number;
  invertColor?: boolean;
}

const ACOUSTIC_META: Record<keyof AcousticFeatures, AcousticMeta> = {
  f0_mean: { label: "Pitch (F0 mean)", unit: "st", min: 10, max: 55 },
  f0_std: { label: "Pitch variability", unit: "st", min: 0, max: 12 },
  jitter: { label: "Jitter", unit: "", min: 0, max: 0.06, invertColor: true },
  shimmer_db: { label: "Shimmer", unit: "dB", min: 0, max: 1.5, invertColor: true },
  hnr: { label: "HNR", unit: "dB", min: 0, max: 35 },
  loudness_mean: { label: "Loudness", unit: "", min: 0, max: 1 },
  loudness_std: { label: "Loudness variability", unit: "", min: 0, max: 0.5 },
  speaking_rate: { label: "Speaking rate", unit: "peaks/s", min: 0, max: 8 },
  voiced_segments_per_sec: { label: "Voiced segments", unit: "/s", min: 0, max: 6 },
  mean_pause_length: { label: "Mean pause", unit: "s", min: 0, max: 2, invertColor: true },
  mean_voiced_length: { label: "Mean voiced length", unit: "s", min: 0, max: 2 },
};

function barPercent(val: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
}

function barColor(pct: number, invert: boolean): string {
  if (invert) {
    if (pct < 35) return "var(--emerald)";
    if (pct < 65) return "var(--text-muted)";
    return "var(--red)";
  }
  if (pct < 30) return "var(--text-muted)";
  if (pct < 70) return "var(--blue)";
  return "var(--emerald)";
}

function levelTone(level: string): { bg: string; text: string; border: string } {
  const lvl = level.toLowerCase();
  if (lvl.includes("high")) {
    return { bg: "var(--red-light)", text: "var(--red)", border: "1px solid rgba(239,68,68,0.28)" };
  }
  if (lvl.includes("moderate")) {
    return {
      bg: "var(--bg-subtle, #f8f9fb)",
      text: "var(--text-secondary)",
      border: "1px solid var(--border)",
    };
  }
  return {
    bg: "var(--bg-subtle, #f8f9fb)",
    text: "var(--text-secondary)",
    border: "1px solid var(--border)",
  };
}

export default function ResultsModal() {
  const router = useRouter();
  const resultsStatus = useSessionStore((s) => s.resultsStatus);
  const summaryReport = useSessionStore((s) => s.summaryReport);
  const resultsError = useSessionStore((s) => s.resultsError);
  const resetSession = useSessionStore((s) => s.resetSession);

  const [section, setSection] = useState<Section>("overview");
  const [aiReport, setAiReport] = useState<string>("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<{ role: "user" | "ai"; text: string }[]>([
    {
      role: "ai",
      text: "Ask about any estimate, confidence band, noise impact, or acoustic feature.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (resultsStatus === "idle") {
      setSection("overview");
      setAiReport("");
      setReportError(null);
      setExportError(null);
      setChatInput("");
      setChatMessages([
        {
          role: "ai",
          text: "Ask about any estimate, confidence band, noise impact, or acoustic feature.",
        },
      ]);
    }
  }, [resultsStatus]);

  const handleBackToHome = () => {
    resetSession();
    router.push("/");
  };

  const handleGenerateAIReport = async () => {
    if (!summaryReport || reportLoading) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const narrative = await fetchAIReport(summaryReport);
      setAiReport(narrative);
      setSection("report");
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate AI report.");
    } finally {
      setReportLoading(false);
    }
  };

  const handleExportPdf = async () => {
    if (!summaryReport || exportLoading) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const url = await exportSummaryPdf(summaryReport);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setExportLoading(false);
    }
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
              Synthesizing phonemes, disfluencies, acoustics, and confidence bands
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
          <SummaryView
            report={summaryReport}
            section={section}
            setSection={setSection}
            onGenerateReport={handleGenerateAIReport}
            aiReport={aiReport}
            reportLoading={reportLoading}
            reportError={reportError}
            onExportPdf={handleExportPdf}
            exportLoading={exportLoading}
            exportError={exportError}
            chatMessages={chatMessages}
            chatInput={chatInput}
            chatLoading={chatLoading}
            chatLogRef={chatLogRef}
            onChatInputChange={setChatInput}
            onChatSend={handleChatSend}
            onClose={handleBackToHome}
          />
        )}
      </div>
    </div>
  );
}

function SummaryView({
  report,
  section,
  setSection,
  onGenerateReport,
  aiReport,
  reportLoading,
  reportError,
  onExportPdf,
  exportLoading,
  exportError,
  chatMessages,
  chatInput,
  chatLoading,
  chatLogRef,
  onChatInputChange,
  onChatSend,
  onClose,
}: {
  report: SummaryReport;
  section: Section;
  setSection: (section: Section) => void;
  onGenerateReport: () => void;
  aiReport: string;
  reportLoading: boolean;
  reportError: string | null;
  onExportPdf: () => void;
  exportLoading: boolean;
  exportError: string | null;
  chatMessages: { role: "user" | "ai"; text: string }[];
  chatInput: string;
  chatLoading: boolean;
  chatLogRef: RefObject<HTMLDivElement | null>;
  onChatInputChange: (value: string) => void;
  onChatSend: () => void;
  onClose: () => void;
}) {
  const acoustics = report.content.acoustic_features;
  const dysDetect = report.content.dys_detect ?? [];
  const phonemes = report.content.phonemes ?? [];
  const disfluencyCount = dysDetect.filter((d) => d.dysfluency_type !== "normal").length;

  const topEstimates = useMemo(
    () => [...(report.estimates ?? [])].sort((a, b) => b.score - a.score),
    [report.estimates],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--text)", fontSize: 24, fontWeight: 700 }}>Session Summary</h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {report.segment} session · {report.duration_seconds.toFixed(1)}s
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onExportPdf} disabled={exportLoading} style={btnOutlineStyle}>
            {exportLoading ? "Exporting..." : "Export PDF"}
          </button>
          <button onClick={onClose} style={btnStyle}>Back to Home</button>
        </div>
      </div>

      {exportError && <p style={{ margin: 0, color: "var(--red)", fontSize: 12 }}>{exportError}</p>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <TabButton active={section === "overview"} onClick={() => setSection("overview")} label="Overview" />
        <TabButton active={section === "raw"} onClick={() => setSection("raw")} label="Raw Data" />
        <TabButton
          active={section === "report"}
          onClick={() => {
            if (aiReport) {
              setSection("report");
              return;
            }
            onGenerateReport();
          }}
          label={reportLoading ? "Generating..." : "AI Report"}
          disabled={reportLoading}
        />
      </div>

      {section === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <MiniCard title="Disfluencies" value={disfluencyCount === 0 ? "None" : `${disfluencyCount} detected`} />
            <MiniCard title="Phoneme Tokens" value={`${phonemes.length}`} />
            <MiniCard
              title="Data Quality"
              value={report.quality ? `${report.quality.grade} (${report.quality.score.toFixed(0)}%)` : "N/A"}
            />
            <MiniCard
              title="Noise Likelihood"
              value={report.quality ? `${Math.round(report.quality.noise_likelihood * 100)}%` : "N/A"}
            />
          </div>

          <Block title="Clinical Readout">
            <p style={{ margin: 0 }}>
              {report.executive_summary?.quality_statement || report.quality?.summary || "No quality statement available."}
            </p>
            {(report.executive_summary?.recommended_followups ?? []).length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {report.executive_summary?.recommended_followups.map((item, index) => (
                  <li key={index} style={{ marginBottom: 4 }}>{item}</li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="Exploratory Estimate Categories">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              {topEstimates.map((estimate) => (
                <EstimateCard key={estimate.key} estimate={estimate} />
              ))}
            </div>
          </Block>

          {(report.limitations ?? []).length > 0 && (
            <Block title="Limitations">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {report.limitations?.map((item, index) => (
                  <li key={index} style={{ marginBottom: 4 }}>{item}</li>
                ))}
              </ul>
            </Block>
          )}
        </>
      )}

      {section === "raw" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Block title="Transcription">{report.content.user_transcription || "No transcription captured."}</Block>
            <Block title="Phonemes">
              {phonemes.length === 0 ? (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>N/A</span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 150, overflowY: "auto" }}>
                  {phonemes.map((ph, i) => (
                    <span
                      key={i}
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {ph}
                    </span>
                  ))}
                </div>
              )}
            </Block>
          </div>

          {acoustics && (
            <Block title="Acoustic Features">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {(Object.keys(ACOUSTIC_META) as (keyof AcousticFeatures)[]).map((key) => {
                  const metric = ACOUSTIC_META[key];
                  const value = acoustics[key];
                  if (value == null) return null;
                  const pct = barPercent(value, metric.min, metric.max);
                  const fill = barColor(pct, !!metric.invertColor);
                  return (
                    <div key={key}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{metric.label}</span>
                        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
                          {value.toFixed(3)} {metric.unit}
                        </span>
                      </div>
                      <div style={{ height: 7, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: fill, transition: "width 0.3s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Block>
          )}

          <Block title="Ask About This Report">
            <div
              ref={chatLogRef}
              style={{
                maxHeight: 220,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    background: msg.role === "user" ? "var(--blue)" : "#fff",
                    color: msg.role === "user" ? "#fff" : "var(--text)",
                    border: msg.role === "ai" ? "1px solid var(--border)" : "none",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 13,
                    lineHeight: 1.55,
                    maxWidth: "80%",
                  }}
                >
                  {msg.text}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => onChatInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onChatSend()}
                placeholder="Ask about estimates, confidence, or specific metrics..."
                disabled={chatLoading}
                style={{
                  flex: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "9px 12px",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                onClick={onChatSend}
                disabled={chatLoading}
                style={{ ...btnStyle, marginTop: 0, padding: "9px 16px", fontSize: 13 }}
              >
                Send
              </button>
            </div>
          </Block>
        </>
      )}

      {section === "report" && (
        <>
          {reportLoading && (
            <div style={centerCol}>
              <div style={spinnerSmallStyle} />
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                Generating AI clinical narrative&hellip;
              </p>
            </div>
          )}

          {!reportLoading && aiReport && (
            <Block title="AI Analysis Report">
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.7 }}>{aiReport}</div>
            </Block>
          )}

          {reportError && (
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 8px", color: "var(--red)", fontSize: 13 }}>{reportError}</p>
              <button onClick={onGenerateReport} style={btnOutlineStyle}>Retry</button>
            </div>
          )}
        </>
      )}

      <p style={{ margin: 0, textAlign: "center", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
        This is a research tool, not a medical diagnosis. Interpret estimates with caution and confirm through formal assessment.
      </p>
    </div>
  );
}

function EstimateCard({ estimate }: { estimate: SummaryEstimate }) {
  const tone = levelTone(estimate.level);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <h4 style={{ margin: 0, fontSize: 14, color: "var(--text)", fontWeight: 700 }}>{estimate.title}</h4>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 999,
            padding: "4px 8px",
            background: tone.bg,
            color: tone.text,
            border: tone.border,
            whiteSpace: "nowrap",
          }}
        >
          {estimate.level}
        </span>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Score {estimate.score}/100</span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Confidence {estimate.confidence}%</span>
      </div>

      <div style={{ marginTop: 8, height: 8, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, estimate.score))}%`,
            height: "100%",
            background: "var(--blue)",
          }}
        />
      </div>

      <p style={{ margin: "9px 0 0", color: "var(--text)", fontSize: 12, lineHeight: 1.5 }}>{estimate.suggestion}</p>

      {estimate.evidence.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
          {estimate.evidence.slice(0, 3).map((item, i) => (
            <li key={i} style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px" }}>
      <p
        style={{
          margin: "0 0 2px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
        }}
      >
        {title}
      </p>
      <p style={{ margin: 0, fontSize: 15, color: "var(--text)", fontWeight: 700 }}>{value}</p>
    </div>
  );
}

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
        padding: "6px 16px",
        fontSize: 13,
        borderRadius: 999,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        background: active ? "var(--blue)" : "var(--bg-subtle, #f0f1f3)",
        color: active ? "#fff" : "var(--text-secondary)",
        fontWeight: 600,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ background: "var(--bg-subtle, #f8f9fb)", borderRadius: 12, padding: "12px 14px" }}>
      <h3
        style={{
          margin: "0 0 8px",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
        }}
      >
        {title}
      </h3>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>{children}</div>
    </section>
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
  padding: "26px 26px",
  maxWidth: "1080px",
  width: "100%",
  maxHeight: "92vh",
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

const spinnerSmallStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  border: "2px solid var(--border)",
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

const btnOutlineStyle: CSSProperties = {
  background: "transparent",
  color: "var(--blue)",
  border: "2px solid var(--blue)",
  borderRadius: "999px",
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
