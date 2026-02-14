"use client";

import { useRef } from "react";

/**
 * Manages MediaRecorder for capturing audio during a session.
 * Ported from static/js/app.js lines 233–312.
 */
export function useAudioRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);

  /**
   * Start recording from the given stream.
   * Returns an ondataavailable handler you can use to also stream chunks elsewhere.
   */
  const startRecording = (
    stream: MediaStream,
    onChunk?: (chunk: Blob) => void,
  ) => {
    chunksRef.current = [];

    // Clone so mute/cleanup on the original stream doesn't stop recording
    const recStream = stream.clone();
    recStreamRef.current = recStream;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(recStream, { mimeType });
    } catch (err) {
      console.error("[Santé] MediaRecorder init failed:", err);
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
        onChunk?.(e.data);
      }
    };

    recorder.onerror = (e) => console.error("[Santé] MediaRecorder error:", e);
    recorder.start(500); // collect every 500ms
    mediaRecorderRef.current = recorder;
  };

  const stopRecording = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;

      if (!recorder) {
        resolve(null);
        return;
      }

      if (recorder.state === "inactive") {
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          chunksRef.current = [];
          mediaRecorderRef.current = null;
          resolve(blob);
        } else {
          mediaRecorderRef.current = null;
          resolve(null);
        }
        return;
      }

      const mimeType = recorder.mimeType || "audio/webm";

      recorder.onstop = () => {
        if (chunksRef.current.length === 0) {
          mediaRecorderRef.current = null;
          resolve(null);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        resolve(blob);
      };

      recorder.stop();
    });

  return { startRecording, stopRecording };
}
