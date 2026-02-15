from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from openai import OpenAI


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


def generate_ai_report(*, report: dict[str, Any]) -> str:
    """Use OpenAI to generate a clinical-style narrative from session data."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip().strip('"').strip("'")
    if not api_key:
        return "AI report generation unavailable — OPENAI_API_KEY not configured."

    content = report.get("content", {})
    acoustics = content.get("acoustic_features") or {}
    phonemes = content.get("phonemes", [])
    dys_detect = content.get("dys_detect", [])
    user_tx = content.get("user_transcription", "")
    duration = report.get("duration_seconds", 0)

    flags = [d for d in dys_detect if d.get("dysfluency_type") != "normal"]

    data_block = f"""Session duration: {duration}s
Transcription: {user_tx[:500]}
Phonemes detected: {len(phonemes)} ({' '.join(phonemes[:20])}{'...' if len(phonemes) > 20 else ''})
Disfluencies: {len(flags)} flagged out of {len(dys_detect)} total
"""
    if flags:
        flag_list = ", ".join(f"{d['phoneme']} ({d['dysfluency_type']})" for d in flags[:10])
        data_block += f"Flagged disfluencies: {flag_list}\n"

    if acoustics:
        data_block += "Acoustic features:\n"
        for k, v in acoustics.items():
            data_block += f"  {k}: {v:.3f}\n"

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a speech-language pathology research assistant. "
                    "Given raw voice analysis data from a session, write a concise, "
                    "informative report (3-5 paragraphs). Cover: "
                    "1) Overall voice quality based on acoustic features (interpret jitter, shimmer, HNR, F0). "
                    "2) Speech fluency based on phoneme and disfluency data. "
                    "3) Speaking rate and rhythm observations. "
                    "4) Key takeaways and areas to monitor. "
                    "Use plain language accessible to a non-specialist. "
                    "Do NOT diagnose — frame findings as observations. "
                    "Include specific numbers from the data to support observations."
                ),
            },
            {"role": "user", "content": data_block},
        ],
        max_tokens=800,
        temperature=0.3,
    )

    return resp.choices[0].message.content or "Report generation returned empty."


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
