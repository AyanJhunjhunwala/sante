"""
Summary router — generates a biomarker summary report after any session ends.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agents.session_summary import (
    generate_dummy_chat_reply,
    generate_dummy_session_report,
)

router = APIRouter(prefix="/api/session-summary", tags=["summary"])


class SessionSummaryRequest(BaseModel):
    segment: str
    user_transcription: str = ""
    ai_transcription: str = ""
    duration_seconds: float = 0.0
    detected_phonemes: list[str] = []
    detected_dys_detect: list[str] = []


class SessionSummaryChatRequest(BaseModel):
    report: dict
    message: str


@router.post("")
async def api_session_summary(payload: SessionSummaryRequest) -> JSONResponse:
    report = generate_dummy_session_report(
        segment=payload.segment,
        user_transcription=payload.user_transcription,
        ai_transcription=payload.ai_transcription,
        duration_seconds=payload.duration_seconds,
        detected_phonemes=payload.detected_phonemes,
        detected_dys_detect=payload.detected_dys_detect,
    )
    return JSONResponse(report)


@router.post("/chat")
async def api_session_summary_chat(payload: SessionSummaryChatRequest) -> JSONResponse:
    reply = generate_dummy_chat_reply(report=payload.report, message=payload.message)
    return JSONResponse({"reply": reply})
