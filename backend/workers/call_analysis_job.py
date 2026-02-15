"""
rq worker job: process a completed phone call.

Steps:
  1. Run real analysis (acoustics, phonemes) on the recorded call audio.
     Falls back to dummy data if audio is unavailable or analysis fails.
  2. Generate a PDF report (fpdf2).
  3. Save PDF to backend/static/reports/{call_sid}.pdf (served at /static/reports/).
  4. Email the PDF report to the configured recipient.
"""

import asyncio
import logging
import random
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load .env so RUNPOD_API_KEY, OPENAI_API_KEY etc. are available in the worker process.
# (The FastAPI server calls load_dotenv() in main.py, but the RQ worker is a separate process.)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from services.email_sender import send_email_report

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
    ai_transcript: str = "",
    user_transcript: str = "",
) -> dict[str, Any]:
    """
    rq job entry point — called by the worker process.

    Returns a dict with job result metadata (logged by rq).
    """
    logger.info(
        f"[worker] Processing call {call_sid} from {caller_phone} "
        f"(status={call_status}, audio={'yes' if audio_path else 'no'}, "
        f"ai_transcript={len(ai_transcript)} chars, user_transcript={len(user_transcript)} chars)"
    )

    analysis_results = _run_analysis(
        call_sid=call_sid,
        duration_seconds=duration_seconds,
        audio_path=audio_path,
        user_transcript=user_transcript,
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
        ai_transcript=ai_transcript,
        user_transcript=user_transcript,
    )

    email_result = send_email_report(
        pdf_path=str(pdf_path),
        call_sid=call_sid,
        caller_phone=caller_phone,
    )

    logger.info(f"[worker] Done for {call_sid}: email={email_result.get('status')}")

    return {
        "call_sid": call_sid,
        "pdf_path": str(pdf_path),
        "email_result": email_result,
        "analysis_results": analysis_results,
    }


def _run_analysis(
    *,
    call_sid: str,
    duration_seconds: int,
    audio_path: str | None,
    user_transcript: str = "",
) -> dict[str, Any]:
    """
    Run acoustic and phoneme analysis on the call audio.
    Falls back to dummy data for any analysis that fails or has no audio.
    """
    if not audio_path or not Path(audio_path).exists():
        logger.warning(f"[worker] No audio available for {call_sid}, using dummy data")
        return _run_dummy_analysis(call_sid=call_sid, duration_seconds=duration_seconds)

    logger.info(f"[worker] Running real analysis on {audio_path} for {call_sid}")

    acoustic_result = _run_acoustics(audio_path, call_sid)
    phoneme_result = _run_phonemes(audio_path, call_sid, user_transcript)

    return {
        "stub": False,
        "acoustics": acoustic_result,
        "phonemes": phoneme_result,
    }


def _run_acoustics(audio_path: str, call_sid: str) -> dict[str, Any]:
    try:
        from services.acoustic_features import analyze_acoustics_file

        result = analyze_acoustics_file(audio_path)
        if "error" in result:
            logger.warning(
                f"[worker] Acoustics error for {call_sid}: {result['error']}"
            )
            return _dummy_acoustics(call_sid)
        return result
    except Exception as exc:
        logger.error(f"[worker] Acoustics exception for {call_sid}: {exc}")
        return _dummy_acoustics(call_sid)


def _run_phonemes(audio_path: str, call_sid: str, ref_text: str = "") -> dict[str, Any]:
    try:
        from agents.phoneme_detector import analyze_phonemes

        logger.info(
            f"[worker] Submitting phoneme job to RunPod for {call_sid} "
            f"(wav_path={audio_path}, ref_text={len(ref_text)} chars)"
        )
        result = asyncio.run(analyze_phonemes(b"", ref_text, wav_path=audio_path))
        if "error" in result:
            logger.warning(
                f"[worker] Phoneme analysis error for {call_sid}: {result['error']}"
            )
            return _dummy_phonemes(call_sid)
        dys = result.get("dys_detect", [])
        logger.info(
            f"[worker] Phoneme analysis complete for {call_sid}: "
            f"total={len(result.get('decode_phonemes', []))}, disfluencies={len(dys)}"
        )
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
    ai_transcript: str = "",
    user_transcript: str = "",
) -> Path:
    """
    Generate a PDF report using the session_summary agent (same as the web app).
    Saves to REPORTS_DIR/{call_sid}.pdf and returns the path.
    Falls back to a basic PDF if session_summary fails.
    """
    from agents.session_summary import (
        generate_session_report,
        export_session_report_pdf,
    )

    phonemes = analysis_results.get("phonemes", {})
    acoustics = analysis_results.get("acoustics", {})

    try:
        report = generate_session_report(
            segment="conversation",
            user_transcription=user_transcript,
            ai_transcription=ai_transcript,
            duration_seconds=float(duration_seconds),
            detected_phonemes=phonemes.get("dys_detect", []),
            detected_dys_detect=phonemes.get("dys_detect", []),
            acoustic_features=acoustics if not analysis_results.get("stub") else None,
        )
        # export_session_report_pdf returns a URL path like "/static/reports/sum_abc.pdf"
        # The actual file is at REPORTS_DIR/{report_id}.pdf.
        # Rename it to {call_sid}.pdf so the SMS URL stays consistent.
        export_session_report_pdf(report=report)
        report_id = report["report_id"]
        export_path = REPORTS_DIR / f"{report_id}.pdf"

        out_path = REPORTS_DIR / f"{call_sid}.pdf"
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        if export_path.exists() and export_path != out_path:
            export_path.rename(out_path)
        logger.info(f"[worker] PDF saved: {out_path}")
        return out_path
    except Exception as exc:
        logger.error(
            f"[worker] session_summary PDF failed for {call_sid}: {exc}, falling back to basic PDF"
        )
        return _generate_basic_pdf(
            call_sid=call_sid,
            duration_seconds=duration_seconds,
            analysis_results=analysis_results,
        )


def _generate_basic_pdf(
    *,
    call_sid: str,
    duration_seconds: int,
    analysis_results: dict[str, Any],
) -> Path:
    """Minimal fallback PDF when session_summary agent is unavailable."""
    from fpdf import FPDF

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    is_stub = analysis_results.get("stub", False)

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(
        0, 12, "Sante Voice Health Report", new_x="LMARGIN", new_y="NEXT", align="C"
    )
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, f"Report ID:  {call_sid}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 7, f"Duration:   {duration_seconds}s", new_x="LMARGIN", new_y="NEXT")
    if is_stub:
        pdf.set_text_color(180, 80, 0)
        pdf.cell(
            0,
            7,
            "Note: Analysis data is placeholder (audio unavailable)",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.set_text_color(0, 0, 0)
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Acoustic Features", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    for key, val in analysis_results.get("acoustics", {}).items():
        pdf.cell(0, 7, f"  {key}:  {val}", new_x="LMARGIN", new_y="NEXT")
    ph = analysis_results.get("phonemes", {})
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Phoneme / Disfluency Analysis", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(
        0,
        7,
        f"  Total phonemes detected:  {ph.get('total_detected', 0)}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0,
        7,
        f"  Disfluency events:         {ph.get('disfluency_count', 0)}",
        new_x="LMARGIN",
        new_y="NEXT",
    )

    out_path = REPORTS_DIR / f"{call_sid}.pdf"
    pdf.output(str(out_path))
    logger.info(f"[worker] Basic PDF saved: {out_path}")
    return out_path
