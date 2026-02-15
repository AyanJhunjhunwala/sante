from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fpdf import FPDF
from openai import OpenAI

REPORTS_DIR = Path(__file__).resolve().parent.parent / "static" / "reports"


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

    phonemes = detected_phonemes or []
    dys_detect = detected_dys_detect or []
    acoustic = acoustic_features if isinstance(acoustic_features, dict) else None

    quality = _compute_quality(
        duration_seconds=duration_seconds,
        phoneme_count=len(phonemes),
        dys_detect=dys_detect,
        acoustic_features=acoustic,
    )

    estimates = _build_estimates(
        user_transcription=user_transcription,
        phonemes=phonemes,
        dys_detect=dys_detect,
        acoustic_features=acoustic,
        quality=quality,
    )

    top_flags = sorted(estimates, key=lambda e: e["score"], reverse=True)[:3]
    executive_summary = {
        "top_flags": [
            {
                "title": flag["title"],
                "level": flag["level"],
                "score": flag["score"],
                "confidence": flag["confidence"],
            }
            for flag in top_flags
        ],
        "quality_statement": quality["summary"],
        "recommended_followups": _recommended_followups(estimates, quality),
    }

    return {
        "report_id": f"sum_{uuid.uuid4().hex[:12]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "segment": segment,
        "duration_seconds": round(duration_seconds, 1),
        "quality": quality,
        "estimates": estimates,
        "executive_summary": executive_summary,
        "limitations": _global_limitations(quality),
        "content": {
            "user_transcription": user_transcription or "(no transcription captured)",
            "ai_transcription": ai_transcription or "(no assistant text captured)",
            "phonemes": phonemes,
            "dys_detect": dys_detect,
            "acoustic_features": acoustic,
        },
    }


def export_session_report_pdf(*, report: dict[str, Any]) -> str:
    """Generate a clinician-facing PDF and return a static URL path."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    report_id = str(report.get("report_id") or f"sum_{uuid.uuid4().hex[:12]}")
    filename = f"{report_id}.pdf"
    out_path = REPORTS_DIR / filename

    content = report.get("content", {})
    quality = report.get("quality", {})
    executive_summary = report.get("executive_summary", {})
    estimates = report.get("estimates", [])

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=14)

    pdf.set_font("Helvetica", "B", 18)
    _cell_line(pdf, _latin1("Sante Speech Health Summary"), 10)
    pdf.set_font("Helvetica", "", 10)
    _cell_line(
        pdf,
        _latin1(
            f"Report ID: {report_id} | Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
        ),
        6,
    )
    _cell_line(
        pdf,
        _latin1(
            f"Session: {report.get('segment', 'conversation')} | Duration: {report.get('duration_seconds', 0)}s"
        ),
        6,
    )
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 13)
    _cell_line(pdf, _latin1("Executive Summary"), 8)
    pdf.set_font("Helvetica", "", 10)
    _multi(pdf, _latin1(str(quality.get("summary", "No quality summary available."))), 6)
    for item in executive_summary.get("top_flags", [])[:3]:
        _multi(
            pdf,
            _latin1(
                f"- {item.get('title', 'Flag')}: {item.get('level', 'inconclusive')} "
                f"(score {item.get('score', 0)}, confidence {item.get('confidence', 0)}%)"
            ),
            6,
        )
    pdf.ln(1)

    pdf.set_font("Helvetica", "B", 13)
    _cell_line(pdf, _latin1("Estimates"), 8)
    pdf.set_font("Helvetica", "", 10)
    for est in estimates:
        pdf.set_font("Helvetica", "B", 10)
        _multi(
            pdf,
            _latin1(
                f"{est.get('title', 'Estimate')} | {est.get('level', 'inconclusive')} | "
                f"score {est.get('score', 0)} | confidence {est.get('confidence', 0)}%"
            ),
            6,
        )
        pdf.set_font("Helvetica", "", 10)
        _multi(pdf, _latin1(f"Suggestion: {est.get('suggestion', 'No suggestion available.')}"), 6)
        evidence = est.get("evidence", [])
        if evidence:
            _multi(pdf, _latin1("Evidence: " + "; ".join(str(e) for e in evidence[:4])), 6)
        limitations = est.get("limitations", [])
        if limitations:
            _multi(pdf, _latin1("Limitations: " + "; ".join(str(e) for e in limitations[:2])), 6)
        pdf.ln(1)

    pdf.set_font("Helvetica", "B", 13)
    _cell_line(pdf, _latin1("Transcript Snapshot"), 8)
    pdf.set_font("Helvetica", "", 10)
    transcript = str(content.get("user_transcription") or "No transcription captured.")
    _multi(pdf, _latin1(transcript[:1600]), 6)
    pdf.ln(2)

    pdf.set_font("Helvetica", "I", 9)
    _multi(
        pdf,
        _latin1(
            "Research-only estimate report. It is not a medical diagnosis. "
            "Use in combination with formal clinical assessment and environmental quality checks."
        ),
        5,
    )

    pdf.output(str(out_path))
    return f"/static/reports/{filename}"


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

    if "confidence" in msg or "quality" in msg or "noise" in msg:
        quality = report.get("quality", {})
        return (
            f"Quality grade: {quality.get('grade', 'N/A')} "
            f"(score {quality.get('score', 0)}%, confidence cap {quality.get('confidence_cap', 0)}%). "
            f"{quality.get('summary', 'No quality summary available.')}"
        )

    if "depress" in msg or "aphasia" in msg or "intoxic" in msg or "fatigue" in msg:
        estimates = report.get("estimates", [])
        if not estimates:
            return "No estimate categories available in this summary."
        lines = [
            f"{e.get('title')}: {e.get('level')} (score {e.get('score')}, confidence {e.get('confidence')}%)"
            for e in estimates[:6]
        ]
        return "Exploratory estimates:\n" + "\n".join(lines)

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


def _compute_quality(
    *,
    duration_seconds: float,
    phoneme_count: int,
    dys_detect: list[dict[str, Any]],
    acoustic_features: dict[str, Any] | None,
) -> dict[str, Any]:
    penalties: list[str] = []
    score = 100.0
    noise_likelihood = 0.1

    if duration_seconds < 20:
        score -= 25
        penalties.append("Short sample duration can distort stability metrics.")
        noise_likelihood += 0.1
    elif duration_seconds < 40:
        score -= 12
        penalties.append("Moderate sample length; repeat sample may improve reliability.")

    if phoneme_count < 35:
        score -= 18
        penalties.append("Low phoneme coverage reduces language-pattern confidence.")
        noise_likelihood += 0.1

    if not acoustic_features:
        score -= 28
        penalties.append("Acoustic feature extraction unavailable for this sample.")
        noise_likelihood += 0.15
    else:
        hnr = float(acoustic_features.get("hnr", 0.0))
        loudness_std = float(acoustic_features.get("loudness_std", 0.0))
        jitter = float(acoustic_features.get("jitter", 0.0))

        if hnr < 4.5:
            score -= 18
            penalties.append("Low harmonic-to-noise ratio suggests background/noise contamination.")
            noise_likelihood += 0.25
        elif hnr < 8.0:
            score -= 10
            penalties.append("Borderline harmonic-to-noise ratio; quality may be mixed.")
            noise_likelihood += 0.15

        if loudness_std > 0.45:
            score -= 8
            penalties.append("High loudness variability may reflect unstable recording conditions.")
            noise_likelihood += 0.15

        if jitter > 0.04:
            score -= 6
            noise_likelihood += 0.1

    dys_flags = [d for d in dys_detect if d.get("dysfluency_type") != "normal"]
    if len(dys_flags) > max(8, int(phoneme_count * 0.25)):
        score -= 6

    score = max(5.0, min(100.0, score))
    noise_likelihood = max(0.0, min(1.0, noise_likelihood))

    if score >= 85:
        grade = "A"
        confidence_cap = 92
    elif score >= 70:
        grade = "B"
        confidence_cap = 82
    elif score >= 55:
        grade = "C"
        confidence_cap = 70
    else:
        grade = "D"
        confidence_cap = 58

    summary = (
        "Data quality is high; exploratory interpretations are likely stable."
        if grade in {"A", "B"}
        else "Data quality is limited; treat outputs as coarse exploratory estimates only."
    )

    return {
        "score": round(score, 1),
        "grade": grade,
        "noise_likelihood": round(noise_likelihood, 2),
        "confidence_cap": confidence_cap,
        "summary": summary,
        "penalties": penalties,
    }


def _build_estimates(
    *,
    user_transcription: str,
    phonemes: list[str],
    dys_detect: list[dict[str, Any]],
    acoustic_features: dict[str, Any] | None,
    quality: dict[str, Any],
) -> list[dict[str, Any]]:
    dys_flags = [d for d in dys_detect if d.get("dysfluency_type") != "normal"]
    dys_ratio = (len(dys_flags) / max(1, len(dys_detect))) if dys_detect else 0.0

    f0 = float((acoustic_features or {}).get("f0_mean", 0.0))
    hnr = float((acoustic_features or {}).get("hnr", 0.0))
    jitter = float((acoustic_features or {}).get("jitter", 0.0))
    shimmer = float((acoustic_features or {}).get("shimmer_db", 0.0))
    pause_len = float((acoustic_features or {}).get("mean_pause_length", 0.0))
    speaking_rate = float((acoustic_features or {}).get("speaking_rate", 0.0))
    voiced_rate = float((acoustic_features or {}).get("voiced_segments_per_sec", 0.0))

    words = [w for w in user_transcription.strip().split() if w]
    word_count = len(words)
    confidence_cap = int(quality.get("confidence_cap", 70))
    low_quality = quality.get("grade") in {"C", "D"}

    def mk_estimate(
        *,
        key: str,
        title: str,
        score: float,
        base_confidence: float,
        evidence: list[str],
        limitations: list[str],
        suggestion: str,
    ) -> dict[str, Any]:
        bounded_score = int(max(1, min(99, round(score))))
        confidence = int(max(20, min(confidence_cap, round(base_confidence))))
        level = _score_to_level(bounded_score, low_quality)
        return {
            "key": key,
            "title": title,
            "score": bounded_score,
            "confidence": confidence,
            "level": level,
            "is_estimate": True,
            "evidence": evidence,
            "limitations": limitations + _global_limitations(quality),
            "suggestion": suggestion,
        }

    depression_score = 25 + (pause_len * 18) + ((0.45 - speaking_rate) * 35) + (dys_ratio * 22)
    depression_conf = 62 + (word_count / 20)
    depression_evidence = [
        f"Mean pause length {pause_len:.2f}s",
        f"Speaking-rate proxy {speaking_rate:.2f} peaks/s",
        f"Disfluency ratio {dys_ratio:.2f}",
    ]
    depression_limits = ["Speech-only estimate; mood state can be situational."]

    aphasia_score = 20 + (dys_ratio * 55) + (max(0.0, 0.14 - voiced_rate) * 180)
    aphasia_conf = 58 + (len(phonemes) / 25)
    aphasia_evidence = [
        f"Phoneme coverage {len(phonemes)} tokens",
        f"Flagged disfluencies {len(dys_flags)}",
        f"Voiced segment rate {voiced_rate:.2f}/s",
    ]
    aphasia_limits = ["Cannot subtype aphasia from this short speech sample."]

    age_score = 38 + (max(0.0, 170 - f0) * 0.18) + (jitter * 280)
    age_conf = 57 + (len(phonemes) / 30)
    age_evidence = [f"F0 mean {f0:.2f} st", f"Jitter {jitter:.3f}"]
    age_limits = ["Only estimates broad vocal age band, not chronological age."]

    intox_score = 18 + (jitter * 520) + (shimmer * 13) + (pause_len * 16)
    intox_conf = 60 + (word_count / 30)
    intox_evidence = [
        f"Jitter {jitter:.3f}",
        f"Shimmer {shimmer:.3f} dB",
        f"Mean pause length {pause_len:.2f}s",
    ]
    intox_limits = ["Medication, fatigue, and microphone clipping can mimic this pattern."]

    fatigue_score = 24 + (pause_len * 14) + (max(0.0, 0.35 - speaking_rate) * 42) + (dys_ratio * 20)
    fatigue_conf = 64 + (word_count / 25)
    fatigue_evidence = [
        f"Speech pacing proxy {speaking_rate:.2f} peaks/s",
        f"Pause duration {pause_len:.2f}s",
        f"Disfluency ratio {dys_ratio:.2f}",
    ]
    fatigue_limits = ["Single-session fatigue score is highly context-dependent."]

    strain_score = 22 + (max(0.0, 10.0 - hnr) * 4.2) + (shimmer * 8) + (jitter * 320)
    strain_conf = 66 + (word_count / 35)
    strain_evidence = [
        f"HNR {hnr:.2f} dB",
        f"Shimmer {shimmer:.3f} dB",
        f"Jitter {jitter:.3f}",
    ]
    strain_limits = ["Breathing pattern cannot be directly measured from this sample."]

    return [
        mk_estimate(
            key="depression_risk",
            title="Mood / Depression Risk Signal",
            score=depression_score,
            base_confidence=depression_conf,
            evidence=depression_evidence,
            limitations=depression_limits,
            suggestion="Track trend across multiple days and pair with self-reported mood scales.",
        ),
        mk_estimate(
            key="aphasia_pattern",
            title="Aphasia-like Language Pattern Flag",
            score=aphasia_score,
            base_confidence=aphasia_conf,
            evidence=aphasia_evidence,
            limitations=aphasia_limits,
            suggestion="If persistent, run structured language tasks and formal aphasia batteries.",
        ),
        mk_estimate(
            key="age_gender_proxy",
            title="Perceived Vocal Age / Gender Proxy",
            score=age_score,
            base_confidence=age_conf,
            evidence=age_evidence,
            limitations=age_limits,
            suggestion="Use only as demographic context; avoid identity or eligibility decisions.",
        ),
        mk_estimate(
            key="intoxication_slur",
            title="Slurred Speech / Intoxication Likelihood",
            score=intox_score,
            base_confidence=intox_conf,
            evidence=intox_evidence,
            limitations=intox_limits,
            suggestion="Confirm with behavioral checks and contextual history before acting.",
        ),
        mk_estimate(
            key="cognitive_fatigue",
            title="Cognitive Load / Fatigue Proxy",
            score=fatigue_score,
            base_confidence=fatigue_conf,
            evidence=fatigue_evidence,
            limitations=fatigue_limits,
            suggestion="Repeat under controlled conditions and compare with baseline sessions.",
        ),
        mk_estimate(
            key="voice_strain_resp",
            title="Voice Strain / Respiratory Effort Indicator",
            score=strain_score,
            base_confidence=strain_conf,
            evidence=strain_evidence,
            limitations=strain_limits,
            suggestion="Consider hydration, rest, and ENT/SLP follow-up if trend worsens.",
        ),
    ]


def _score_to_level(score: int, low_quality: bool) -> str:
    if low_quality:
        if score >= 72:
            return "exploratory-high"
        if score >= 52:
            return "exploratory-moderate"
        return "exploratory-low"

    if score >= 72:
        return "high"
    if score >= 52:
        return "moderate"
    return "low"


def _recommended_followups(estimates: list[dict[str, Any]], quality: dict[str, Any]) -> list[str]:
    recs = ["Repeat session in a quieter room to improve reliability."]
    if quality.get("grade") in {"C", "D"}:
        recs.append("Collect at least 90 seconds of speech for stronger trend estimates.")

    for est in estimates:
        if est.get("score", 0) >= 70:
            recs.append(f"Review \"{est.get('title')}\" with a clinician using multi-session context.")
    return recs[:5]


def _global_limitations(quality: dict[str, Any]) -> list[str]:
    limits = [
        "Exploratory speech biomarkers are probabilistic, not diagnostic outcomes.",
        "Single-session inference may be confounded by stress, sleep, illness, or microphone quality.",
    ]
    noise_likelihood = float(quality.get("noise_likelihood", 0.0))
    if noise_likelihood >= 0.5:
        limits.append("Elevated background-noise likelihood may bias acoustic interpretation.")
    return limits


def _latin1(text: str) -> str:
    normalized = _split_long_tokens(text)
    return normalized.encode("latin-1", errors="replace").decode("latin-1")


def _cell_line(pdf: FPDF, text: str, h: float) -> None:
    _multi(pdf, text, h)


def _multi(pdf: FPDF, text: str, h: float) -> None:
    pdf.set_x(pdf.l_margin)
    width = max(20.0, pdf.w - pdf.l_margin - pdf.r_margin)
    pdf.multi_cell(width, h, text)


def _split_long_tokens(text: str, max_token_len: int = 28) -> str:
    chunks: list[str] = []
    for token in re.split(r"(\s+)", text):
        if token.isspace() or len(token) <= max_token_len:
            chunks.append(token)
            continue
        parts = [token[i : i + max_token_len] for i in range(0, len(token), max_token_len)]
        chunks.append(" ".join(parts))
    return "".join(chunks)
