"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  AnalysisResults,
  PitchPoint,
  Segment,
  SessionPhase,
  SpeechMetrics,
  StressScore,
  SummaryReport,
  Turn,
  WPMPoint,
} from "@/lib/types";
import { VAD_THRESHOLD_DEFAULT } from "@/lib/constants";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface SessionState {
  // Session identity
  segment: Segment | null;
  sessionId: string | null;
  connectionStatus: "idle" | "connecting" | "active" | "ending";

  // WebRTC
  isMuted: boolean;
  aiSpeaking: boolean;
  userMutedBeforeAI: boolean;

  // Transcript
  conversationLog: Turn[];
  turnSequence: number;

  // Session phase tracking
  sessionPhase: SessionPhase;
  phaseStartTurnId: number; // turnSequence value when current phase started

  // Session timer (safety fallback)
  sessionDeadline: number; // epoch ms, 0 = not started
  remainingMs: number;

  // Audio turn detection sensitivity
  vadThreshold: number;

  // Real-time analysis (from WebSocket)
  waveformData: number[];
  stressScore: StressScore | null;
  speechMetrics: SpeechMetrics | null;

  // Live graphs
  sessionStartedAt: number; // epoch ms, set when session starts
  pitchHistory: PitchPoint[];
  wpmHistory: WPMPoint[];
  totalWordCount: number;

  // Speaking time tracking (excludes AI speaking periods)
  speakingStartedAt: number; // epoch ms when user last unmuted, 0 = muted
  totalSpeakingMs: number; // accumulated ms the user has been unmuted

  // Post-session results
  analysisResults: AnalysisResults | null;
  summaryReport: SummaryReport | null;
  resultsStatus: "idle" | "loading" | "success" | "error";
  resultsError: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface SessionActions {
  // Lifecycle
  startSession: (segment: Segment) => void;
  setConnectionStatus: (s: SessionState["connectionStatus"]) => void;
  endSession: () => void;
  resetSession: () => void;

  // WebRTC
  setMuted: (muted: boolean) => void;
  setAiSpeaking: (speaking: boolean) => void;
  setVadThreshold: (threshold: number) => void;

  // Transcript
  appendDraftDelta: (delta: string) => void;
  finalizeLastAssistantTurn: () => void;
  appendUserTurn: (text: string) => void;
  resetConversationLog: () => void;

  // Phase
  setSessionPhase: (phase: SessionPhase) => void;

  // Timer
  setSessionDeadline: (deadline: number) => void;
  tickTimer: () => void;

  // Real-time analysis
  updateWaveform: (data: number[]) => void;
  updateStressScore: (
    value: number,
    confidence: number,
    isEstimate: boolean,
  ) => void;
  updateSpeechMetrics: (d: number, pacing: number, wpm: number | null) => void;

  // Live graphs
  appendPitch: (f0: number | null) => void;
  appendUserWords: (text: string) => void;

  // Post-session results
  setResultsLoading: () => void;
  setResultsSuccess: (results: AnalysisResults) => void;
  setSummaryReport: (report: SummaryReport) => void;
  setResultsError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: SessionState = {
  segment: null,
  sessionId: null,
  connectionStatus: "idle",
  isMuted: false,
  aiSpeaking: false,
  userMutedBeforeAI: false,
  conversationLog: [],
  turnSequence: 0,
  sessionPhase: "conversation",
  phaseStartTurnId: 0,
  sessionDeadline: 0,
  remainingMs: 60_000,
  vadThreshold: VAD_THRESHOLD_DEFAULT,
  waveformData: [],
  stressScore: null,
  speechMetrics: null,
  sessionStartedAt: 0,
  pitchHistory: [],
  wpmHistory: [],
  totalWordCount: 0,
  speakingStartedAt: 0,
  totalSpeakingMs: 0,
  analysisResults: null,
  summaryReport: null,
  resultsStatus: "idle",
  resultsError: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSessionStore = create<SessionState & SessionActions>()(
  devtools(
    (set) => ({
      ...initialState,

      startSession: (segment) =>
        set({
          ...initialState,
          segment,
          sessionId: crypto.randomUUID(),
          connectionStatus: "connecting",
          sessionStartedAt: Date.now(),
        }),

      setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

      endSession: () => set({ connectionStatus: "ending" }),

      resetSession: () => set(initialState),

      setMuted: (isMuted) =>
        set((s) => {
          const now = Date.now();
          if (isMuted && s.speakingStartedAt > 0) {
            // User just muted — accumulate speaking time
            return {
              isMuted,
              totalSpeakingMs:
                s.totalSpeakingMs + (now - s.speakingStartedAt),
              speakingStartedAt: 0,
            };
          }
          if (!isMuted && s.speakingStartedAt === 0) {
            // User just unmuted — start timer
            return { isMuted, speakingStartedAt: now };
          }
          return { isMuted };
        }),

      setAiSpeaking: (speaking) =>
        set((s) => ({
          aiSpeaking: speaking,
          userMutedBeforeAI: speaking ? s.isMuted : s.userMutedBeforeAI,
        })),

      setVadThreshold: (vadThreshold) => set({ vadThreshold }),

      appendDraftDelta: (delta) =>
        set((s) => {
          const log = [...s.conversationLog];
          const last = log[log.length - 1];
          if (last?.role === "assistant" && last.status === "draft") {
            log[log.length - 1] = { ...last, text: last.text + delta };
            return { conversationLog: log };
          }
          const newTurn: Turn = {
            id: s.turnSequence + 1,
            role: "assistant",
            text: delta,
            status: "draft",
            phase: s.sessionPhase,
            createdAt: Date.now(),
          };
          return {
            conversationLog: [...log, newTurn],
            turnSequence: s.turnSequence + 1,
          };
        }),

      finalizeLastAssistantTurn: () =>
        set((s) => {
          const log = [...s.conversationLog];
          for (let i = log.length - 1; i >= 0; i--) {
            if (log[i].role === "assistant" && log[i].status === "draft") {
              log[i] = { ...log[i], status: "final" };
              break;
            }
          }
          return { conversationLog: log };
        }),

      appendUserTurn: (text) =>
        set((s) => {
          const trimmed = text.trim();
          if (!trimmed) return s;

          // Drop non-English (CJK / Hangul) hallucinations from the STT model
          if (/[\u3000-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed))
            return s;

          // Time-based dedup: reject if an identical user turn was added within the last 2 s
          const now = Date.now();
          const recentDupe = s.conversationLog
            .slice(-5)
            .some(
              (t) =>
                t.role === "user" &&
                t.status === "final" &&
                t.text === trimmed &&
                now - t.createdAt < 2000,
            );
          if (recentDupe) return s;
          const newTurn: Turn = {
            id: s.turnSequence + 1,
            role: "user",
            text: trimmed,
            status: "final",
            phase: s.sessionPhase,
            createdAt: Date.now(),
          };
          return {
            conversationLog: [...s.conversationLog, newTurn],
            turnSequence: s.turnSequence + 1,
          };
        }),

      resetConversationLog: () => set({ conversationLog: [], turnSequence: 0 }),

      setSessionPhase: (sessionPhase) =>
        set((s) => ({
          sessionPhase,
          phaseStartTurnId: s.turnSequence,
        })),

      setSessionDeadline: (deadline) =>
        set({
          sessionDeadline: deadline,
          remainingMs: Math.max(0, deadline - Date.now()),
        }),

      tickTimer: () =>
        set((s) =>
          s.sessionDeadline
            ? { remainingMs: Math.max(0, s.sessionDeadline - Date.now()) }
            : s,
        ),

      updateWaveform: (data) => set({ waveformData: data }),

      updateStressScore: (value, confidence, isEstimate) =>
        set({
          stressScore: { value, confidence, isEstimate, updatedAt: Date.now() },
        }),

      updateSpeechMetrics: (disfluency, pacing, wpm) =>
        set({
          speechMetrics: { disfluency, pacing, wpm, updatedAt: Date.now() },
        }),

      appendPitch: (f0) =>
        set((s) => {
          const elapsed = s.sessionStartedAt
            ? (Date.now() - s.sessionStartedAt) / 1000
            : 0;
          const point: PitchPoint = { time: elapsed, f0 };
          // Keep last 120 points (~2 min at 1 point/s)
          const history = [...s.pitchHistory, point].slice(-120);
          return { pitchHistory: history };
        }),

      appendUserWords: (text) =>
        set((s) => {
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          const newTotal = s.totalWordCount + words;

          // Use actual speaking time (unmuted time only)
          const now = Date.now();
          const currentSpeakingMs =
            s.speakingStartedAt > 0
              ? s.totalSpeakingMs + (now - s.speakingStartedAt)
              : s.totalSpeakingMs;
          const speakingSecs = currentSpeakingMs / 1000;

          if (speakingSecs < 1) return { totalWordCount: newTotal };

          const wpm = Math.round((newTotal / speakingSecs) * 60);
          // Use total elapsed for the graph x-axis so it aligns with pitch
          const elapsed = s.sessionStartedAt
            ? (now - s.sessionStartedAt) / 1000
            : 0;
          const point: WPMPoint = { time: elapsed, wpm };
          const history = [...s.wpmHistory, point].slice(-120);
          return { totalWordCount: newTotal, wpmHistory: history };
        }),

      setResultsLoading: () =>
        set({
          resultsStatus: "loading",
          analysisResults: null,
          resultsError: null,
        }),

      setResultsSuccess: (results) =>
        set({ resultsStatus: "success", analysisResults: results }),

      setSummaryReport: (report) =>
        set({ resultsStatus: "success", summaryReport: report }),

      setResultsError: (error) =>
        set({ resultsStatus: "error", resultsError: error }),
    }),
    { name: "sante-session" },
  ),
);
