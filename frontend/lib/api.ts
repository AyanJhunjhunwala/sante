import type { AnalysisResults, SummaryReport } from "./types";

/** Fetch an ephemeral OpenAI Realtime token for the given segment. */
export async function fetchEphemeralToken(segment: string): Promise<string> {
  const res = await fetch(`/token/${segment}`);
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
  dys_detect: string[];
}> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");
  if (refText) form.append("ref_text", refText);

  const res = await fetch("/api/analyze/phonemes", {
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

/** Upload audio blob to the stress analysis endpoint. */
export async function analyzeStress(audioBlob: Blob): Promise<AnalysisResults> {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");

  const res = await fetch("/api/analyze/stress", {
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

/** Fetch biomarker summary report for any completed session. */
export async function fetchSessionSummary(payload: {
  segment: string;
  user_transcription: string;
  ai_transcription: string;
  duration_seconds: number;
  detected_phonemes?: string[];
  detected_dys_detect?: string[];
}): Promise<SummaryReport> {
  const res = await fetch("/api/session-summary", {
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

/** Chat with the summary AI about a report. */
export async function fetchSummaryChatReply(
  report: SummaryReport,
  message: string,
): Promise<string> {
  const res = await fetch("/api/session-summary/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report, message }),
  });

  if (!res.ok) return "Sorry, I couldn't process that.";
  const data = (await res.json()) as { reply: string };
  return data.reply || "No reply.";
}
