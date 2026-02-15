"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/sessionStore";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAnalysisWebSocket } from "@/hooks/useAnalysisWebSocket";
import { useWaveform } from "@/hooks/useWaveform";
import {
  analyzePhonemes,
  analyzeAcoustics,
  fetchSessionSummary,
  fetchReadAloudPrompt,
} from "@/lib/api";
import type { DysfluencyEntry, Segment, SessionPhase } from "@/lib/types";
import {
  SEGMENT_LABELS,
  SESSION_MAX_MS,
  CONVERSATION_PROMPT_COUNT,
  READ_ALOUD_PROMPT_COUNT,
} from "@/lib/constants";
import VoiceOrb from "@/components/session/VoiceOrb";
import OrbControls from "@/components/session/OrbControls";
import TranscriptScroll from "@/components/session/TranscriptScroll";
import AnalysisSidebar from "@/components/sidebar/AnalysisSidebar";
import ResultsModal from "@/components/sidebar/ResultsModal";

const ACTIVE_SEGMENT: Segment = "conversation";

/** Count finalized assistant turns that belong to the given phase. */
function countPhasePrompts(
  log: { role: string; status: string; phase: SessionPhase }[],
  phase: SessionPhase,
): number {
  return log.filter(
    (t) => t.role === "assistant" && t.status === "final" && t.phase === phase,
  ).length;
}

export default function SessionPage() {
  const router = useRouter();

  const store = useSessionStore;
  const connectionStatus = useSessionStore((s) => s.connectionStatus);
  const isMuted = useSessionStore((s) => s.isMuted);
  const aiSpeaking = useSessionStore((s) => s.aiSpeaking);
  const sessionPhase = useSessionStore((s) => s.sessionPhase);
  const conversationLog = useSessionStore((s) => s.conversationLog);
  const resultsStatus = useSessionStore((s) => s.resultsStatus);

  const webRTC = useWebRTC();
  const audioRecorder = useAudioRecorder();
  const ws = useAnalysisWebSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveform = useWaveform(canvasRef);

  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const phaseTransitioningRef = useRef(false);

  // Compute prompt progress for whichever phase we're in
  const currentPhaseCount =
    sessionPhase === "conversation"
      ? countPhasePrompts(conversationLog, "conversation")
      : countPhasePrompts(conversationLog, "read_aloud");
  const currentPhaseTotal =
    sessionPhase === "conversation"
      ? CONVERSATION_PROMPT_COUNT
      : READ_ALOUD_PROMPT_COUNT;

  const endSession = useCallback(async () => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;

    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }

    store.getState().endSession();
    waveform.stop();

    const log = store.getState().conversationLog;
    const userTranscription = log
      .filter((t) => t.role === "user" && t.text)
      .map((t) => t.text)
      .join(" ");
    const aiTranscription = log
      .filter((t) => t.role === "assistant" && t.text)
      .map((t) => t.text)
      .join(" ");
    const firstTurnAt = log.length > 0 ? log[0].createdAt : Date.now();
    const durationSeconds = Math.max(0, (Date.now() - firstTurnAt) / 1000);

    const audioBlob = await audioRecorder.stopRecording();

    webRTC.cleanup();
    ws.disconnect();

    store.getState().setResultsLoading();
    try {
      let detectedPhonemes: string[] = [];
      let detectedDysDetect: DysfluencyEntry[] = [];
      let acousticFeatures: Record<string, number> | null = null;

      if (audioBlob && audioBlob.size > 1000) {
        const [phonemeResult, acousticResult] = await Promise.allSettled([
          analyzePhonemes(audioBlob, userTranscription),
          analyzeAcoustics(audioBlob),
        ]);

        if (phonemeResult.status === "fulfilled") {
          detectedPhonemes = phonemeResult.value.decode_phonemes;
          detectedDysDetect = phonemeResult.value.dys_detect;
        } else {
          console.warn("Phoneme analysis failed:", phonemeResult.reason);
        }

        if (acousticResult.status === "fulfilled") {
          acousticFeatures = acousticResult.value;
        } else {
          console.warn("Acoustic analysis failed:", acousticResult.reason);
        }
      }

      const report = await fetchSessionSummary({
        segment: ACTIVE_SEGMENT,
        user_transcription: userTranscription,
        ai_transcription: aiTranscription,
        duration_seconds: durationSeconds,
        detected_phonemes: detectedPhonemes,
        detected_dys_detect: detectedDysDetect,
        acoustic_features: acousticFeatures,
      });
      store.getState().setSummaryReport(report);
    } catch (err) {
      store
        .getState()
        .setResultsError(
          err instanceof Error ? err.message : "Analysis failed",
        );
    }
  }, [audioRecorder, store, webRTC, waveform, ws]);

  // -----------------------------------------------------------------------
  // Phase transition: watch finalized assistant turns
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (connectionStatus !== "active") return;
    if (sessionEndedRef.current || phaseTransitioningRef.current) return;

    const state = store.getState();
    const phase = state.sessionPhase;

    if (phase === "conversation") {
      const count = countPhasePrompts(conversationLog, "conversation");
      if (count >= CONVERSATION_PROMPT_COUNT) {
        phaseTransitioningRef.current = true;
        // Transition to Read Aloud phase
        (async () => {
          try {
            const { instructions } = await fetchReadAloudPrompt().then(
              (inst) => ({ instructions: inst }),
            );
            // Update AI instructions mid-session
            webRTC.sendDataChannelMessage({
              type: "session.update",
              session: {
                type: "realtime",
                instructions,
              },
            });
            // Trigger the AI to produce its first Read Aloud prompt
            webRTC.sendDataChannelMessage({ type: "response.create" });
            store.getState().setSessionPhase("read_aloud");
          } catch (err) {
            console.error("Failed to transition to Read Aloud phase:", err);
          } finally {
            phaseTransitioningRef.current = false;
          }
        })();
      }
    } else if (phase === "read_aloud") {
      const count = countPhasePrompts(conversationLog, "read_aloud");
      if (count >= READ_ALOUD_PROMPT_COUNT) {
        endSession();
      }
    }
  }, [conversationLog, connectionStatus, store, webRTC, endSession]);

  // -----------------------------------------------------------------------
  // Init session
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    store.getState().startSession(ACTIVE_SEGMENT);

    const init = async () => {
      const stream = await webRTC.connect(ACTIVE_SEGMENT);
      if (!stream) {
        router.replace("/");
        return;
      }

      waveform.start(stream);

      audioRecorder.startRecording(stream, (chunk) => {
        ws.sendChunk(chunk);
      });

      const id = store.getState().sessionId;
      if (id) {
        ws.connect(id, ACTIVE_SEGMENT);
      }

      // Safety fallback timeout (5 minutes)
      safetyTimeoutRef.current = setTimeout(() => {
        endSession();
      }, SESSION_MAX_MS);
    };

    init();

    return () => {
      if (!sessionEndedRef.current) {
        if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
        waveform.stop();
        webRTC.cleanup();
        ws.disconnect();
      }
    };
  }, [audioRecorder, endSession, router, store, waveform, webRTC, ws]);

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

  const phaseLabel =
    sessionPhase === "conversation" ? "Conversation" : "Read Aloud";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
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
            {SEGMENT_LABELS[ACTIVE_SEGMENT]}
          </span>
        </div>

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
            phase={phaseLabel}
            currentPrompt={Math.min(currentPhaseCount, currentPhaseTotal)}
            totalPrompts={currentPhaseTotal}
          />

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

          {isActive && (
            <OrbControls
              isMuted={isMuted}
              aiSpeaking={aiSpeaking}
              onToggleMute={handleToggleMute}
              onEndSession={endSession}
            />
          )}
        </div>

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

      {resultsStatus !== "idle" && <ResultsModal />}
    </div>
  );
}
