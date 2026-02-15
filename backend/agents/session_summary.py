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
        duration_seconds=duration_seconds,
        quality=quality,
    )

    top_flags = sorted(estimates, key=lambda e: e["score"], reverse=True)[:3]
    executive_summary = {
        "top_flags": [
            {
                "title": flag["title"],
                "level": flag["level"],
                "score": flag["score"],
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
                f"(score {item.get('score', 0)})"
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
                f"score {est.get('score', 0)}"
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


def generate_ai_report_sections(*, report: dict[str, Any]) -> dict[str, str]:
    """Generate a sectioned AI summary for streamlined UI rendering."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip().strip('"').strip("'")
    if not api_key:
        return _fallback_ai_sections(report)

    content = report.get("content", {})
    acoustics = content.get("acoustic_features") or {}
    phonemes = content.get("phonemes", [])
    dys_detect = content.get("dys_detect", [])
    quality = report.get("quality", {})
    estimates = report.get("estimates", [])

    flags = [d for d in dys_detect if d.get("dysfluency_type") != "normal"]
    top_estimates = sorted(estimates, key=lambda x: x.get("score", 0), reverse=True)[:4]

    data_block = {
        "duration_seconds": report.get("duration_seconds", 0),
        "quality": quality,
        "phoneme_count": len(phonemes),
        "disfluency_count": len(flags),
        "top_estimates": top_estimates,
        "acoustic_features": acoustics,
        "transcription": (content.get("user_transcription") or "")[:900],
    }

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a speech-language pathology research assistant. "
                        "Return JSON only with keys: overview, voice_quality, fluency, "
                        "prosody_rhythm, exploratory_risk_signals, confidence_limitations, follow_up. "
                        "Each value must be 1-2 short sentences (max 45 words), specific and plain-language. "
                        "Do not diagnose. Use cautious language and mention uncertainty/noise where relevant."
                    ),
                },
                {"role": "user", "content": str(data_block)},
            ],
            temperature=0.35,
            max_tokens=1400,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or ""
        parsed = _safe_parse_json(raw)
        required = [
            "overview",
            "voice_quality",
            "fluency",
            "prosody_rhythm",
            "exploratory_risk_signals",
            "confidence_limitations",
            "follow_up",
        ]
        if not isinstance(parsed, dict) or not all(k in parsed for k in required):
            return _fallback_ai_sections(report)
        return {k: str(parsed.get(k, "")).strip() for k in required}
    except Exception:
        return _fallback_ai_sections(report)


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
            f"(score {quality.get('score', 0)}%). "
            f"{quality.get('summary', 'No quality summary available.')}"
        )

    if "depress" in msg or "aphasia" in msg or "intoxic" in msg or "fatigue" in msg:
        estimates = report.get("estimates", [])
        if not estimates:
            return "No estimate categories available in this summary."
        lines = [
            f"{e.get('title')}: {e.get('level')} (score {e.get('score')})"
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
        penalties.append("Low phoneme coverage reduces language-pattern certainty.")
        noise_likelihood += 0.1

    if not acoustic_features:
        score -= 28
        penalties.append("Acoustic feature extraction unavailable for this sample.")
        noise_likelihood += 0.15
    else:
        hnr = float(acoustic_features.get("hnr", 0.0))
        loudness_std = float(acoustic_features.get("loudness_std", 0.0))
        jitter = float(acoustic_features.get("jitter", 0.0))
        speaking_rate = float(acoustic_features.get("speaking_rate", 0.0))
        voiced_rate = float(acoustic_features.get("voiced_segments_per_sec", 0.0))

        if hnr < 6.0:
            score -= 18
            penalties.append("Low harmonic-to-noise ratio suggests background/noise contamination.")
            noise_likelihood += 0.25
        elif hnr < 10.0:
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

        if speaking_rate > 2.1 or voiced_rate > 2.1:
            score -= 12
            penalties.append(
                "Very high temporal-segmentation rate suggests unstable capture conditions (recording/microphone/codec mismatch may be inflating segment counts)."
            )
            noise_likelihood += 0.2

    dys_flags = [d for d in dys_detect if d.get("dysfluency_type") != "normal"]
    if len(dys_flags) > max(8, int(phoneme_count * 0.25)):
        score -= 6

    score = max(5.0, min(100.0, score))
    noise_likelihood = max(0.0, min(1.0, noise_likelihood))

    if score >= 85:
        grade = "A"
    elif score >= 70:
        grade = "B"
    elif score >= 55:
        grade = "C"
    else:
        grade = "D"

    summary = (
        "Data quality is high; exploratory interpretations are likely stable."
        if grade in {"A", "B"}
        else "Data quality is limited; treat outputs as coarse exploratory estimates only."
    )

    return {
        "score": round(score, 1),
        "grade": grade,
        "noise_likelihood": round(noise_likelihood, 2),
        "summary": summary,
        "penalties": penalties,
    }


def _build_estimates(
    *,
    user_transcription: str,
    phonemes: list[str],
    dys_detect: list[dict[str, Any]],
    acoustic_features: dict[str, Any] | None,
    duration_seconds: float,
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
    unique_word_count = len({w.lower() for w in words})
    lexical_diversity = (unique_word_count / max(1, word_count)) if word_count else 0.0
    phoneme_count = len(phonemes)
    quality_score = float(quality.get("score", 50.0))
    noise_likelihood = float(quality.get("noise_likelihood", 0.35))
    low_quality = quality.get("grade") in {"C", "D"}

    def clamp01(value: float) -> float:
        return max(0.0, min(1.0, value))

    def norm(value: float, lo: float, hi: float) -> float:
        if hi <= lo:
            return 0.0
        return clamp01((value - lo) / (hi - lo))

    acoustic_coverage = 1.0 if acoustic_features else 0.0
    duration_coverage = norm(duration_seconds, 25.0, 90.0)
    word_coverage = norm(word_count, 16.0, 75.0)
    phoneme_coverage = norm(phoneme_count, 30.0, 145.0)
    coverage = (acoustic_coverage + duration_coverage + word_coverage + phoneme_coverage) / 4.0

    quality_trust = clamp01((quality_score / 100.0) * (1.0 - (0.65 * noise_likelihood)))
    skepticism_scale = max(0.26, min(0.86, 0.34 + (0.52 * quality_trust) + (0.10 * coverage)))

    pause_long = norm(pause_len, 0.55, 1.60)
    slow_rate = norm(0.50 - speaking_rate, 0.0, 0.45)
    low_voiced_rate = norm(0.20 - voiced_rate, 0.0, 0.20)
    voiced_short = norm(0.19 - float((acoustic_features or {}).get("mean_voiced_length", 0.0)), 0.0, 0.19)
    jitter_high = norm(jitter, 0.015, 0.060)
    shimmer_high = norm(shimmer, 0.80, 2.80)
    low_hnr = norm(4.5 - hnr, 0.0, 3.5)
    loudness_volatility = norm(float((acoustic_features or {}).get("loudness_std", 0.0)), 0.40, 3.20)
    low_loudness = norm(0.08 - float((acoustic_features or {}).get("loudness_mean", 0.0)), 0.0, 0.08)
    prosody_flat = norm(0.26 - float((acoustic_features or {}).get("f0_std", 0.0)), 0.0, 0.26)
    dys_pressure = clamp01((0.65 * dys_ratio) + (0.35 * norm(len(dys_flags), 2.0, 34.0)))
    lexical_sparse = norm(30.0 - word_count, 0.0, 30.0)
    lexical_repetitive = norm(0.56 - lexical_diversity, 0.0, 0.56)

    context_penalty = (
        (1.0 - duration_coverage) * 0.24
        + (1.0 - phoneme_coverage) * 0.23
        + (1.0 - word_coverage) * 0.18
        + noise_likelihood * 0.19
        + (1.0 - acoustic_coverage) * 0.13
    )

    low_risk_coherence = clamp01(
        ((1.0 - pause_long) * 0.18)
        + ((1.0 - slow_rate) * 0.16)
        + ((1.0 - dys_pressure) * 0.14)
        + ((1.0 - jitter_high) * 0.14)
        + ((1.0 - shimmer_high) * 0.10)
        + ((1.0 - low_hnr) * 0.10)
        + ((1.0 - low_voiced_rate) * 0.06)
        + (coverage * 0.06)
        + ((1.0 - noise_likelihood) * 0.06)
    )
    data_stability = clamp01((quality_trust * 0.58) + (coverage * 0.42))

    def skeptical_score(
        signals: list[tuple[str, float, float]],
        *,
        confound_penalty: float = 0.0,
    ) -> int:
        weighted_sum = sum(value * weight for _, value, weight in signals)
        weight_total = sum(weight for _, _, weight in signals) or 1.0
        base = weighted_sum / weight_total
        agreement = sum(1 for _, value, _ in signals if value >= 0.55) / max(1, len(signals))
        spread = max(value for _, value, _ in signals) - min(value for _, value, _ in signals)

        score = base * 100.0
        score *= skepticism_scale
        score *= 0.70 + (0.30 * agreement)
        score *= 1.0 - (0.20 * spread)
        score *= 1.0 - (0.34 * context_penalty)
        score *= 1.0 - (0.28 * clamp01(confound_penalty))
        score *= 1.0 - (0.24 * low_risk_coherence * data_stability)

        return int(max(1, min(99, round(score))))

    def calibrate_signal_score(signal_key: str, raw_score: int) -> int:
        score = float(raw_score)
        attenuation_context = clamp01((low_risk_coherence * 0.62) + (data_stability * 0.38))

        if signal_key == "intoxication_slur":
            score -= 3.0 + (3.5 * attenuation_context)
            if score < 24:
                score *= 0.94
        elif signal_key == "aphasia_pattern":
            score -= 2.0 + (2.8 * attenuation_context)
            if score < 18:
                score *= 0.92
        elif signal_key == "voice_strain_resp":
            score -= 4.0 + (4.2 * attenuation_context)
            if score < 40:
                score *= 0.90
        elif signal_key == "cognitive_fatigue":
            score -= 2.0 + (2.4 * attenuation_context)
            if score < 16:
                score *= 0.93

        return int(max(1, min(99, round(score))))

    def mk_estimate(
        *,
        key: str,
        title: str,
        score: float,
        evidence: list[str],
        limitations: list[str],
        suggestion: str,
    ) -> dict[str, Any]:
        bounded_score = int(max(1, min(99, round(score))))
        level = _score_to_level(bounded_score, low_quality)
        return {
            "key": key,
            "title": title,
            "score": bounded_score,
            "level": level,
            "is_estimate": True,
            "evidence": evidence,
            "limitations": limitations + _global_limitations(quality),
            "suggestion": _adapt_estimate_suggestion(
                suggestion,
                score=bounded_score,
                quality=quality,
            ),
        }

    depression_score = calibrate_signal_score(
        "depression_risk",
        skeptical_score(
        [
            ("long_pauses", pause_long, 0.30),
            ("slow_rate", slow_rate, 0.24),
            ("dys_pressure", dys_pressure, 0.18),
            ("prosody_flat", prosody_flat, 0.16),
            ("low_loudness", low_loudness, 0.12),
        ],
        confound_penalty=(0.55 * noise_likelihood) + (0.25 * jitter_high),
        ),
    )
    depression_evidence = [
        f"Mean pause length {pause_len:.2f}s",
        f"Speaking-rate proxy {speaking_rate:.2f} peaks/s",
        f"Disfluency ratio {dys_ratio:.2f}",
        f"Skepticism scaling {skepticism_scale:.2f} after quality/noise/coverage penalties",
    ]
    depression_limits = ["Speech-only estimate; mood state can be situational."]

    aphasia_score = calibrate_signal_score(
        "aphasia_pattern",
        skeptical_score(
        [
            ("dys_pressure", dys_pressure, 0.34),
            ("low_voiced_rate", low_voiced_rate, 0.22),
            ("pause_long", pause_long, 0.14),
            ("lexical_sparse", lexical_sparse, 0.15),
            ("lexical_repetitive", lexical_repetitive, 0.15),
        ],
        confound_penalty=(0.45 * noise_likelihood) + (0.20 * slow_rate),
        ),
    )
    aphasia_evidence = [
        f"Phoneme coverage {phoneme_count} tokens",
        f"Flagged disfluencies {len(dys_flags)}",
        f"Voiced segment rate {voiced_rate:.2f}/s",
        f"Lexical diversity {lexical_diversity:.2f}",
    ]
    aphasia_limits = ["Cannot subtype aphasia from this short speech sample."]

    low_f0_proxy = norm(170.0 - f0, 0.0, 120.0)
    age_score = calibrate_signal_score(
        "age_gender_proxy",
        skeptical_score(
        [
            ("f0_proxy", low_f0_proxy, 0.48),
            ("jitter_high", jitter_high, 0.22),
            ("voiced_short", voiced_short, 0.12),
            ("prosody_flat", prosody_flat, 0.18),
        ],
        confound_penalty=(0.55 * noise_likelihood) + (0.20 * (1.0 - acoustic_coverage)),
        ),
    )
    age_evidence = [
        f"F0 mean {f0:.2f} st",
        f"Jitter {jitter:.3f}",
        f"Skepticism scaling {skepticism_scale:.2f} after quality/noise/coverage penalties",
    ]
    age_limits = ["Only estimates broad vocal age band, not chronological age."]

    intox_score = calibrate_signal_score(
        "intoxication_slur",
        skeptical_score(
        [
            ("jitter_high", jitter_high, 0.30),
            ("shimmer_high", shimmer_high, 0.24),
            ("pause_long", pause_long, 0.18),
            ("slow_rate", slow_rate, 0.14),
            ("dys_pressure", dys_pressure, 0.14),
        ],
        confound_penalty=(0.55 * noise_likelihood) + (0.30 * prosody_flat),
        ),
    )
    intox_evidence = [
        f"Jitter {jitter:.3f}",
        f"Shimmer {shimmer:.3f} dB",
        f"Mean pause length {pause_len:.2f}s",
        f"Skepticism scaling {skepticism_scale:.2f} after quality/noise/coverage penalties",
    ]
    intox_limits = ["Medication, fatigue, and microphone clipping can mimic this pattern."]

    fatigue_score = calibrate_signal_score(
        "cognitive_fatigue",
        skeptical_score(
        [
            ("pause_long", pause_long, 0.30),
            ("slow_rate", slow_rate, 0.24),
            ("prosody_flat", prosody_flat, 0.16),
            ("dys_pressure", dys_pressure, 0.15),
            ("low_loudness", low_loudness, 0.15),
        ],
        confound_penalty=(0.35 * noise_likelihood) + (0.20 * shimmer_high),
        ),
    )
    fatigue_evidence = [
        f"Speech pacing proxy {speaking_rate:.2f} peaks/s",
        f"Pause duration {pause_len:.2f}s",
        f"Disfluency ratio {dys_ratio:.2f}",
        f"Lexical diversity {lexical_diversity:.2f}",
    ]
    fatigue_limits = ["Single-session fatigue score is highly context-dependent."]

    strain_score = calibrate_signal_score(
        "voice_strain_resp",
        skeptical_score(
        [
            ("low_hnr", low_hnr, 0.33),
            ("shimmer_high", shimmer_high, 0.22),
            ("jitter_high", jitter_high, 0.18),
            ("voiced_short", voiced_short, 0.14),
            ("loudness_volatility", loudness_volatility, 0.13),
        ],
        confound_penalty=(0.50 * noise_likelihood) + (0.20 * (1.0 - acoustic_coverage)),
        ),
    )
    strain_evidence = [
        f"HNR {hnr:.2f} dB",
        f"Shimmer {shimmer:.3f} dB",
        f"Jitter {jitter:.3f}",
        f"Loudness variability {float((acoustic_features or {}).get('loudness_std', 0.0)):.3f}",
    ]
    strain_limits = ["Breathing pattern cannot be directly measured from this sample."]

    return [
        mk_estimate(
            key="depression_risk",
            title="Mood / Depression Risk Signal",
            score=depression_score,
            evidence=depression_evidence,
            limitations=depression_limits,
            suggestion="Run this check across multiple sessions and watch for a rising mood-risk trend.",
        ),
        mk_estimate(
            key="aphasia_pattern",
            title="Aphasia-like Language Pattern Flag",
            score=aphasia_score,
            evidence=aphasia_evidence,
            limitations=aphasia_limits,
            suggestion="If this stays elevated, run structured language testing with an SLP.",
        ),
        mk_estimate(
            key="age_gender_proxy",
            title="Perceived Vocal Age / Gender Proxy",
            score=age_score,
            evidence=age_evidence,
            limitations=age_limits,
            suggestion="Use this as a voice-profile baseline and compare against future sessions.",
        ),
        mk_estimate(
            key="intoxication_slur",
            title="Slurred Speech / Intoxication Likelihood",
            score=intox_score,
            evidence=intox_evidence,
            limitations=intox_limits,
            suggestion="Treat this as a high-priority clarity alert and confirm with immediate follow-up checks.",
        ),
        mk_estimate(
            key="cognitive_fatigue",
            title="Cognitive Load / Fatigue Proxy",
            score=fatigue_score,
            evidence=fatigue_evidence,
            limitations=fatigue_limits,
            suggestion="Retest after rest and compare directly to your baseline session.",
        ),
        mk_estimate(
            key="voice_strain_resp",
            title="Voice Strain / Respiratory Effort Indicator",
            score=strain_score,
            evidence=strain_evidence,
            limitations=strain_limits,
            suggestion="Reduce vocal load now and schedule follow-up if this remains elevated.",
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


def _adapt_estimate_suggestion(base_suggestion: str, *, score: int, quality: dict[str, Any]) -> str:
    if score <= 50:
        return (
            "Low signal in this sample. Monitor trend across repeated sessions and retest with a matched "
            "microphone/device/codec setup before drawing conclusions."
        )

    if score <= 69:
        return (
            f"{base_suggestion} "
            "Treat this as a cautious follow-up signal; confirm persistence with repeat sessions using a matched setup."
        )

    if quality.get("grade") in {"C", "D"}:
        return (
            f"{base_suggestion} "
            "Given limited sample quality, keep this exploratory and confirm through matched-setup retests and broader assessment."
        )
    return base_suggestion


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
        "Changing microphone/device/codec can shift absolute acoustic values; trend comparisons should use a matched capture setup.",
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


def _fallback_ai_sections(report: dict[str, Any]) -> dict[str, str]:
    content = report.get("content", {})
    acoustics = content.get("acoustic_features") or {}
    quality = report.get("quality", {})
    estimates = report.get("estimates", [])
    flags = sorted(estimates, key=lambda x: x.get("score", 0), reverse=True)[:3]

    jitter = float(acoustics.get("jitter", 0.0))
    shimmer = float(acoustics.get("shimmer_db", 0.0))
    hnr = float(acoustics.get("hnr", 0.0))
    pause = float(acoustics.get("mean_pause_length", 0.0))
    rate = float(acoustics.get("speaking_rate", 0.0))
    dys = [d for d in content.get("dys_detect", []) if d.get("dysfluency_type") != "normal"]

    flag_text = ", ".join(f.get("title", "flag") for f in flags) if flags else "no high-priority flags"
    quality_grade = quality.get("grade", "N/A")
    quality_score = quality.get("score", 0)
    noise_pct = round(float(quality.get("noise_likelihood", 0)) * 100)

    return {
        "overview": (
            f"This session produced a {quality_grade}-grade signal profile ({quality_score}% quality) with "
            f"about {noise_pct}% estimated background-noise likelihood. Top exploratory markers were {flag_text}."
        ),
        "voice_quality": (
            f"Voice stability metrics show jitter at {jitter:.3f}, shimmer at {shimmer:.3f} dB, and HNR at {hnr:.2f} dB. "
            "Lower HNR with elevated shimmer can reflect either vocal strain or noisy capture conditions."
        ),
        "fluency": (
            f"Disfluency detection flagged {len(dys)} events in this sample. "
            "Prioritize repeat-session consistency over one-time counts."
        ),
        "prosody_rhythm": (
            f"Prosodic timing proxies show speaking rate near {rate:.2f} peaks/s with mean pauses around {pause:.2f}s. "
            "A structured retest with matched prompts helps separate baseline rhythm from temporary load effects."
        ),
        "exploratory_risk_signals": (
            "Exploratory risk categories prioritize sensitivity and may over-call in noisy settings. "
            "Treat top categories as follow-up hypotheses, not standalone outcomes."
        ),
        "confidence_limitations": (
            f"Uncertainty is constrained by data quality ({quality_grade}) and environmental noise ({noise_pct}% estimated impact). "
            "Single-session speech biomarkers are probabilistic and should be replicated under controlled conditions."
        ),
        "follow_up": (
            "Repeat a short protocol in a quieter room with the same microphone position and prompts. "
            "Track quality grade, risk ordering, and pause/voice-stability trends over time."
        ),
    }


def _safe_parse_json(text: str) -> dict[str, Any] | None:
    import json

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None
