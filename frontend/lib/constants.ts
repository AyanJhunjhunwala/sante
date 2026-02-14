import type { Segment } from "./types";

export const SEGMENT_LABELS: Record<Segment, string> = {
  speech: "Speech Patterns",
  health: "General Health",
  stress: "Stress & Wellness",
};

export const VALID_SEGMENTS: Segment[] = ["speech", "health", "stress"];

export const SESSION_MAX_MS = 60_000; // 1 minute

export const API_BASE = ""; // empty = same origin (Next.js rewrites proxy to :8000)

export const WS_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `wss://${window.location.host}`
    : "ws://localhost:8000";
