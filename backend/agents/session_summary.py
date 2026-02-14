from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any


def generate_session_report(
    *,
    segment: str,
    user_transcription: str,
    ai_transcription: str,
    duration_seconds: float,
    detected_phonemes: list[str] | None = None,
    detected_dys_detect: list[dict[str, Any]] | None = None,
    acoustic_features: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a session report from real analysis data only."""

    return {
        "report_id": f"sum_{uuid.uuid4().hex[:12]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "segment": segment,
        "duration_seconds": round(duration_seconds, 1),
        "content": {
            "user_transcription": user_transcription or "(no transcription captured)",
            "ai_transcription": ai_transcription or "(no assistant text captured)",
            "phonemes": detected_phonemes or [],
            "dys_detect": detected_dys_detect or [],
            "acoustic_features": acoustic_features,
        },
    }


def generate_chat_reply(*, report: dict[str, Any], message: str) -> str:
    msg = message.lower().strip()
    if not msg:
        return "Ask me about your phonemes, acoustic features, or disfluency results."

    content = report.get("content", {})
    acoustics = content.get("acoustic_features")

    if "phoneme" in msg:
        ph = content.get("phonemes", [])
        preview = " ".join(ph[:12])
        return f"Detected phoneme sequence: {preview}" if ph else "No phonemes detected."

    if "disfluency" in msg or "dys" in msg:
        dys = content.get("dys_detect", [])
        if not dys:
            return "No disfluency data available."
        flags = [d for d in dys if d.get("dysfluency_type") != "normal"]
        if not flags:
            return "No disfluencies detected — all phonemes were produced normally."
        labels = ", ".join(f"{d['phoneme']} ({d['dysfluency_type']})" for d in flags[:6])
        return f"Detected {len(flags)} disfluencies: {labels}"

    if "acoustic" in msg or "voice" in msg or "feature" in msg:
        if not acoustics:
            return "No acoustic features available for this session."
        lines = [f"  {k}: {v:.3f}" for k, v in acoustics.items()]
        return "Acoustic features:\n" + "\n".join(lines)

    if "jitter" in msg or "shimmer" in msg or "hnr" in msg or "f0" in msg:
        if not acoustics:
            return "No acoustic features available."
        key_map = {"jitter": "jitter", "shimmer": "shimmer_db", "hnr": "hnr", "f0": "f0_mean"}
        for keyword, key in key_map.items():
            if keyword in msg and key in acoustics:
                return f"{key}: {acoustics[key]:.3f}"
        return "Could not find that specific metric."

    return (
        "I can explain your phonemes, disfluency detections, "
        "and acoustic features (jitter, shimmer, HNR, F0, etc.)."
    )
