"use client";

import { useRef, useState } from "react";
import {
  analyzeAcoustics,
  analyzePhonemes,
  fetchSessionSummary,
  transcribeAudio,
} from "@/lib/api";
import type { DysfluencyEntry } from "@/lib/types";
import { useSessionStore } from "@/store/sessionStore";
import ResultsModal from "@/components/sidebar/ResultsModal";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_DURATION_SECONDS = 120;
const ACCEPTED_EXTENSIONS = [".webm", ".wav", ".mp3", ".m4a"];
const ACCEPTED_MIME_TYPES = [
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
];
const ACTION_FORWARD_OPT_IN =
  process.env.NEXT_PUBLIC_ACTION_FORWARD_OPT_IN === "true";
const ACTION_FORWARD_RECIPIENT =
  process.env.NEXT_PUBLIC_ACTION_FORWARD_RECIPIENT || "";

function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  if (index < 0) return "";
  return filename.slice(index).toLowerCase();
}

function isAcceptedFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  if (ACCEPTED_EXTENSIONS.includes(extension)) return true;
  return !!file.type && ACCEPTED_MIME_TYPES.includes(file.type);
}

async function getAudioDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
      audio.load();
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Unable to read audio duration."));
        return;
      }
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Unable to read audio file metadata."));
    };
    audio.src = objectUrl;
  });
}

export default function HomepageAudioUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetSession = useSessionStore((s) => s.resetSession);
  const setResultsLoading = useSessionStore((s) => s.setResultsLoading);
  const setSummaryReport = useSessionStore((s) => s.setSummaryReport);
  const setResultsError = useSessionStore((s) => s.setResultsError);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleFileSelected = async (file: File) => {
    if (!isAcceptedFile(file)) {
      setUploadError("Unsupported format. Use webm, wav, mp3, or m4a.");
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setUploadError("File is too large. Maximum size is 10MB.");
      return;
    }

    let durationSeconds = 0;
    try {
      durationSeconds = await getAudioDurationSeconds(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Invalid audio file.");
      return;
    }

    if (durationSeconds > MAX_DURATION_SECONDS) {
      setUploadError("Audio is too long. Maximum duration is 2 minutes.");
      return;
    }

    setUploadError(null);
    setIsSubmitting(true);
    resetSession();
    setResultsLoading();

    try {
      let detectedPhonemes: string[] = [];
      let detectedDysDetect: DysfluencyEntry[] = [];
      let acousticFeatures: Record<string, number> | null = null;
      const transcript = await transcribeAudio(file);

      const [phonemeResult, acousticResult] = await Promise.allSettled([
        analyzePhonemes(file, transcript),
        analyzeAcoustics(file),
      ]);

      if (phonemeResult.status === "fulfilled") {
        detectedPhonemes = phonemeResult.value.decode_phonemes;
        detectedDysDetect = phonemeResult.value.dys_detect;
      }

      if (acousticResult.status === "fulfilled") {
        acousticFeatures = acousticResult.value;
      }

      const report = await fetchSessionSummary({
        segment: "conversation",
        user_transcription: transcript,
        ai_transcription: "",
        duration_seconds: durationSeconds,
        detected_phonemes: detectedPhonemes,
        detected_dys_detect: detectedDysDetect,
        acoustic_features: acousticFeatures,
        forward_opt_in: ACTION_FORWARD_OPT_IN,
        forward_recipient: ACTION_FORWARD_RECIPIENT,
      });

      setSummaryReport(report);
    } catch (err) {
      setResultsError(
        err instanceof Error ? err.message : "Analysis failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={openPicker}
          disabled={isSubmitting}
          style={{
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.82)",
            color: "var(--text-dim)",
            borderRadius: "999px",
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.2px",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? "Transcribing and generating report..." : "Analyze audio upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".webm,.wav,.mp3,.m4a,audio/webm,audio/wav,audio/mpeg,audio/mp4"
          style={{ display: "none" }}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            await handleFileSelected(file);
          }}
        />
        <p style={{ margin: 0, fontSize: 11, color: uploadError ? "var(--red)" : "var(--text-dim)" }}>
          {uploadError || "webm, wav, mp3, m4a · max 2 min · max 10MB"}
        </p>
      </div>
      <ResultsModal />
    </>
  );
}