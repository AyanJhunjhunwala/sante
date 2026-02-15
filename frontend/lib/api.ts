import type { AnalysisResults, DysfluencyEntry, SummaryReport } from "./types";
import { BACKEND_URL } from "./constants";

/** Fetch an ephemeral OpenAI Realtime token for the conversation workflow. */
export async function fetchEphemeralToken(
  segment: string = "conversation",
): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/token/${segment}`);
  if (!res.ok) {
    const text = await res.text();
    let detail = text.trim();

    if (text) {
      try {
        const parsed = JSON.parse(text) as {
          detail?: unknown;
          message?: unknown;
        };
        if (typeof parsed.detail === "string" && parsed.detail.trim()) {
          detail = parsed.detail;
        } else if (
          typeof parsed.message === "string" &&
          parsed.message.trim()
        ) {
          detail = parsed.message;
        }
      } catch {
        // Keep raw text fallback
      }
    }

    throw new Error(detail || `Token fetch failed (${res.status})`);
  }
  const data = await res.json();
  const key = data.value ?? data.client_secret?.value;
  if (!key) throw new Error("No ephemeral key in response");
  return key;
}

/** Upload full session audio to the phoneme analysis endpoint. */
export async function analyzePhonemes(
  audioBlob: Blob,
  refText: string = "",
): Promise<{
  ref_phonemes: string[];
  decode_phonemes: string[];
  dys_detect: { dysfluency_type: string; phoneme: string; start_state: number; end_state: number }[];
}> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");
  if (refText) form.append("ref_text", refText);

  const res = await fetch(`${BACKEND_URL}/api/analyze/phonemes`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail || "Phoneme analysis failed",
    );
  }
  return res.json();
}

/** Upload full session audio to the transcription endpoint. */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");

  const res = await fetch(`${BACKEND_URL}/api/analyze/transcript`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      throw new Error(detail);
    }

    const detailObj = detail as {
      message?: unknown;
      request_id?: unknown;
    };
    const message =
      typeof detailObj?.message === "string" && detailObj.message.trim()
        ? detailObj.message
        : "Transcription failed";
    const requestId =
      typeof detailObj?.request_id === "string" && detailObj.request_id.trim()
        ? ` (request: ${detailObj.request_id})`
        : "";
    throw new Error(`${message}${requestId}`);
  }

  const data = (await res.json()) as {
    transcript?: string;
    status?: string;
    request_id?: string;
  };
  const transcript = (data.transcript || "").trim();
  if (data.status !== "ok" || !transcript) {
    throw new Error(
      `No speech transcript detected from uploaded audio${data.request_id ? ` (request: ${data.request_id})` : ""}.`,
    );
  }

  return transcript;
}

/** Upload audio blob to the stress analysis endpoint. */
export async function analyzeStress(audioBlob: Blob): Promise<AnalysisResults> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");

  const res = await fetch(`${BACKEND_URL}/api/analyze/stress`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail || "Analysis failed");
  }

  const raw = await res.json();
  return {
    prediction: raw.prediction ?? "UNKNOWN",
    confidence: raw.confidence ?? 0,
    stressed: raw.stressed ?? 0,
    notStressed: raw.not_stressed ?? 0,
  };
}

/** Upload audio blob to the acoustic features endpoint. */
export async function analyzeAcoustics(audioBlob: Blob): Promise<{
  f0_mean: number;
  f0_std: number;
  jitter: number;
  shimmer_db: number;
  hnr: number;
  loudness_mean: number;
  loudness_std: number;
  speaking_rate: number;
  voiced_segments_per_sec: number;
  mean_pause_length: number;
  mean_voiced_length: number;
}> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");

  const res = await fetch(`${BACKEND_URL}/api/analyze/acoustics`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail || "Acoustic analysis failed",
    );
  }
  return res.json();
}

/** Fetch session report for any completed session. */
export async function fetchSessionSummary(payload: {
  segment: string;
  user_transcription: string;
  ai_transcription: string;
  duration_seconds: number;
  detected_phonemes?: string[];
  detected_dys_detect?: DysfluencyEntry[];
  acoustic_features?: Record<string, number> | null;
  forward_opt_in?: boolean;
  forward_recipient?: string;
}): Promise<SummaryReport> {
  const res = await fetch(`${BACKEND_URL}/api/session-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail || "Summary generation failed",
    );
  }

  return (await res.json()) as SummaryReport;
}

/** Fetch Read Aloud phase instructions from backend. */
export async function fetchReadAloudPrompt(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/token/read-aloud-prompt`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
        if (typeof parsed.detail === "string" && parsed.detail.trim()) {
          detail = parsed.detail;
        } else if (typeof parsed.message === "string" && parsed.message.trim()) {
          detail = parsed.message;
        }
      } catch {
        // Keep raw text fallback
      }
    }
    throw new Error(
      detail || `Failed to fetch Read Aloud prompt (${res.status})`,
    );
  }
  const data = await res.json();
  return data.instructions;
}

/** Generate an AI narrative report from session data. */
export async function fetchAIReport(
  report: SummaryReport,
): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/session-summary/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail || "Report generation failed",
    );
  }
  const data = (await res.json()) as { report: string };
  return data.report || "No report generated.";
}

/** Generate sectioned AI summary narrative for streamlined report rendering. */
export async function fetchStructuredAIReport(
  report: SummaryReport,
): Promise<Record<string, string>> {
  const res = await fetch(`${BACKEND_URL}/api/session-summary/report-structured`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail || "Structured report generation failed",
    );
  }

  const data = (await res.json()) as { sections?: Record<string, string> };
  return data.sections || {};
}

/** Chat with the summary AI about a report. */
export async function fetchSummaryChatReply(
  report: SummaryReport,
  message: string,
): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/session-summary/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report, message }),
  });

  if (!res.ok) return "Sorry, I couldn't process that.";
  const data = (await res.json()) as { reply: string };
  return data.reply || "No reply.";
}

/** Create a PDF export for the current summary report and return static URL path. */
export async function exportSummaryPdf(report: SummaryReport): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/session-summary/export-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (err as { detail?: string }).detail || "PDF export failed",
    );
  }

  const data = (await res.json()) as { url: string };
  if (!data.url) throw new Error("Export URL missing");
  return `${BACKEND_URL}${data.url}`;
}
