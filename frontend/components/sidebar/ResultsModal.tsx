"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";
import { fetchSummaryChatReply } from "@/lib/api";
import type { SummaryReport } from "@/lib/types";

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
    { role: "ai", text: "Ask about stress, accent, phonemes, or confidence." },
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
          text: "Ask about stress, accent, phonemes, or confidence.",
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
/* Summary view                                                              */
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
  const accent = report.executive_summary?.accent_prediction ?? "Unknown";
  const accentConf = (report.executive_summary?.accent_confidence ?? 0).toFixed(
    2,
  );
  const stressBinary = String(
    report.content?.stress_binary ?? "no",
  ).toUpperCase();
  const userTx = report.content?.user_transcription ?? "";
  const phonemes = (report.content?.phonemes ?? []).slice(0, 48);
  const dysDetect = report.content?.dys_detect ?? [];
  const phonemesSource = report.content?.phonemes_source ?? "dummy";
  const metrics = Array.isArray(report.metrics) ? report.metrics : [];
  const aiSummary = report.ai_summary ?? "No summary available.";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        textAlign: "left",
      }}
    >
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
          fontSize: 14,
          color: "var(--text-muted)",
          textAlign: "center",
        }}
      >
        Accent: <strong>{accent}</strong> ({accentConf})
      </p>

      {/* Grid blocks */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Block title="User Transcription">
          {userTx || "No user transcription captured."}
        </Block>
        <Block
          title={`Phonemes${phonemesSource === "runpod" ? "" : " (dummy)"}`}
        >
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
              }}
            >
              {phonemes.map((ph, i) => {
                const label = dysDetect[i] ?? "normal";
                const chipColor =
                  label === "repetition"
                    ? "#d97706"
                    : label === "prolongation"
                      ? "#ea580c"
                      : label !== "normal"
                        ? "#dc2626"
                        : "var(--text-secondary)";
                const chipBg =
                  label === "repetition"
                    ? "rgba(217,119,6,0.1)"
                    : label === "prolongation"
                      ? "rgba(234,88,12,0.1)"
                      : label !== "normal"
                        ? "rgba(220,38,38,0.1)"
                        : "transparent";
                return (
                  <span
                    key={i}
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
        <Block title="Stress (binary)">{stressBinary}</Block>
        <Block title="Duration">{report.duration_seconds.toFixed(1)}s</Block>
      </div>

      {/* Metrics table */}
      <div
        style={{
          background: "var(--bg-subtle, #f8f9fb)",
          borderRadius: 12,
          padding: "12px 16px",
        }}
      >
        <h3 style={h3Style}>Signals</h3>
        {metrics.map((m) => (
          <div key={m.name} style={metricRowStyle}>
            <span style={{ flex: 1, textTransform: "capitalize" }}>
              {m.name.replace(/_/g, " ")}
            </span>
            <span style={{ width: 70, textAlign: "right", fontWeight: 600 }}>
              {Math.round(m.score * 100)}
            </span>
            <span
              style={{
                width: 70,
                textAlign: "right",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              {Math.round(m.confidence * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* AI summary */}
      <div>
        <h3 style={h3Style}>AI Summary</h3>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          {aiSummary}
        </p>
      </div>

      {/* Chat */}
      <div
        style={{
          background: "var(--bg-subtle, #f8f9fb)",
          borderRadius: 12,
          padding: "12px 16px",
        }}
      >
        <h3 style={h3Style}>Ask the summary AI</h3>
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

const h3Style: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
};

const metricRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "4px 0",
  fontSize: 13,
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border-light, #f0f0f3)",
};
