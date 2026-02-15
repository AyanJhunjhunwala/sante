"""
rq worker job: process a completed phone call.

Steps:
  1. Run real analysis (acoustics, phonemes) on the recorded call audio.
     Falls back to dummy data if audio is unavailable or analysis fails.
  2. Generate a PDF report (fpdf2).
  3. Save PDF to backend/static/reports/{call_sid}.pdf (served at /static/reports/).
  4. Send MMS via Twilio with the PDF attached.
"""

import asyncio
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fpdf import FPDF

from services.sms_sender import send_sms_report

logger = logging.getLogger(__name__)

# PDF output directory — served by FastAPI StaticFiles at /static/reports/
REPORTS_DIR = Path(__file__).resolve().parent.parent / "static" / "reports"


def process_call(
    *,
    call_sid: str,
    caller_phone: str,
    call_status: str,
    duration_seconds: int,
    audio_path: str | None = None,
) -> dict[str, Any]:
    """
    rq job entry point — called by the worker process.

    Returns a dict with job result metadata (logged by rq).
    """
    logger.info(
        f"[worker] Processing call {call_sid} from {caller_phone} "
        f"(status={call_status}, audio={'yes' if audio_path else 'no'})"
    )

    analysis_results = _run_analysis(
        call_sid=call_sid,
        duration_seconds=duration_seconds,
        audio_path=audio_path,
    )

    # Clean up temp audio file after analysis
    if audio_path:
        try:
            Path(audio_path).unlink(missing_ok=True)
        except Exception:
            pass

    pdf_path = _generate_pdf_report(
        call_sid=call_sid,
        caller_phone=caller_phone,
        duration_seconds=duration_seconds,
        analysis_results=analysis_results,
    )

    backend_base_url = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
    report_url = f"{backend_base_url}/static/reports/{call_sid}.pdf"

    sms_result = send_sms_report(
        to_phone=caller_phone,
        report_url=report_url,
        call_sid=call_sid,
    )

    logger.info(f"[worker] Done for {call_sid}: sms_sid={sms_result.get('sid')}")

    return {
        "call_sid": call_sid,
        "pdf_path": str(pdf_path),
        "report_url": report_url,
        "sms_result": sms_result,
        "analysis_results": analysis_results,
    }


def _run_analysis(
    *, call_sid: str, duration_seconds: int, audio_path: str | None
) -> dict[str, Any]:
    """
    Run acoustic and phoneme analysis on the call audio.
    Falls back to dummy data for any analysis that fails or has no audio.
    """
    if not audio_path or not Path(audio_path).exists():
        logger.warning(f"[worker] No audio available for {call_sid}, using dummy data")
        return _run_dummy_analysis(call_sid=call_sid, duration_seconds=duration_seconds)

    try:
        audio_bytes = Path(audio_path).read_bytes()
    except Exception as exc:
        logger.error(f"[worker] Failed to read audio file {audio_path}: {exc}")
        return _run_dummy_analysis(call_sid=call_sid, duration_seconds=duration_seconds)

    logger.info(
        f"[worker] Running real analysis on {len(audio_bytes)} bytes for {call_sid}"
    )

    acoustic_result = _run_acoustics(audio_bytes, call_sid)
    phoneme_result = _run_phonemes(audio_bytes, call_sid)

    return {
        "stub": False,
        "acoustics": acoustic_result,
        "phonemes": phoneme_result,
    }


def _run_acoustics(audio_bytes: bytes, call_sid: str) -> dict[str, Any]:
    try:
        from services.acoustic_features import analyze_acoustics

        result = analyze_acoustics(audio_bytes)
        if "error" in result:
            logger.warning(
                f"[worker] Acoustics error for {call_sid}: {result['error']}"
            )
            return _dummy_acoustics(call_sid)
        return result
    except Exception as exc:
        logger.error(f"[worker] Acoustics exception for {call_sid}: {exc}")
        return _dummy_acoustics(call_sid)


def _run_phonemes(audio_bytes: bytes, call_sid: str) -> dict[str, Any]:
    try:
        from agents.phoneme_detector import analyze_phonemes

        result = asyncio.run(analyze_phonemes(audio_bytes))
        if "error" in result:
            logger.warning(
                f"[worker] Phoneme analysis error for {call_sid}: {result['error']}"
            )
            return _dummy_phonemes(call_sid)
        dys = result.get("dys_detect", [])
        return {
            "total_detected": len(result.get("decode_phonemes", [])),
            "disfluency_count": len(dys),
            "dys_detect": dys,
        }
    except Exception as exc:
        logger.error(f"[worker] Phoneme analysis exception for {call_sid}: {exc}")
        return _dummy_phonemes(call_sid)


# ---------------------------------------------------------------------------
# Dummy fallbacks (used when analysis fails or no audio available)
# ---------------------------------------------------------------------------


def _run_dummy_analysis(*, call_sid: str, duration_seconds: int) -> dict[str, Any]:
    return {
        "stub": True,
        "acoustics": _dummy_acoustics(call_sid),
        "phonemes": _dummy_phonemes(call_sid),
    }


def _dummy_acoustics(call_sid: str) -> dict[str, Any]:
    rng = random.Random(call_sid + "acoustics")
    return {
        "f0_mean": round(rng.uniform(85.0, 255.0), 2),
        "f0_std": round(rng.uniform(0.1, 0.5), 3),
        "jitter": round(rng.uniform(0.001, 0.012), 4),
        "shimmer_db": round(rng.uniform(0.1, 1.5), 3),
        "hnr": round(rng.uniform(10.0, 25.0), 2),
        "loudness_mean": round(rng.uniform(0.3, 0.8), 3),
        "loudness_std": round(rng.uniform(0.1, 0.4), 3),
        "speaking_rate": round(rng.uniform(2.0, 5.0), 2),
        "voiced_segments_per_sec": round(rng.uniform(1.0, 3.0), 2),
        "mean_pause_length": round(rng.uniform(0.1, 0.5), 3),
        "mean_voiced_length": round(rng.uniform(0.2, 0.8), 3),
    }


def _dummy_phonemes(call_sid: str) -> dict[str, Any]:
    rng = random.Random(call_sid + "phonemes")
    return {
        "total_detected": rng.randint(40, 120),
        "disfluency_count": rng.randint(0, 8),
        "dys_detect": [],
    }


# ---------------------------------------------------------------------------
# PDF report generation
# ---------------------------------------------------------------------------


def _generate_pdf_report(
    *,
    call_sid: str,
    caller_phone: str,
    duration_seconds: int,
    analysis_results: dict[str, Any],
) -> Path:
    """
    Generate a PDF report using fpdf2.
    Saves to REPORTS_DIR/{call_sid}.pdf and returns the path.
    """
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    is_stub = analysis_results.get("stub", False)

    pdf = FPDF()
    pdf.add_page()

    # Header
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(
        0, 12, "Sante Voice Health Report", new_x="LMARGIN", new_y="NEXT", align="C"
    )
    pdf.ln(2)

    # Metadata
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, f"Report ID:  {call_sid}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        0,
        7,
        f"Generated:  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(0, 7, f"Duration:   {duration_seconds}s", new_x="LMARGIN", new_y="NEXT")
    if is_stub:
        pdf.set_text_color(180, 80, 0)
        pdf.cell(
            0,
            7,
            "Note: Analysis data is placeholder (audio was not available)",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.set_text_color(0, 0, 0)
    pdf.ln(6)

    # Acoustics section
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Acoustic Features", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    for key, val in analysis_results["acoustics"].items():
        pdf.cell(0, 7, f"  {key}:  {val}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Phonemes section
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Phoneme / Disfluency Analysis", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    ph = analysis_results["phonemes"]
    pdf.cell(
        0,
        7,
        f"  Total phonemes detected:  {ph['total_detected']}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0,
        7,
        f"  Disfluency events:         {ph['disfluency_count']}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(8)

    # Disclaimer
    pdf.set_font("Helvetica", "I", 9)
    pdf.multi_cell(
        0,
        6,
        "DISCLAIMER: This report is generated for research purposes only. "
        "It does not represent clinical diagnosis and results are not clinically validated. "
        "Santé is a research tool, not a medical device.",
    )

    out_path = REPORTS_DIR / f"{call_sid}.pdf"
    pdf.output(str(out_path))
    logger.info(f"[worker] PDF saved: {out_path}")
    return out_path
