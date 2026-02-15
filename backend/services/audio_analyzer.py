"""
Lightweight real-time audio analysis that runs in-process on each 500ms chunk.
Produces waveform and F0 pitch frames for the WebSocket.

NOTE: This is a heuristic approximation for live display only.
The definitive results come from the RunPod models at session end.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import subprocess
import tempfile

import numpy as np

logger = logging.getLogger(__name__)

# Target sample rate for pitch detection
SAMPLE_RATE = 16000
F0_MIN = 75   # Hz — minimum expected fundamental frequency
F0_MAX = 500  # Hz — maximum expected fundamental frequency

# How many seconds of trailing audio to analyze for pitch
PITCH_WINDOW_SECS = 1.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def analyze_chunk(
    chunk: bytes,
    chunk_count: int,
    segment: str,
    audio_buffer: bytes | bytearray | None = None,
) -> list[dict]:
    """
    Process a raw audio chunk (audio/webm;codecs=opus binary from MediaRecorder).
    """
    frames: list[dict] = []

    # Convert binary blob to simple energy signal
    energy_values = _estimate_energy(chunk)

    # Always send waveform frame
    frames.append({"type": "waveform", "data": energy_values})

    # Every 2 chunks (~1s) try to extract F0 from the accumulated audio
    if chunk_count % 2 == 0 and audio_buffer and len(audio_buffer) > 500:
        f0 = await asyncio.to_thread(_extract_f0_sync, bytes(audio_buffer))
        frames.append({"type": "pitch", "f0": f0})

    return frames


# ---------------------------------------------------------------------------
# Pitch detection via ffmpeg decode + autocorrelation
# ---------------------------------------------------------------------------


def _extract_f0_sync(full_webm: bytes) -> float | None:
    """
    Synchronous F0 extraction (run via asyncio.to_thread).
    Writes webm to temp file, decodes with ffmpeg, analyzes tail.
    """
    tmp_in = None
    tmp_out = None
    try:
        # Write webm to temp file
        tmp_in = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
        tmp_in.write(full_webm)
        tmp_in.close()

        # Output PCM temp file
        tmp_out_path = tmp_in.name.replace(".webm", ".pcm")

        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_in.name,
                "-f", "s16le",
                "-acodec", "pcm_s16le",
                "-ar", str(SAMPLE_RATE),
                "-ac", "1",
                "-v", "quiet",
                tmp_out_path,
            ],
            capture_output=True,
            timeout=5,
        )

        if result.returncode != 0:
            stderr_msg = result.stderr.decode(errors="replace")[:200]
            logger.debug(f"ffmpeg returned {result.returncode}: {stderr_msg}")
            return None

        if not os.path.exists(tmp_out_path):
            return None

        pcm_bytes = open(tmp_out_path, "rb").read()
        os.unlink(tmp_out_path)

        if len(pcm_bytes) < 512:
            return None

        pcm = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # Only analyze the trailing window for current pitch
        tail_samples = int(SAMPLE_RATE * PITCH_WINDOW_SECS)
        if len(pcm) > tail_samples:
            pcm = pcm[-tail_samples:]

        return _autocorrelation_f0(pcm, SAMPLE_RATE)

    except Exception as e:
        logger.warning(f"F0 extraction failed: {e}")
        return None
    finally:
        if tmp_in and os.path.exists(tmp_in.name):
            try:
                os.unlink(tmp_in.name)
            except OSError:
                pass


def _autocorrelation_f0(signal: np.ndarray, sr: int) -> float | None:
    """
    Estimate fundamental frequency using autocorrelation method.
    Returns F0 in Hz, or None if the signal is unvoiced/silent.
    """
    # Apply Hanning window
    windowed = signal * np.hanning(len(signal))

    # Check if signal has enough energy (silence detection)
    rms = np.sqrt(np.mean(windowed ** 2))
    if rms < 0.01:
        return None

    # Autocorrelation via FFT
    n = len(windowed)
    fft = np.fft.rfft(windowed, n=2 * n)
    acf = np.fft.irfft(fft * np.conj(fft))[:n]

    # Normalize
    acf = acf / acf[0] if acf[0] != 0 else acf

    # Search for peak in valid F0 range
    min_lag = int(sr / F0_MAX)
    max_lag = int(sr / F0_MIN)
    max_lag = min(max_lag, n - 1)

    if min_lag >= max_lag:
        return None

    search_region = acf[min_lag:max_lag + 1]
    if len(search_region) == 0:
        return None

    peak_idx = np.argmax(search_region) + min_lag
    peak_val = acf[peak_idx]

    # Voicing threshold — peak must be strong enough
    if peak_val < 0.25:
        return None

    f0 = sr / peak_idx
    return round(f0, 1)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _estimate_energy(chunk: bytes) -> list[float]:
    """
    Produce a 64-point normalized energy envelope from raw bytes.
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
        signed = [b - 128 for b in window]
        rms = math.sqrt(sum(s * s for s in signed) / len(signed))
        values.append(rms)

    max_val = max(abs(v) for v in values) or 1.0
    return [v / max_val for v in values]
