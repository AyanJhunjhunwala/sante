"""
Acoustic Features Service
Extracts voice health biomarkers from audio using openSMILE eGeMAPSv02.
Runs locally on CPU — no external API calls needed.
"""

import tempfile
import os

import opensmile

from services.audio_convert import to_wav_bytes


_smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)


def analyze_acoustics(audio_bytes: bytes) -> dict:
    """
    Extract 6 key acoustic biomarkers from raw audio bytes.
    Returns a flat dict of metrics, or {"error": "..."} on failure.
    """
    try:
        # Convert webm/opus → 16kHz mono WAV, then write to temp file for openSMILE
        wav_bytes = to_wav_bytes(audio_bytes)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            tmp_path = f.name

        try:
            features = _smile.process_file(tmp_path)
        finally:
            os.unlink(tmp_path)

        row = features.iloc[0]

        return {
            "f0_mean": float(row["F0semitoneFrom27.5Hz_sma3nz_amean"]),
            "f0_std": float(row["F0semitoneFrom27.5Hz_sma3nz_stddevNorm"]),
            "jitter": float(row["jitterLocal_sma3nz_amean"]),
            "shimmer_db": float(row["shimmerLocaldB_sma3nz_amean"]),
            "hnr": float(row["HNRdBACF_sma3nz_amean"]),
            "loudness_mean": float(row["loudness_sma3_amean"]),
            "loudness_std": float(row["loudness_sma3_stddevNorm"]),
            "speaking_rate": float(row["loudnessPeaksPerSec"]),
            "voiced_segments_per_sec": float(row["VoicedSegmentsPerSec"]),
            "mean_pause_length": float(row["MeanUnvoicedSegmentLength"]),
            "mean_voiced_length": float(row["MeanVoicedSegmentLengthSec"]),
        }

    except Exception as e:
        print(f"[acoustic_features] Error: {e}")
        return {"error": str(e)}
