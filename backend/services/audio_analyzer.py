"""
Lightweight real-time audio analysis that runs in-process on each 500ms chunk.
Produces waveform, stress proxy, and speech metrics frames for the WebSocket.

NOTE: This is a heuristic approximation for live display only.
The definitive stress result comes from the RunPod WFST model at session end.
"""

from __future__ import annotations

import struct
import math


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


# Trigger phoneme analysis every N chunks (~3 s at 500ms/chunk)
PHONEME_CHUNK_INTERVAL = 6


async def analyze_chunk(chunk: bytes, chunk_count: int, segment: str) -> list[dict]:
    """
    Process a raw audio chunk (audio/webm;codecs=opus binary from MediaRecorder).

    Returns a list of WS frames to send back, which may include:
    - waveform frame (every chunk)
    - stress_score frame (every 3 chunks)
    - speech_metrics frame (every 4 chunks)
    - _phoneme_trigger internal signal (every 6 chunks, NOT sent to client)
    """
    frames: list[dict] = []

    # Convert binary blob to simple energy signal
    energy_values = _estimate_energy(chunk)

    # Always send waveform frame
    frames.append({"type": "waveform", "data": energy_values})

    # Every 3 chunks (~1.5 s) emit a stress proxy
    if chunk_count % 3 == 0:
        stress_frame = _compute_stress_proxy(energy_values, chunk_count)
        frames.append(stress_frame)

    # Every 4 chunks (~2 s) emit speech metrics
    if chunk_count % 4 == 0:
        metrics_frame = _compute_speech_metrics(energy_values, chunk_count)
        frames.append(metrics_frame)

    # Every 6 chunks (~3 s) signal that phoneme analysis should be triggered.
    # This frame is internal only — the WS router handles it and does NOT send
    # it to the client.
    if chunk_count % PHONEME_CHUNK_INTERVAL == 0:
        frames.append({"type": "_phoneme_trigger"})

    return frames


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _estimate_energy(chunk: bytes) -> list[float]:
    """
    Produce a 64-point normalized energy envelope from raw bytes.

    We cannot decode opus/webm in-process without heavy dependencies,
    so we treat the raw bytes as a proxy signal by computing the
    byte-value variance per window. This gives a visually meaningful
    waveform even from compressed audio data.
    """
    n = len(chunk)
    if n < 64:
        return [0.0] * 64

    window_size = max(1, n // 64)
    values: list[float] = []

    for i in range(64):
        start = i * window_size
        end = min(start + window_size, n)
        window = chunk[start:end]
        if not window:
            values.append(0.0)
            continue
        # Use signed byte interpretation for better range
        signed = [b - 128 for b in window]
        rms = math.sqrt(sum(s * s for s in signed) / len(signed))
        values.append(rms)

    # Normalize to [-1, 1]
    max_val = max(abs(v) for v in values) or 1.0
    return [v / max_val for v in values]


def _compute_stress_proxy(energy: list[float], chunk_count: int) -> dict:
    """
    Heuristic stress estimate from energy variance.
    High variance in energy → higher stress proxy score.
    This is NOT the RunPod model result — just a visual indicator.
    """
    if not energy:
        return {
            "type": "stress_score",
            "value": 0.5,
            "confidence": 0,
            "is_estimate": True,
        }

    mean = sum(energy) / len(energy)
    variance = sum((e - mean) ** 2 for e in energy) / len(energy)

    # Map variance to stress 0–1 (heuristic threshold)
    stress_value = min(1.0, variance * 8.0)

    # Confidence grows with number of chunks (more data = more confident)
    confidence = min(85.0, chunk_count * 3.5)

    return {
        "type": "stress_score",
        "value": round(stress_value, 3),
        "confidence": round(confidence, 1),
        "is_estimate": True,  # flags this as a live estimate, not final RunPod result
    }


def _compute_speech_metrics(energy: list[float], chunk_count: int) -> dict:
    """
    Rough speech metrics from energy envelope.
    - disfluency: count energy dips below threshold (potential pauses/repetitions)
    - pacing: ratio of high-energy frames (fast = lots of sound, slow = lots of silence)
    - wpm: estimated from pacing and elapsed chunks (rough heuristic)
    """
    if not energy:
        return {"type": "speech_metrics", "disfluency": 0, "pacing": 1.0, "wpm": None}

    threshold = 0.15
    high_energy_frames = sum(1 for e in energy if abs(e) > threshold)
    pacing = round(high_energy_frames / len(energy), 2)

    # Count zero-crossings in energy as disfluency proxy
    disfluency = 0
    prev_above = abs(energy[0]) > threshold
    for e in energy[1:]:
        above = abs(e) > threshold
        if prev_above and not above:
            disfluency += 1
        prev_above = above

    # Rough WPM estimate: assume ~150 WPM average, scale by pacing ratio
    # Only meaningful after a few seconds of data
    wpm = None
    if chunk_count >= 6:
        wpm = round(150 * pacing * 1.4)

    return {
        "type": "speech_metrics",
        "disfluency": max(0, disfluency - 1),  # subtract 1 for natural starts
        "pacing": pacing,
        "wpm": wpm,
    }
