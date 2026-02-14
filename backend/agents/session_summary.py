from __future__ import annotations

import hashlib
import random
import uuid
from datetime import datetime, timezone
from typing import Any

MODEL_STACK = [
    {
        "name": "slprl/WhiStress",
        "role": "ASR + prosodic prominence tagging",
        "status": "planned",
    },
    {
        "name": "cisco-ai/mini-bart-g2p",
        "role": "word-to-ARPAbet + lexical stress",
        "status": "planned",
    },
    {
        "name": "speechbrain/emotion-recognition-wav2vec2-IEMOCAP",
        "role": "primary stress/emotion signal",
        "status": "planned",
    },
    {
        "name": "audeering/wav2vec2-large-robust-24-ft-age-gender",
        "role": "age/gender probabilities + speaker traits embedding",
        "status": "planned",
    },
]

PHONEME_MAP = {
    "a": "AE1",
    "b": "B",
    "c": "K",
    "d": "D",
    "e": "EH1",
    "f": "F",
    "g": "G",
    "h": "HH",
    "i": "IH1",
    "j": "JH",
    "k": "K",
    "l": "L",
    "m": "M",
    "n": "N",
    "o": "OW1",
    "p": "P",
    "q": "K",
    "r": "R",
    "s": "S",
    "t": "T",
    "u": "UW1",
    "v": "V",
    "w": "W",
    "x": "K S",
    "y": "Y",
    "z": "Z",
}

ACCENTS = [
    "General American English",
    "Southern US English",
    "British English (RP-like)",
    "Indian English",
    "Filipino English",
    "Nigerian English",
]


def _rng_from_text(*parts: str) -> random.Random:
    joined = "|".join(parts)
    seed = int(hashlib.sha1(joined.encode("utf-8")).hexdigest()[:8], 16)
    return random.Random(seed)


def _extract_phonemes(transcript: str, rng: random.Random) -> list[str]:
    phonemes: list[str] = []
    words = [w.strip(".,!?;:\"'()[]{}") for w in transcript.lower().split()]
    for word in words[:18]:
        if not word:
            continue
        first = word[0]
        base = PHONEME_MAP.get(first)
        if not base:
            base = rng.choice(["AH0", "EH1", "IH0", "OW1", "AA1"])
        if " " in base:
            phonemes.extend(base.split())
        else:
            phonemes.append(base)
    if not phonemes:
        phonemes = ["AH0", "N", "AE1", "L", "IH0", "S", "IH0", "S"]
    return phonemes


def _metric(name: str, rng: random.Random, center: float) -> dict[str, Any]:
    score = max(0.0, min(1.0, rng.uniform(center - 0.22, center + 0.22)))
    conf = max(0.5, min(0.99, rng.uniform(0.62, 0.93)))
    return {
        "name": name,
        "score": round(score, 3),
        "confidence": round(conf, 3),
    }


def generate_dummy_session_report(
    *,
    segment: str,
    user_transcription: str,
    ai_transcription: str,
    duration_seconds: float,
    detected_phonemes: list[str] | None = None,
    detected_dys_detect: list[str] | None = None,
) -> dict[str, Any]:
    rng = _rng_from_text(
        segment, user_transcription, ai_transcription, str(round(duration_seconds, 1))
    )

    # Use real RunPod phonemes when available; fall back to dummy extraction
    if detected_phonemes:
        phonemes = detected_phonemes
    else:
        phonemes = _extract_phonemes(user_transcription, rng)
    accent = rng.choice(ACCENTS)

    metrics = [
        _metric("slurred_speech", rng, 0.35),
        _metric("stuttering", rng, 0.32),
        _metric("stress", rng, 0.52 if segment == "stress" else 0.42),
        _metric("semantic_alarm", rng, 0.27),
        _metric("disfluency", rng, 0.38),
        _metric("aphasia", rng, 0.22),
    ]

    stress_score = next(m["score"] for m in metrics if m["name"] == "stress")
    stress_binary = "yes" if stress_score >= 0.5 else "no"

    age_mid = rng.randint(22, 58)
    age_range = f"{max(18, age_mid - 6)}-{age_mid + 6}"
    female_prob = round(rng.uniform(0.18, 0.82), 3)
    male_prob = round(1 - female_prob, 3)

    quality = {
        "score": round(rng.uniform(0.73, 0.94), 3),
        "snr_estimate_db": round(rng.uniform(17.0, 29.0), 1),
        "notes": [
            "dummy_data_for_ui_validation",
            "replace_with_real_extractors_in_next_phase",
        ],
    }

    top_flags = sorted(metrics, key=lambda m: m["score"], reverse=True)[:3]
    executive_flags = [
        {
            "label": item["name"].replace("_", " "),
            "score": item["score"],
            "confidence": item["confidence"],
        }
        for item in top_flags
    ]

    ai_summary = (
        "Dummy summary: speech shows mild disfluency and moderate stress marker presence. "
        "Accent and speaker traits are provisional. Use as a screening-style signal only."
    )

    return {
        "report_id": f"sum_{uuid.uuid4().hex[:12]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "segment": segment,
        "duration_seconds": round(duration_seconds, 1),
        "provenance": {
            "model_stack": MODEL_STACK,
            "quality": quality,
        },
        "executive_summary": {
            "accent_prediction": accent,
            "accent_confidence": round(rng.uniform(0.55, 0.92), 3),
            "top_flags": executive_flags,
        },
        "content": {
            "phonemes": phonemes,
            "dys_detect": detected_dys_detect or [],
            "phonemes_source": "runpod" if detected_phonemes else "dummy",
            "user_transcription": user_transcription or "(no transcription captured)",
            "ai_transcription": ai_transcription or "(no assistant text captured)",
            "stress_binary": stress_binary,
        },
        "speaker_traits": {
            "age_range_estimate": age_range,
            "gender_probabilities": {
                "female": female_prob,
                "male": male_prob,
            },
        },
        "metrics": metrics,
        "ai_summary": ai_summary,
    }


def generate_dummy_chat_reply(*, report: dict[str, Any], message: str) -> str:
    msg = message.lower().strip()
    if not msg:
        return "Ask me about stress, disfluency, accent, or confidence."

    metrics = {m["name"]: m for m in report.get("metrics", [])}

    if "stress" in msg:
        m = metrics.get("stress")
        if m:
            return (
                f"Stress is {m['score']:.2f} with confidence {m['confidence']:.2f}. "
                "This is a dummy screening signal for now."
            )

    if "accent" in msg:
        accent = report.get("executive_summary", {}).get("accent_prediction", "unknown")
        conf = report.get("executive_summary", {}).get("accent_confidence", 0)
        return f"Predicted accent is {accent} at confidence {conf:.2f} (dummy)."

    if "phoneme" in msg:
        ph = report.get("content", {}).get("phonemes", [])
        preview = " ".join(ph[:12])
        return f"Detected phoneme sequence sample: {preview}."

    if "confidence" in msg:
        top = sorted(
            report.get("metrics", []), key=lambda x: x["confidence"], reverse=True
        )[:2]
        labels = ", ".join(f"{t['name']}={t['confidence']:.2f}" for t in top)
        return f"Highest-confidence metrics: {labels}."

    return (
        "Dummy report mode: I can explain stress, disfluency, accent, phonemes, "
        "and confidence values from this session summary."
    )
