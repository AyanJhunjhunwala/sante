"""
Summary router — generates a session report after any session ends.
"""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agents.session_summary import (
    export_session_report_pdf,
    generate_ai_report,
    generate_ai_report_sections,
    generate_chat_reply,
    generate_session_report,
)
from services.action_forwarding import execute_forwarding

router = APIRouter(prefix="/api/session-summary", tags=["summary"])


class SessionSummaryRequest(BaseModel):
    segment: str
    user_transcription: str = ""
    ai_transcription: str = ""
    duration_seconds: float = 0.0
    detected_phonemes: list[str] = []
    detected_dys_detect: list[dict] = []
    acoustic_features: dict | None = None
    forward_opt_in: bool = False
    forward_recipient: str = ""


class SessionSummaryChatRequest(BaseModel):
    report: dict
    message: str


class GenerateReportRequest(BaseModel):
    report: dict


class ExportReportRequest(BaseModel):
    report: dict


@router.post("")
async def api_session_summary(payload: SessionSummaryRequest) -> JSONResponse:
    report = generate_session_report(
        segment=payload.segment,
        user_transcription=payload.user_transcription,
        ai_transcription=payload.ai_transcription,
        duration_seconds=payload.duration_seconds,
        detected_phonemes=payload.detected_phonemes,
        detected_dys_detect=payload.detected_dys_detect,
        acoustic_features=payload.acoustic_features,
    )

    action_result = {
        "status": "not_forwarded",
        "reason": "not_requested",
    }
    if payload.forward_recipient.strip():
        try:
            static_url = export_session_report_pdf(report=report)
            backend_base_url = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
            report_url = f"{backend_base_url}{static_url}"
            action_result = execute_forwarding(
                report=report,
                report_url=report_url,
                forward_opt_in=payload.forward_opt_in,
                forward_recipient=payload.forward_recipient,
                source="web_summary",
            )
        except Exception as exc:
            action_result = {
                "status": "error",
                "reason": "forwarding_failed",
                "error": str(exc),
            }

    report["action_result"] = action_result
    safety_signal = report.get("safety_signal") if isinstance(report, dict) else None
    report["safety_action_result"] = (
        action_result if isinstance(safety_signal, dict) and safety_signal.get("urgency") == "urgent" else None
    )
    return JSONResponse(report)


@router.post("/chat")
async def api_session_summary_chat(payload: SessionSummaryChatRequest) -> JSONResponse:
    reply = generate_chat_reply(report=payload.report, message=payload.message)
    return JSONResponse({"reply": reply})


@router.post("/report")
async def api_generate_report(payload: GenerateReportRequest) -> JSONResponse:
    narrative = generate_ai_report(report=payload.report)
    return JSONResponse({"report": narrative})


@router.post("/report-structured")
async def api_generate_report_structured(payload: GenerateReportRequest) -> JSONResponse:
    sections = generate_ai_report_sections(report=payload.report)
    return JSONResponse({"sections": sections})


@router.post("/export-pdf")
async def api_export_pdf(payload: ExportReportRequest) -> JSONResponse:
    try:
        path = export_session_report_pdf(report=payload.report)
        return JSONResponse({"url": path})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF export failed: {exc}") from exc
