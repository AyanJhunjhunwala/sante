import type { Segment } from "./types";

export const SEGMENT_LABELS: Record<Segment, string> = {
  conversation: "Conversation Session",
};

export const VALID_SEGMENTS: Segment[] = ["conversation"];

// Prompt counts per session phase
export const CONVERSATION_PROMPT_COUNT = 4;
export const READ_ALOUD_PROMPT_COUNT = 3;

export const VAD_THRESHOLD_DEFAULT = 0.8;
export const VAD_THRESHOLD_MIN = 0.5;
export const VAD_THRESHOLD_MAX = 0.9;
export const VAD_THRESHOLD_STEP = 0.05;

export const SESSION_MAX_MS = 300_000; // 5-minute safety fallback

export const API_BASE = ""; // empty = same origin (Next.js rewrites proxy to backend)

/**
 * Direct backend URL — used for long-running requests that bypass the Next.js proxy
 * (e.g. RunPod cold starts).
 *
 * Local dev  : falls back to http://localhost:8000
 * Production : set NEXT_PUBLIC_BACKEND_URL on Vercel to your Railway backend URL,
 *              e.g. https://sante-backend.up.railway.app
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "" // same-origin proxy (only works if frontend + backend share a domain)
    : "http://localhost:8000");

/**
 * WebSocket base URL for real-time analysis.
 *
 * Local dev  : ws://localhost:8000
 * Production : derives wss:// from NEXT_PUBLIC_BACKEND_URL if set,
 *              otherwise falls back to same-origin wss://
 */
export const WS_BASE = process.env.NEXT_PUBLIC_BACKEND_URL
  ? process.env.NEXT_PUBLIC_BACKEND_URL.replace("https://", "wss://").replace(
      "http://",
      "ws://",
    )
  : typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `wss://${window.location.host}`
    : "ws://localhost:8000";
