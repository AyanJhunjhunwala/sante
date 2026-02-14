import type { AnalysisResults } from "./types";

/** Fetch an ephemeral OpenAI Realtime token for the given segment. */
export async function fetchEphemeralToken(segment: string): Promise<string> {
  const res = await fetch(`/token/${segment}`);
  if (!res.ok) {
    const text = await res.text();
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

    throw new Error(detail || `Token fetch failed (${res.status})`);
  }
  const data = await res.json();
  const key = data.value ?? data.client_secret?.value;
  if (!key) throw new Error("No ephemeral key in response");
  return key;
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
