"use client";

import { useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAnalysisWebSocket } from "@/hooks/useAnalysisWebSocket";
import { useWaveform } from "@/hooks/useWaveform";
import { analyzePhonemes, fetchSessionSummary } from "@/lib/api";
import {
  VALID_SEGMENTS,
  SEGMENT_LABELS,
  SESSION_MAX_MS,
} from "@/lib/constants";
import type { Segment } from "@/lib/types";
import VoiceOrb from "@/components/session/VoiceOrb";
import OrbControls from "@/components/session/OrbControls";
import TranscriptScroll from "@/components/session/TranscriptScroll";
import AnalysisSidebar from "@/components/sidebar/AnalysisSidebar";
import ResultsModal from "@/components/sidebar/ResultsModal";

function formatRemainingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const segment = params.segment as string;

  // Store
  const store = useSessionStore;
  const connectionStatus = useSessionStore((s) => s.connectionStatus);
  const isMuted = useSessionStore((s) => s.isMuted);
  const aiSpeaking = useSessionStore((s) => s.aiSpeaking);
  const remainingMs = useSessionStore((s) => s.remainingMs);
  const sessionId = useSessionStore((s) => s.sessionId);
  const resultsStatus = useSessionStore((s) => s.resultsStatus);

  // Hooks
  const webRTC = useWebRTC();
  const audioRecorder = useAudioRecorder();
  const ws = useAnalysisWebSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveform = useWaveform(canvasRef);

  // Timers
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const sessionEndedRef = useRef(false);

  const timerProgress = remainingMs / SESSION_MAX_MS;

  // ── End session ───────────────────────────────────────────────────────────

  const endSession = useCallback(async () => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;

    // Stop timers
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (timerTimeoutRef.current) {
      clearTimeout(timerTimeoutRef.current);
      timerTimeoutRef.current = null;
    }

    store.getState().endSession();
    waveform.stop();

    // Snapshot conversation log before cleanup resets it
    const conversationLog = store.getState().conversationLog;
    const userTranscription = conversationLog
      .filter((t) => t.role === "user" && t.text)
      .map((t) => t.text)
      .join(" ");
    const aiTranscription = conversationLog
      .filter((t) => t.role === "assistant" && t.text)
      .map((t) => t.text)
      .join(" ");
    const firstTurnAt =
      conversationLog.length > 0 ? conversationLog[0].createdAt : Date.now();
    const durationSeconds = Math.max(0, (Date.now() - firstTurnAt) / 1000);

    // Stop recording, grab full audio blob
    const audioBlob = await audioRecorder.stopRecording();

    // Cleanup WebRTC + WS
    webRTC.cleanup();
    ws.disconnect();

    // Show loading screen while we analyze
    store.getState().setResultsLoading();
    try {
      // Run phoneme analysis on the full audio, then build the report
      let detectedPhonemes: string[] = [];
      let detectedDysDetect: string[] = [];

      if (audioBlob && audioBlob.size > 1000) {
        const phonemeResult = await analyzePhonemes(
          audioBlob,
          userTranscription,
        );
        detectedPhonemes = phonemeResult.decode_phonemes;
        detectedDysDetect = phonemeResult.dys_detect;
      }

      const report = await fetchSessionSummary({
        segment,
        user_transcription: userTranscription,
        ai_transcription: aiTranscription,
        duration_seconds: durationSeconds,
        detected_phonemes: detectedPhonemes,
        detected_dys_detect: detectedDysDetect,
      });
      store.getState().setSummaryReport(report);
    } catch (err) {
      store
        .getState()
        .setResultsError(
          err instanceof Error ? err.message : "Analysis failed",
        );
    }
  }, [audioRecorder, segment, store, webRTC, waveform, ws, router]);

  // ── Mount: validate + init session ───────────────────────────────────────

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    // Validate segment
    if (!VALID_SEGMENTS.includes(segment as Segment)) {
      router.replace("/");
      return;
    }

    const validSegment = segment as Segment;
    store.getState().startSession(validSegment);

    // Connect WebRTC
    const init = async () => {
      const stream = await webRTC.connect(validSegment);
      if (!stream) return;

      // Start waveform visualizer
      waveform.start(stream);

      // Record audio for all segments — full blob used for post-session phoneme analysis
      audioRecorder.startRecording(stream, (chunk) => {
        ws.sendChunk(chunk);
      });

      // Connect analysis WS
      const id = store.getState().sessionId;
      if (id) {
        ws.connect(id, validSegment);
      }

      // Start session timer
      const deadline = Date.now() + SESSION_MAX_MS;
      store.getState().setSessionDeadline(deadline);

      timerIntervalRef.current = setInterval(() => {
        store.getState().tickTimer();
      }, 100);

      timerTimeoutRef.current = setTimeout(() => {
        endSession();
      }, SESSION_MAX_MS);
    };

    init();

    return () => {
      if (!sessionEndedRef.current) {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        if (timerTimeoutRef.current) clearTimeout(timerTimeoutRef.current);
        waveform.stop();
        webRTC.cleanup();
        ws.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mute toggle ───────────────────────────────────────────────────────────

  const handleToggleMute = useCallback(() => {
    const {
      isMuted: currentMuted,
      aiSpeaking: currentAiSpeaking,
      setMuted,
    } = store.getState();
    if (currentAiSpeaking) {
      webRTC.bargeIn();
    } else {
      const next = !currentMuted;
      setMuted(next);
      webRTC.syncMute(next);
    }
  }, [store, webRTC]);

  // ── Status text ───────────────────────────────────────────────────────────

  const getStatusText = () => {
    if (connectionStatus === "connecting") return "Connecting...";
    if (connectionStatus === "ending") return "Ending session...";
    if (aiSpeaking) return "Santé is speaking";
    if (isMuted) return "Microphone muted";
    if (connectionStatus === "active") return "Session active — speak freely";
    return "Connecting...";
  };

  const isActive =
    connectionStatus === "active" || connectionStatus === "ending";
  const segmentLabel = VALID_SEGMENTS.includes(segment as Segment)
    ? SEGMENT_LABELS[segment as Segment]
    : "";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Left column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          background: "var(--bg)",
          overflowY: "auto",
          minWidth: 0,
        }}
      >
        {/* Session header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 32px",
            borderBottom: "1px solid var(--border-light)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background:
                connectionStatus === "active"
                  ? "var(--emerald)"
                  : connectionStatus === "connecting"
                    ? "#d97706"
                    : "var(--text-muted)",
              animation:
                connectionStatus === "active"
                  ? "blink 2s ease-in-out infinite"
                  : "none",
            }}
          />
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              letterSpacing: "0.2px",
            }}
          >
            {segmentLabel}
          </span>
        </div>

        {/* Session hero */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "32px 24px 16px",
            flexShrink: 0,
          }}
        >
          <VoiceOrb
            aiSpeaking={aiSpeaking}
            isActive={isActive}
            timerProgress={timerProgress}
            countdown={formatRemainingTime(remainingMs)}
          />

          {/* Status text */}
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              marginTop: "20px",
              marginBottom: "16px",
              fontWeight: 500,
              textAlign: "center",
              letterSpacing: "0.1px",
            }}
          >
            {getStatusText()}
          </p>

          {/* Controls */}
          {isActive && (
            <OrbControls
              isMuted={isMuted}
              aiSpeaking={aiSpeaking}
              onToggleMute={handleToggleMute}
              onEndSession={endSession}
            />
          )}
        </div>

        {/* Transcript */}
        <div
          style={{
            flex: 1,
            padding: "0 24px 24px",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <TranscriptScroll />
        </div>
      </div>

      {/* Right sidebar — desktop only */}
      <div
        className="hidden lg:flex"
        style={{
          width: "340px",
          flexShrink: 0,
          overflowY: "auto",
        }}
      >
        <AnalysisSidebar canvasRef={canvasRef} />
      </div>

      {/* Results modal */}
      {resultsStatus !== "idle" && <ResultsModal />}
    </div>
  );
}
