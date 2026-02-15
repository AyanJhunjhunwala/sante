"use client";

import { useCallback, useRef } from "react";
import { WS_BASE } from "@/lib/constants";
import { useSessionStore } from "@/store/sessionStore";
import type { WSServerMessage } from "@/lib/types";

/**
 * WebSocket connection to the backend analysis endpoint.
 * Sends audio chunks and receives waveform / stress / speech frames.
 */
export function useAnalysisWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const store = useSessionStore;

  const connect = useCallback(
    (sessionId: string, segment: string) => {
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
      }

      const url = `${WS_BASE}/ws/analysis/${sessionId}?segment=${segment}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => console.log("[Santé WS] connected");

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WSServerMessage;
          const {
            updateWaveform,
            updateStressScore,
            updateSpeechMetrics,
            appendPitch,
          } = store.getState();

          switch (msg.type) {
            case "waveform":
              updateWaveform(msg.data);
              break;
            case "pitch":
              // Only record pitch when user is unmuted (speaking)
              if (!store.getState().isMuted) {
                appendPitch(msg.f0);
              }
              break;
            case "stress_score":
              updateStressScore(msg.value, msg.confidence, msg.is_estimate);
              break;
            case "speech_metrics":
              updateSpeechMetrics(msg.disfluency, msg.pacing, msg.wpm);
              break;
            case "error":
              console.warn("[Santé WS] server error:", msg.message);
              break;
          }
        } catch (err) {
          console.error("[Santé WS] parse error:", err);
        }
      };

      ws.onerror = () => {
        console.warn("[Santé WS] connection error (see close event for details)", {
          url,
        });
      };
      ws.onclose = (e) => {
        const detail = {
          code: e.code,
          reason: e.reason || "(none)",
          wasClean: e.wasClean,
          url,
        };
        if (e.wasClean) {
          console.log("[Santé WS] closed", detail);
        } else {
          console.warn("[Santé WS] closed unexpectedly", detail);
        }
      };
    },
    [store],
  );

  /** Send a binary audio chunk to the backend. */
  const sendChunk = useCallback((chunk: Blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      chunk.arrayBuffer().then((buf) => wsRef.current?.send(buf));
    }
  }, []);

  /** Forward a transcript turn to the backend. */
  const sendTranscript = useCallback((role: string, text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "transcript", role, text }));
    }
  }, []);

  /** Signal session end and close. */
  const disconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  return { connect, sendChunk, sendTranscript, disconnect };
}
