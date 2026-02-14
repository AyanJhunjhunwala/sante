export type Segment = "speech" | "health" | "stress";

export type TurnRole = "user" | "assistant";

export interface Turn {
  id: number;
  role: TurnRole;
  text: string;
  status: "draft" | "final";
  createdAt: number;
}

export interface StressScore {
  value: number; // 0.0 – 1.0
  confidence: number; // 0 – 100
  isEstimate: boolean; // true = live heuristic, false = RunPod final
  updatedAt: number;
}

export interface SpeechMetrics {
  disfluency: number;
  pacing: number; // 1.0 = normal
  wpm: number | null;
  updatedAt: number;
}

export interface AnalysisResults {
  prediction: "STRESSED" | "NOT STRESSED" | "UNKNOWN";
  confidence: number;
  stressed: number; // percentage
  notStressed: number; // percentage
}

// Session summary report (from /api/session-summary)
export interface SummaryMetric {
  name: string;
  score: number;
  confidence: number;
}

export interface SummaryReport {
  report_id: string;
  created_at: string;
  segment: string;
  duration_seconds: number;
  provenance: Record<string, unknown>;
  executive_summary: {
    accent_prediction: string;
    accent_confidence: number;
    top_flags: { label: string; score: number; confidence: number }[];
  };
  content: {
    phonemes: string[];
    user_transcription: string;
    ai_transcription: string;
    stress_binary: string;
  };
  speaker_traits: {
    age_range_estimate: string;
    gender_probabilities: { female: number; male: number };
  };
  metrics: SummaryMetric[];
  ai_summary: string;
}

// WebSocket server → client message union
export type WSServerMessage =
  | { type: "connected"; session_id: string; segment: string }
  | { type: "waveform"; data: number[] }
  | {
      type: "stress_score";
      value: number;
      confidence: number;
      is_estimate: boolean;
    }
  | {
      type: "speech_metrics";
      disfluency: number;
      pacing: number;
      wpm: number | null;
    }
  | { type: "transcript_ack" }
  | { type: "session_complete"; summary: Record<string, unknown> }
  | { type: "error"; message: string };
