import type { StructuredSummarySections, SummaryReport } from "@/lib/types";

export const SUMMARY_PREVIEW_REPORT: SummaryReport = {
  report_id: "sum_preview_64s",
  created_at: "2026-02-15T12:00:00.000Z",
  segment: "conversation",
  duration_seconds: 64.0,
  quality: {
    score: 68.2,
    grade: "B",
    noise_likelihood: 0.34,
    summary:
      "Data quality is acceptable for exploratory interpretation, with moderate noise susceptibility. Repeat sessions in cleaner conditions improve stability.",
    penalties: [
      "Moderate loudness variability may partially reflect room dynamics.",
      "HNR suggests some background contamination in portions of the sample.",
    ],
  },
  executive_summary: {
    quality_statement:
      "Session quality supports directional analysis. Signal stability is sufficient for structured follow-up but not definitive conclusions.",
    top_flags: [
      { title: "Voice Strain / Respiratory Effort Indicator", level: "exploratory-moderate", score: 72 },
      { title: "Slurred Speech / Intoxication Likelihood", level: "exploratory-moderate", score: 67 },
      { title: "Cognitive Load / Fatigue Proxy", level: "exploratory-moderate", score: 63 },
    ],
    recommended_followups: [
      "Repeat protocol in a quieter room with fixed microphone distance.",
      "Track pause-length and voice stability over three sessions.",
      "If persistence is observed, consider targeted SLP screening.",
    ],
  },
  estimates: [
    {
      key: "voice_strain_resp",
      title: "Voice Strain / Respiratory Effort Indicator",
      score: 72,
      level: "exploratory-moderate",
      is_estimate: true,
      evidence: ["HNR 4.13 dB", "Shimmer 1.619 dB", "Jitter 0.027"],
      limitations: ["Single-session estimate only"],
      suggestion: "Monitor hydration, rest, and vocal load; compare against baseline week-over-week.",
    },
    {
      key: "intoxication_slur",
      title: "Slurred Speech / Intoxication Likelihood",
      score: 67,
      level: "exploratory-moderate",
      is_estimate: true,
      evidence: ["Jitter 0.027", "Shimmer 1.619 dB", "Mean pause 0.94s"],
      limitations: ["Pattern can overlap with fatigue or stress"],
      suggestion: "Use as a context cue only; confirm with behavioral and medical context.",
    },
    {
      key: "cognitive_fatigue",
      title: "Cognitive Load / Fatigue Proxy",
      score: 63,
      level: "exploratory-moderate",
      is_estimate: true,
      evidence: ["Speaking rate 0.589 peaks/s", "Pause 0.941s", "Disfluency 29"],
      limitations: ["Conversation complexity affects pacing"],
      suggestion: "Compare against morning baseline and monitor directional shifts.",
    },
  ],
  limitations: [
    "Exploratory speech biomarkers are probabilistic, not diagnostic outcomes.",
    "Single-session inference may be confounded by stress, sleep, illness, or microphone quality.",
  ],
  content: {
    user_transcription:
      "Yes, I'm ready. I'm feeling pretty good here. Good. Yes. Good. The sun a shining Please keep the door open. The cat stretched out on the rug.",
    ai_transcription: "(no assistant text captured)",
    phonemes: [
      "e", "ɛ", "s", "s", "aɪ", "m", "s", "aɪ", "m", "ɛ", "m", "r", "ɛ", "d", "i", "d", "ɛ", "m", "f", "ɪ", "l", "ɪ", "ŋ", "p", "r", "ɪ", "t", "i", "ŋ", "ʊ", "d",
    ],
    dys_detect: [],
    acoustic_features: {
      f0_mean: 28.641,
      f0_std: 0.375,
      jitter: 0.027,
      shimmer_db: 1.619,
      hnr: 4.129,
      loudness_mean: 0.123,
      loudness_std: 2.719,
      speaking_rate: 0.589,
      voiced_segments_per_sec: 0.853,
      mean_pause_length: 0.941,
      mean_voiced_length: 0.105,
    },
  },
};

export const SUMMARY_PREVIEW_AI_SECTIONS: StructuredSummarySections = {
  overview:
    "This 64-second sample supports exploratory trend tracking with moderate signal quality. The strongest indicators are vocal effort and timing variability.",
  voice_quality:
    "Shimmer is elevated and HNR is low, which can reflect vocal strain or environmental noise. Track these values across repeat sessions before drawing stronger conclusions.",
  fluency:
    "Disfluency burden is elevated in this run, but prompt complexity can inflate counts. Repeated task-matched samples are needed to confirm a stable fluency pattern.",
  prosody_rhythm:
    "Pause length and speaking rate suggest slower rhythm efficiency in parts of the sample. A controlled retest can separate baseline style from temporary load effects.",
  exploratory_risk_signals:
    "Top exploratory categories are voice strain/respiratory effort, slur-like articulation, and cognitive fatigue. Use them as follow-up cues, not endpoint conclusions.",
  confidence_limitations:
    "Uncertainty remains high because this is a single noisy sample. Replication in cleaner conditions is required before high-impact interpretation.",
  follow_up:
    "Repeat the same prompt set across at least three quieter sessions. Track HNR, shimmer, pause length, and rank stability over time.",
};
