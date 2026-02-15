export type Segment = "conversation";

export type SessionPhase = "conversation" | "read_aloud";

export type TurnRole = "user" | "assistant";

export interface Turn {
  id: number;
  role: TurnRole;
  text: string;
  status: "draft" | "final";
  phase: SessionPhase;
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

export interface PitchPoint {
  time: number; // elapsed seconds
  f0: number | null; // Hz or null if unvoiced
}

export interface WPMPoint {
  time: number; // elapsed seconds
  wpm: number;
}

export interface AnalysisResults {
  prediction: "STRESSED" | "NOT STRESSED" | "UNKNOWN";
  confidence: number;
  stressed: number; // percentage
  notStressed: number; // percentage
}

// Session summary report (from /api/session-summary)
export interface DysfluencyEntry {
  dysfluency_type: string;
  phoneme: string;
  start_state: number;
  end_state: number;
}

export interface AcousticFeatures {
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
}

export interface SummaryQuality {
  score: number;
  grade: "A" | "B" | "C" | "D";
  noise_likelihood: number;
  summary: string;
  penalties: string[];
}

export interface SummaryEstimate {
  key: string;
  title: string;
  score: number;
  level: string;
  is_estimate: boolean;
  evidence: string[];
  limitations: string[];
  suggestion: string;
}

export interface SummaryExecutiveItem {
  title: string;
  level: string;
  score: number;
}

export interface SummaryExecutive {
  top_flags: SummaryExecutiveItem[];
  quality_statement: string;
  recommended_followups: string[];
}

export interface StructuredSummarySections {
  overview?: string;
  voice_quality?: string;
  fluency?: string;
  prosody_rhythm?: string;
  exploratory_risk_signals?: string;
  confidence_limitations?: string;
  follow_up?: string;
}

export interface SummaryActionResult {
  status: string;
  reason?: string;
  recipient?: string;
  source?: string;
  signal_score?: number;
  threshold?: number;
  error?: string;
  send?: {
    sid?: string | null;
    status?: string;
    error?: string | null;
  };
}

export interface SummaryReport {
  report_id: string;
  created_at: string;
  segment: string;
  duration_seconds: number;
  quality?: SummaryQuality;
  estimates?: SummaryEstimate[];
  executive_summary?: SummaryExecutive;
  limitations?: string[];
  action_result?: SummaryActionResult;
  content: {
    user_transcription: string;
    ai_transcription: string;
    phonemes: string[];
    dys_detect: DysfluencyEntry[];
    acoustic_features: AcousticFeatures | null;
  };
}

// WebSocket server → client message union
export type WSServerMessage =
  | { type: "connected"; session_id: string; segment: string }
  | { type: "waveform"; data: number[] }
  | { type: "pitch"; f0: number | null }
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
