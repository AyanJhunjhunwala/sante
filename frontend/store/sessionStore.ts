"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  AnalysisResults,
  Segment,
  SpeechMetrics,
  StressScore,
  SummaryReport,
  Turn,
} from "@/lib/types";

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

  // Session timer
  sessionDeadline: number; // epoch ms, 0 = not started
  remainingMs: number;

  // Real-time analysis (from WebSocket)
  waveformData: number[];
  stressScore: StressScore | null;
  speechMetrics: SpeechMetrics | null;

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

  // Transcript
  appendDraftDelta: (delta: string) => void;
  finalizeLastAssistantTurn: () => void;
  appendUserTurn: (text: string) => void;
  resetConversationLog: () => void;

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
  sessionDeadline: 0,
  remainingMs: 60_000,
  waveformData: [],
  stressScore: null,
  speechMetrics: null,
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
        }),

      setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

      endSession: () => set({ connectionStatus: "ending" }),

      resetSession: () => set(initialState),

      setMuted: (isMuted) => set({ isMuted }),

      setAiSpeaking: (speaking) =>
        set((s) => ({
          aiSpeaking: speaking,
          userMutedBeforeAI: speaking ? s.isMuted : s.userMutedBeforeAI,
        })),

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
          const last = s.conversationLog[s.conversationLog.length - 1];
          if (
            last?.role === "user" &&
            last.status === "final" &&
            last.text === trimmed
          )
            return s;
          const newTurn: Turn = {
            id: s.turnSequence + 1,
            role: "user",
            text: trimmed,
            status: "final",
            createdAt: Date.now(),
          };
          return {
            conversationLog: [...s.conversationLog, newTurn],
            turnSequence: s.turnSequence + 1,
          };
        }),

      resetConversationLog: () => set({ conversationLog: [], turnSequence: 0 }),

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
