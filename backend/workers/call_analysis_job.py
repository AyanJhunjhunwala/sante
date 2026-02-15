"""
rq worker job: process a completed phone call.

Steps:
  1. Run dummy analysis (stub — returns placeholder biomarker data).
     Real analysis (stress, phonemes, acoustics) replaces _run_dummy_analysis() later.
  2. Generate a placeholder PDF report (fpdf2).
  3. Save PDF to backend/static/reports/{call_sid}.pdf (served at /static/reports/).
  4. Send SMS via Twilio with the report link.
"""

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
) -> dict[str, Any]:
    """
    rq job entry point — called by the worker process.

    Returns a dict with job result metadata (logged by rq).
    """
    logger.info(
        f"[worker] Processing call {call_sid} from {caller_phone} (status={call_status})"
    )

    analysis_results = _run_dummy_analysis(
        call_sid=call_sid,
        duration_seconds=duration_seconds,
    )

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


def _run_dummy_analysis(*, call_sid: str, duration_seconds: int) -> dict[str, Any]:
    """
    Stub analysis — returns plausible fake biomarker data.
    Uses call_sid as the random seed so results are deterministic per call.
    Replace this function with real RunPod/model calls later.
    """
    rng = random.Random(call_sid)

    return {
        "stub": True,
        "stress": {
            "prediction": rng.choice(["STRESSED", "NOT STRESSED"]),
            "confidence": round(rng.uniform(0.60, 0.92), 3),
        },
        "acoustics": {
            "f0_mean_hz": round(rng.uniform(85.0, 255.0), 2),
            "jitter": round(rng.uniform(0.001, 0.012), 4),
            "shimmer_db": round(rng.uniform(0.1, 1.5), 3),
            "hnr_db": round(rng.uniform(10.0, 25.0), 2),
            "speech_rate_wpm": round(rng.uniform(120.0, 180.0), 1),
        },
        "phonemes": {
            "total_detected": rng.randint(40, 120),
            "disfluency_count": rng.randint(0, 8),
        },
    }


def _generate_pdf_report(
    *,
    call_sid: str,
    caller_phone: str,
    duration_seconds: int,
    analysis_results: dict[str, Any],
) -> Path:
    """
    Generate a placeholder PDF report using fpdf2.
    Saves to REPORTS_DIR/{call_sid}.pdf and returns the path.
    """
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

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
    pdf.ln(6)

    # Stress section
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Stress Analysis  (Placeholder)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    stress = analysis_results["stress"]
    pdf.cell(
        0, 7, f"  Prediction:   {stress['prediction']}", new_x="LMARGIN", new_y="NEXT"
    )
    pdf.cell(
        0,
        7,
        f"  Confidence:   {stress['confidence']:.1%}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    # Acoustics section
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Acoustic Features  (Placeholder)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    for key, val in analysis_results["acoustics"].items():
        pdf.cell(0, 7, f"  {key}:  {val}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Phonemes section
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 9, "Phoneme / Disfluency  (Placeholder)", new_x="LMARGIN", new_y="NEXT")
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
        "DISCLAIMER: This report is a placeholder generated for development purposes only. "
        "It does not represent real medical analysis and results are not clinically validated. "
        "Santé is a research tool, not a medical device.",
    )

    out_path = REPORTS_DIR / f"{call_sid}.pdf"
    pdf.output(str(out_path))
    logger.info(f"[worker] PDF saved: {out_path}")
    return out_path
