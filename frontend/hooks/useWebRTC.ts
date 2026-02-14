"use client";

import { useCallback, useRef } from "react";
import { fetchEphemeralToken } from "@/lib/api";
import { useSessionStore } from "@/store/sessionStore";
import type { Segment } from "@/lib/types";

/**
 * Manages the WebRTC connection to OpenAI Realtime API.
 * Ported from static/js/app.js lines 317–556.
 */
export function useWebRTC() {
  const store = useSessionStore;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ── Realtime event handler ──────────────────────────────────────────────

  const handleEvent = useCallback(
    (ev: Record<string, unknown>) => {
      const {
        appendDraftDelta,
        finalizeLastAssistantTurn,
        appendUserTurn,
        setAiSpeaking,
        isMuted,
        setMuted,
      } = store.getState();

      switch (ev.type) {
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
          if (ev.delta) appendDraftDelta(ev.delta as string);
          break;

        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done":
          finalizeLastAssistantTurn();
          break;

        case "conversation.item.input_audio_transcription.completed": {
          const t =
            (ev.transcript as string) ||
            ((ev as { content_part?: { transcript?: string } }).content_part
              ?.transcript ??
              "");
          if (t) appendUserTurn(t);
          break;
        }

        case "conversation.item.done": {
          const item = ev.item as {
            role?: string;
            content?: { transcript?: string; text?: string }[];
          };
          if (item?.role === "user" && Array.isArray(item.content)) {
            for (const part of item.content) {
              const t = part.transcript || part.text || "";
              if (t.trim()) {
                appendUserTurn(t);
                break;
              }
            }
          }
          break;
        }

        case "output_audio_buffer.started":
          console.log("[Santé] AI speaking start, isMuted=", isMuted);
          setAiSpeaking(true);
          if (!isMuted) {
            setMuted(true);
            localStreamRef.current?.getAudioTracks().forEach((t) => {
              t.enabled = false;
            });
          }
          break;

        case "output_audio_buffer.cleared":
        case "output_audio_buffer.stopped": {
          const { userMutedBeforeAI } = store.getState();
          console.log(
            "[Santé] AI speaking end, userMutedBeforeAI=",
            userMutedBeforeAI,
          );
          setAiSpeaking(false);
          if (!userMutedBeforeAI) {
            setMuted(false);
            localStreamRef.current?.getAudioTracks().forEach((t) => {
              t.enabled = true;
            });
          }
          break;
        }

        case "error":
          console.error("[Santé] Realtime error FULL:", JSON.stringify(ev));
          break;

        default:
          // Log all unhandled events so we can see what OpenAI sends
          console.log("[Santé] event:", ev.type, ev);
          break;
      }
    },
    [store],
  );

  // ── Data channel ──────────────────────────────────────────────────────

  const sendDataChannelMessage = useCallback((msg: object) => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const bargeIn = useCallback(() => {
    sendDataChannelMessage({ type: "response.cancel" });
    const { setAiSpeaking, setMuted } = store.getState();
    setAiSpeaking(false);
    setMuted(false);
  }, [sendDataChannelMessage, store]);

  // ── Mute ──────────────────────────────────────────────────────────────

  const setMicEnabled = useCallback((enabled: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }, []);

  // Apply mic state when store changes
  const syncMute = useCallback(
    (muted: boolean) => {
      setMicEnabled(!muted);
    },
    [setMicEnabled],
  );

  // ── Connect ──────────────────────────────────────────────────────────

  const connect = useCallback(
    async (segment: Segment): Promise<MediaStream | null> => {
      const { setConnectionStatus, setMuted } = store.getState();

      try {
        const ephemeralKey = await fetchEphemeralToken(segment);

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioElRef.current = audioEl;
        pc.ontrack = (e) => {
          audioEl.srcObject = e.streams[0];
        };

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        localStreamRef.current = stream;
        pc.addTrack(stream.getTracks()[0]);

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.addEventListener("open", () => {
          console.log("[Santé] Data channel open");
        });
        dc.addEventListener("message", (e) => {
          try {
            handleEvent(JSON.parse(e.data));
          } catch (err) {
            console.error("[Santé] Event parse error:", err);
          }
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch(
          "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
          {
            method: "POST",
            body: offer.sdp,
            headers: {
              Authorization: `Bearer ${ephemeralKey}`,
              "Content-Type": "application/sdp",
            },
          },
        );

        if (!sdpRes.ok) throw new Error(await sdpRes.text());
        await pc.setRemoteDescription({
          type: "answer",
          sdp: await sdpRes.text(),
        });

        setConnectionStatus("active");
        setMuted(false);
        return stream;
      } catch (err) {
        console.error("[Santé] Connect error:", err);
        setConnectionStatus("idle");
        cleanup();
        return null;
      }
    },
    [handleEvent, store],
  );

  // ── Cleanup ──────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    const { setAiSpeaking } = store.getState();
    setAiSpeaking(false);
  }, [store]);

  return {
    connect,
    cleanup,
    bargeIn,
    syncMute,
    sendDataChannelMessage,
    localStreamRef,
    dcRef,
  };
}
