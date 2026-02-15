"""
Summary router — generates a session report after any session ends.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agents.session_summary import (
    export_session_report_pdf,
    generate_ai_report,
    generate_chat_reply,
    generate_session_report,
)

router = APIRouter(prefix="/api/session-summary", tags=["summary"])


class SessionSummaryRequest(BaseModel):
    segment: str
    user_transcription: str = ""
    ai_transcription: str = ""
    duration_seconds: float = 0.0
    detected_phonemes: list[str] = []
    detected_dys_detect: list[dict] = []
    acoustic_features: dict | None = None


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
    return JSONResponse(report)


@router.post("/chat")
async def api_session_summary_chat(payload: SessionSummaryChatRequest) -> JSONResponse:
    reply = generate_chat_reply(report=payload.report, message=payload.message)
    return JSONResponse({"reply": reply})


@router.post("/report")
async def api_generate_report(payload: GenerateReportRequest) -> JSONResponse:
    narrative = generate_ai_report(report=payload.report)
    return JSONResponse({"report": narrative})


@router.post("/export-pdf")
async def api_export_pdf(payload: ExportReportRequest) -> JSONResponse:
    try:
        path = export_session_report_pdf(report=payload.report)
        return JSONResponse({"url": path})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF export failed: {exc}") from exc
