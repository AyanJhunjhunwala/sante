import type { Segment } from "./types";

export const SEGMENT_LABELS: Record<Segment, string> = {
  conversation: "Conversation Session",
};

export const VALID_SEGMENTS: Segment[] = ["conversation"];

// Prompt counts per session phase
export const CONVERSATION_PROMPT_COUNT = 5;
export const READ_ALOUD_PROMPT_COUNT = 5;

export const SESSION_MAX_MS = 300_000; // 5-minute safety fallback

export const API_BASE = ""; // empty = same origin (Next.js rewrites proxy to :8000)

/** Direct backend URL — bypasses Next.js proxy for long-running requests (RunPod cold starts). */
export const BACKEND_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "" // production: use same-origin proxy
    : "http://localhost:8000";

export const WS_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `wss://${window.location.host}`
    : "ws://localhost:8000";
