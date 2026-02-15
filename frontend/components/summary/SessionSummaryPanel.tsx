"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { exportSummaryPdf, fetchStructuredAIReport } from "@/lib/api";
import type {
  AcousticFeatures,
  StructuredSummarySections,
  SummaryActionResult,
  SummaryEstimate,
  SummaryReport,
} from "@/lib/types";

interface SessionSummaryPanelProps {
  report: SummaryReport;
  onClose?: () => void;
  showCloseButton?: boolean;
  autoGenerateAI?: boolean;
  initialSections?: StructuredSummarySections;
}

interface AcousticMeta {
  label: string;
  unit: string;
}

type SummaryTab = "insights" | "signalData";

const ACOUSTIC_META: Record<keyof AcousticFeatures, AcousticMeta> = {
  f0_mean: { label: "Pitch (F0 mean)", unit: "st" },
  f0_std: { label: "Pitch variability", unit: "st" },
  jitter: { label: "Jitter", unit: "" },
  shimmer_db: { label: "Shimmer", unit: "dB" },
  hnr: { label: "HNR", unit: "dB" },
  loudness_mean: { label: "Loudness", unit: "" },
  loudness_std: { label: "Loudness variability", unit: "" },
  speaking_rate: { label: "Speaking rate", unit: "peaks/s" },
  voiced_segments_per_sec: { label: "Voiced segments", unit: "/s" },
  mean_pause_length: { label: "Mean pause", unit: "s" },
  mean_voiced_length: { label: "Mean voiced length", unit: "s" },
};

const ACOUSTIC_BAR_BOUNDS: Record<
  keyof AcousticFeatures,
  { min: number; max: number; refLow: number; refHigh: number }
> = {
  f0_mean: { min: 18, max: 35, refLow: 23, refHigh: 32 },
  f0_std: { min: 0.12, max: 0.62, refLow: 0.20, refHigh: 0.45 },
  jitter: { min: 0.01, max: 0.06, refLow: 0.015, refHigh: 0.035 },
  shimmer_db: { min: 0.6, max: 2.8, refLow: 0.95, refHigh: 1.90 },
  hnr: { min: 0.5, max: 8.0, refLow: 3.5, refHigh: 6.2 },
  loudness_mean: { min: 0.04, max: 0.35, refLow: 0.10, refHigh: 0.22 },
  loudness_std: { min: 0.3, max: 3.2, refLow: 1.0, refHigh: 2.6 },
  speaking_rate: { min: 0.45, max: 1.9, refLow: 0.85, refHigh: 1.45 },
  voiced_segments_per_sec: { min: 0.25, max: 1.9, refLow: 0.9, refHigh: 1.45 },
  mean_pause_length: { min: 0.1, max: 1.3, refLow: 0.35, refHigh: 0.75 },
  mean_voiced_length: { min: 0.05, max: 0.24, refLow: 0.09, refHigh: 0.16 },
};

export default function SessionSummaryPanel({
  report,
  onClose,
  showCloseButton = true,
  autoGenerateAI = true,
  initialSections,
}: SessionSummaryPanelProps) {
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SummaryTab>("insights");

  const [aiSections, setAiSections] = useState<StructuredSummarySections>(
    initialSections || {},
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const actionMessage = useMemo(
    () => formatActionResult(report.action_result),
    [report.action_result],
  );

  const acoustics = report.content.acoustic_features;
  const phonemes = useMemo(
    () => sanitizePhonemeStream(report.content.phonemes || []),
    [report.content.phonemes],
  );
  const transcription = report.content.user_transcription || "";
  const phonemeParagraph = useMemo(() => formatPhonemeParagraph(phonemes), [phonemes]);
  const disfluencyCount = (report.content.dys_detect || []).filter(
    (d) => d.dysfluency_type !== "normal",
  ).length;

  const flaggedPhonemes = useMemo(
    () =>
      new Set(
        (report.content.dys_detect || [])
          .filter((item) => item.dysfluency_type !== "normal")
          .map((item) => normalizePhonemeSymbol(item.phoneme))
          .filter((item): item is string => Boolean(item)),
      ),
    [report.content.dys_detect],
  );

  const topEstimates = useMemo(
    () => [...(report.estimates ?? [])].sort((a, b) => b.score - a.score),
    [report.estimates],
  );

  const topSignals = useMemo(
    () => topEstimates.filter((estimate) => estimate.key !== "age_gender_proxy"),
    [topEstimates],
  );

  const insightSignalCards = useMemo(
    () => buildSignalCards(topSignals, aiSections),
    [topSignals, aiSections],
  );

  const hasElevatedSignal = useMemo(
    () => insightSignalCards.some((card) => card.score > 50),
    [insightSignalCards],
  );

  useEffect(() => {
    let cancelled = false;

    const shouldGenerate =
      autoGenerateAI && Object.values(aiSections).every((v) => !v || !v.trim());
    if (!shouldGenerate) return;

    const run = async () => {
      setAiLoading(true);
      setAiError(null);
      try {
        const sections = await fetchStructuredAIReport(report);
        if (!cancelled) setAiSections(sections);
      } catch (err) {
        if (!cancelled) {
          setAiError(err instanceof Error ? err.message : "Could not generate AI summary.");
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [autoGenerateAI, report, aiSections]);

  const handleExportPdf = async () => {
    if (exportLoading) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const url = await exportSummaryPdf(report);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={headerRowStyle}>
        <div>
          <h2 style={titleStyle}>Session Summary</h2>
          <p style={subtitleStyle}>
            {report.segment} session · {report.duration_seconds.toFixed(1)}s
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleExportPdf} disabled={exportLoading} style={btnOutlineStyle}>
            {exportLoading ? "Exporting..." : "Export PDF"}
          </button>
          {showCloseButton && onClose && (
            <button onClick={onClose} style={btnStyle}>
              Back to Home
            </button>
          )}
        </div>
      </div>

      {exportError && <p style={errorStyle}>{exportError}</p>}
      {actionMessage && (
        <p
          style={{
            margin: 0,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text-secondary)",
            fontSize: 12,
          }}
        >
          {actionMessage}
        </p>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <TabButton
          active={activeTab === "insights"}
          onClick={() => setActiveTab("insights")}
          label="Insights"
        />
        <TabButton
          active={activeTab === "signalData"}
          onClick={() => setActiveTab("signalData")}
          label="Signal Data"
        />
      </div>

      {activeTab === "insights" && (
        <>
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Speech Alignment</h3>
            <div style={alignmentContainerStyle}>
              <div style={alignmentFlowBoxStyle}>
                <p style={{ ...alignmentWordLabelStyle, margin: "0 0 6px" }}>Transcript</p>
                <p style={{ ...paragraphStyle, margin: 0 }}>{transcription || "No transcription captured."}</p>
              </div>

              <div style={alignmentFlowBoxStyle}>
                <p style={{ ...alignmentWordLabelStyle, margin: "0 0 6px" }}>Phoneme Stream</p>
                <p
                  style={{
                    ...paragraphStyle,
                    margin: 0,
                    fontFamily: "monospace",
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: "var(--text-secondary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {phonemeParagraph || "No phonemes detected."}
                </p>
              </div>

              {flaggedPhonemes.size > 0 && (
                <div style={alignmentInsightsBoxStyle}>
                  <p style={{ ...alignmentWordLabelStyle, margin: 0 }}>Specific Insights</p>
                  <p style={{ ...plainRowStyle, margin: "6px 0 0" }}>
                    Dysfluency-marked phoneme symbols detected: {Array.from(flaggedPhonemes).slice(0, 12).join(", ")}.
                  </p>
                </div>
              )}
            </div>
          </section>
          
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Top Signals</h3>
            <div style={signalLegendStyle}>
              <span style={legendItemStyle}>
                <span style={{ ...legendDotStyle, background: "rgba(59,130,246,0.9)" }} />
                0–50 (lower signal)
              </span>
              <span style={legendItemStyle}>
                <span style={{ ...legendDotStyle, background: "rgba(245,158,11,0.95)" }} />
                51–100 (elevated signal)
              </span>
            </div>
            {!hasElevatedSignal && (
              <p style={{ ...paragraphStyle, color: "var(--text-secondary)", margin: "-2px 0 10px", fontSize: 12 }}>
                No elevated exploratory signals in this sample. Cards below are shown for baseline monitoring.
              </p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {insightSignalCards.map((card) => (
                <SignalCornerCard key={card.id} card={card} />
              ))}
            </div>
            {aiLoading && <p style={{ ...paragraphStyle, color: "var(--text-muted)", marginTop: 10 }}>Generating signal interpretations…</p>}
            {aiError && <p style={{ ...errorStyle, marginTop: 10 }}>{aiError}</p>}
          </section>

        </>
      )}

      {activeTab === "signalData" && (
        <>
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Features</h3>
            {acoustics ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(Object.keys(ACOUSTIC_META) as (keyof AcousticFeatures)[]).map((key) => {
                  const metric = ACOUSTIC_META[key];
                  const val = acoustics[key];
                  if (val == null) return null;
                  const barPercent = acousticBarPercent(key, val);
                  const refBand = acousticReferenceBand(key);
                  return (
                    <div key={key} style={metricRowStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{metric.label}</span>
                        <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 600 }}>
                          {val.toFixed(3)} {metric.unit}
                        </span>
                      </div>
                      <div style={acousticBarTrackStyle}>
                        <div style={{ ...acousticBarFillStyle, width: `${barPercent}%` }} />
                        <div
                          style={{
                            ...acousticRangeConnectorStyle,
                            left: `${refBand.start}%`,
                            width: `${Math.max(2, refBand.end - refBand.start)}%`,
                          }}
                        />
                        <div
                          style={{
                            ...acousticRangeBracketStyle,
                            left: `calc(${refBand.start}% - 1px)`,
                            borderLeft: "2px solid rgba(5,150,105,0.9)",
                          }}
                        />
                        <div
                          style={{
                            ...acousticRangeBracketStyle,
                            left: `calc(${refBand.end}% - 7px)`,
                            borderRight: "2px solid rgba(5,150,105,0.9)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={paragraphStyle}>No acoustic feature data available for this session.</p>
            )}
          </section>
        </>
      )}

      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
        This is a research tool, not a medical diagnosis. Interpret estimates with caution and confirm through formal assessment.
      </p>
    </div>
  );
}

function formatActionResult(action?: SummaryActionResult): string | null {
  if (!action) return null;
  if (action.status === "forwarded") {
    return `Action taken: forwarded to clinician${action.recipient ? ` (${action.recipient})` : ""}.`;
  }

  if (action.status === "error") {
    return "Action attempt failed; report was generated but forwarding did not complete.";
  }

  if (action.reason === "below_threshold") {
    return "No forwarding action taken: risk signal did not cross threshold.";
  }

  if (action.reason === "recipient_not_allowlisted") {
    return "No forwarding action taken: recipient is not allowlisted.";
  }

  if (action.reason === "opt_in_required") {
    return "No forwarding action taken: forwarding opt-in is required.";
  }

  if (action.reason === "feature_disabled") {
    return "No forwarding action taken: action forwarding is disabled.";
  }

  return "No forwarding action taken for this session.";
}

function SignalCornerCard({ card }: { card: SignalCard }) {
  const [showFormula, setShowFormula] = useState(false);
  const tone = signalToneByScore(card.score);
  const width = Math.max(0, Math.min(100, card.score));
  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${tone.border}`,
        borderRadius: 12,
        padding: "12px 12px 10px",
        background: tone.bg,
        overflow: "hidden",
        minHeight: 180,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${width}%`,
          background: tone.progress,
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{ position: "absolute", top: 0, right: 0 }}
          onMouseEnter={() => setShowFormula(true)}
          onMouseLeave={() => setShowFormula(false)}
        >
          <button
            type="button"
            aria-label={`${card.label} calculation details`}
            style={infoIconButtonStyle}
            onFocus={() => setShowFormula(true)}
            onBlur={() => setShowFormula(false)}
          >
            i
          </button>
          {showFormula && <div style={infoTooltipStyle}>{card.calculation}</div>}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text)", fontWeight: 800 }}>
          {card.rank}. {card.label}
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Score {card.score}/100</p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
          {card.suggestion}
        </p>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            background: "rgba(255,255,255,0.55)",
            borderRadius: 8,
            padding: "6px 8px",
          }}
        >
          {card.insightSnippet}
        </p>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
      <p style={{ margin: "0 0 2px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text)", fontWeight: 700, lineHeight: 1.4 }}>
        {value}
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        borderRadius: 999,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        background: active ? "var(--blue)" : "var(--bg-subtle, #f0f1f3)",
        color: active ? "#fff" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );
}

function signalToneByScore(score: number): {
  bg: string;
  border: string;
  progress: string;
} {
  if (score <= 50) {
    return { bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.40)", progress: "#3b82f6" };
  } else if (score <= 100) {
    return { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.40)", progress: "#f59e0b" };
  }
  return { bg: "rgba(15,23,42,0.06)", border: "rgba(15,23,42,0.22)", progress: "#334155" };
}

type SignalCard = {
  id: string;
  rank: number;
  key: string;
  label: string;
  score: number;
  suggestion: string;
  insightSnippet: string;
  calculation: string;
};

function buildSignalCards(
  estimates: SummaryEstimate[],
  sections: StructuredSummarySections,
): SignalCard[] {
  const byKey = new Map(estimates.map((estimate) => [estimate.key, estimate]));
  const config: Array<{
    id: string;
    key: string;
    rank: number;
    label: string;
    section: keyof StructuredSummarySections;
    calculation: string;
  }> = [
    {
      id: "intoxication",
      key: "intoxication_slur",
      rank: 1,
      label: "Intoxication",
      section: "exploratory_risk_signals",
      calculation: "Weighted evidence from jitter, shimmer, pause length, speech rate, and disfluency pressure, then reduced by quality/noise/coverage skepticism penalties.",
    },
    {
      id: "aphasia",
      key: "aphasia_pattern",
      rank: 2,
      label: "Aphasia",
      section: "fluency",
      calculation: "Weighted evidence from disfluency pressure, voiced-rate suppression, pauses, lexical sparsity/repetition, then reduced by quality/noise/coverage skepticism penalties.",
    },
    {
      id: "respiratory",
      key: "voice_strain_resp",
      rank: 3,
      label: "Respiratory Illness",
      section: "voice_quality",
      calculation: "Weighted evidence from low HNR, shimmer, jitter, voiced-segment shortening, and loudness instability, then reduced by quality/noise/coverage skepticism penalties.",
    },
    {
      id: "tiredness",
      key: "cognitive_fatigue",
      rank: 4,
      label: "Tiredness",
      section: "prosody_rhythm",
      calculation: "Weighted evidence from pause burden, slowed pacing, flatter prosody, disfluency pressure, and low loudness, then reduced by quality/noise/coverage skepticism penalties.",
    },
  ];

  return config.map((item) => {
    const estimate = byKey.get(item.key);
    return {
      id: item.id,
      rank: item.rank,
      key: item.key,
      label: item.label,
      score: estimate?.score ?? 0,
      suggestion: estimate?.suggestion ?? "Signal not detected in this sample.",
      insightSnippet:
        (sections[item.section] || sections.exploratory_risk_signals || "AI interpretation not available yet.")
          .trim()
          .replace(/\s+/g, " "),
      calculation: item.calculation,
    };
  });
}


function normalizePhonemeSymbol(raw: string): string | null {
  const cleaned = String(raw || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim();
  if (!cleaned) return null;
  if (/^[.,!?;:()\[\]{}]+$/.test(cleaned)) return null;
  return cleaned;
}

function sanitizePhonemeStream(stream: string[]): string[] {
  return (stream || [])
    .map((item) => normalizePhonemeSymbol(item))
    .filter((item): item is string => Boolean(item));
}

function formatPhonemeParagraph(phonemes: string[]): string {
  if (!phonemes.length) return "—";
  const mostlySingleChar = phonemes.filter((token) => token.length <= 1).length >= phonemes.length * 0.75;
  return mostlySingleChar ? phonemes.join("") : phonemes.join(" ");
}

const infoIconButtonStyle: CSSProperties = {
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.9)",
  color: "var(--text-secondary)",
  width: 18,
  height: 18,
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: "16px",
  textAlign: "center",
  padding: 0,
  cursor: "help",
};

const infoTooltipStyle: CSSProperties = {
  position: "absolute",
  top: 24,
  right: 0,
  zIndex: 5,
  width: 280,
  background: "#111827",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 11,
  lineHeight: 1.45,
  boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
};

const sectionStyle: CSSProperties = {
  background: "var(--bg-subtle, #f8f9fb)",
  borderRadius: 12,
  padding: "12px 14px",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 6px",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
};

const paragraphStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--text)",
  lineHeight: 1.6,
};

const plainRowStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const signalLegendStyle: CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "center",
  flexWrap: "wrap",
  margin: "0 0 10px",
  fontSize: 12,
  color: "var(--text-secondary)",
};

const legendItemStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const legendDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  display: "inline-block",
};

const metricRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  borderBottom: "1px solid var(--border-light)",
  paddingBottom: 8,
};

const alignmentContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const alignmentFlowBoxStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "10px 12px",
  background: "#fff",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--text)",
  whiteSpace: "pre-wrap",
};

const alignmentWordStackStyle: CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "flex-start",
  verticalAlign: "bottom",
  marginRight: 2,
};

const alignmentWordLabelStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const alignmentWordInlineStyle: CSSProperties = {
  borderRadius: 4,
};

const alignmentMismatchWordStyle: CSSProperties = {
  background: "rgba(245,158,11,0.22)",
  borderBottom: "2px solid rgba(245,158,11,0.85)",
  borderRadius: 4,
  padding: "1px 2px",
};

const alignmentPhonemeGuideStyle: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  color: "var(--text-muted)",
  marginTop: 2,
};

const alignmentSpacerStyle: CSSProperties = {
  whiteSpace: "pre",
};

const alignmentInsightsBoxStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "rgba(255,255,255,0.78)",
};

const acousticBarTrackStyle: CSSProperties = {
  height: 8,
  width: "100%",
  position: "relative",
  borderRadius: 999,
  background: "rgba(148,163,184,0.18)",
  border: "1px solid var(--border-light)",
  overflow: "hidden",
};

const acousticRangeBracketStyle: CSSProperties = {
  position: "absolute",
  top: -5,
  width: 8,
  height: 18,
  borderTop: "2px solid rgba(5,150,105,0.9)",
  borderBottom: "2px solid rgba(5,150,105,0.9)",
  zIndex: 3,
  pointerEvents: "none",
};

const acousticRangeConnectorStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  height: 2,
  transform: "translateY(-50%)",
  background: "rgba(5,150,105,0.95)",
  borderRadius: 999,
  zIndex: 3,
  pointerEvents: "none",
};

const acousticBarFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, rgba(59,130,246,0.55), rgba(59,130,246,0.9))",
  boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.25)",
  position: "relative",
  zIndex: 2,
};

function acousticBarPercent(key: keyof AcousticFeatures, value: number): number {
  const bounds = ACOUSTIC_BAR_BOUNDS[key];
  if (!bounds || bounds.max <= bounds.min) return 0;
  const normalized = ((value - bounds.min) / (bounds.max - bounds.min)) * 100;
  return Math.max(0, Math.min(100, normalized));
}

function acousticReferenceBand(key: keyof AcousticFeatures): { start: number; end: number } {
  const bounds = ACOUSTIC_BAR_BOUNDS[key];
  if (!bounds || bounds.max <= bounds.min) return { start: 0, end: 0 };
  const start = ((bounds.refLow - bounds.min) / (bounds.max - bounds.min)) * 100;
  const end = ((bounds.refHigh - bounds.min) / (bounds.max - bounds.min)) * 100;
  return {
    start: Math.max(0, Math.min(100, start)),
    end: Math.max(0, Math.min(100, end)),
  };
}

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: "var(--text)",
  fontSize: 24,
  fontWeight: 700,
};

const subtitleStyle: CSSProperties = {
  margin: "4px 0 0",
  color: "var(--text-muted)",
  fontSize: 13,
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "var(--red)",
  fontSize: 12,
};

const btnStyle: CSSProperties = {
  background: "var(--blue)",
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const btnOutlineStyle: CSSProperties = {
  background: "transparent",
  color: "var(--blue)",
  border: "2px solid var(--blue)",
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
