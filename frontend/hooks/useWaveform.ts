"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Drives the WaveformPanel canvas using the browser's AnalyserNode.
 * Runs entirely client-side — zero latency, zero bandwidth.
 */
export function useWaveform(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const updateWaveform = useSessionStore((s) => s.updateWaveform);

  const start = useCallback(
    (stream: MediaStream) => {
      const audioCtx = new AudioContext();
      ctxRef.current = audioCtx;
      // Resume in case browser created it in suspended state
      audioCtx.resume().catch(() => {});
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128; // 64 frequency bins
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(dataArray);

        // Normalize to [-1, 1]
        const normalized = Array.from(dataArray).map((v) => (v - 128) / 128);
        updateWaveform(normalized);

        // Draw on canvas
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        ctx.beginPath();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";

        const sliceW = width / dataArray.length;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i] / 128;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceW;
        }
        ctx.stroke();
      };

      draw();
    },
    [canvasRef, updateWaveform],
  );

  const stop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    sourceRef.current?.disconnect();
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    sourceRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return { start, stop };
}
