"""
Analysis router — receives recorded audio and dispatches to RunPod models.
"""

import io
import os
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from openai import OpenAI

from agents.phoneme_detector import analyze_phonemes
from agents.stress_detector import analyze_stress
from services.acoustic_features import analyze_acoustics
from services.audio_convert import to_wav_bytes

router = APIRouter(prefix="/api/analyze", tags=["analysis"])

MIN_AUDIO_BYTES = 1000
MAX_AUDIO_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".webm", ".wav", ".mp3", ".m4a"}
ALLOWED_MIME_TYPES = {
    "audio/webm",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
}


def _validate_audio_upload(audio: UploadFile, audio_bytes: bytes) -> None:
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio too short")

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio too large")

    file_ext = Path(audio.filename or "").suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported audio extension")

    content_type = (audio.content_type or "").split(";")[0].strip().lower()
    if (
        content_type
        and content_type not in ALLOWED_MIME_TYPES
        and content_type != "application/octet-stream"
    ):
        raise HTTPException(status_code=400, detail="Unsupported audio mime type")


@router.post("/stress")
async def api_analyze_stress(audio: UploadFile = File(...)) -> JSONResponse:
    """
    Receive recorded audio from the stress session and run it through
    the RunPod stress-detector model.
    """
    audio_bytes = await audio.read()
    _validate_audio_upload(audio, audio_bytes)

    result = await analyze_stress(audio_bytes)

    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])

    return JSONResponse(result)


@router.post("/acoustics")
async def api_analyze_acoustics(audio: UploadFile = File(...)) -> JSONResponse:
    """
    Extract acoustic voice biomarkers (F0, jitter, shimmer, HNR, loudness,
    speech rate) from recorded audio using openSMILE eGeMAPSv02.
    """
    audio_bytes = await audio.read()
    _validate_audio_upload(audio, audio_bytes)

    result = analyze_acoustics(audio_bytes)

    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])

    return JSONResponse(result)


@router.post("/phonemes")
async def api_analyze_phonemes(
    audio: UploadFile = File(...),
    ref_text: str = Form(default=""),
) -> JSONResponse:
    """
    Receive the full session audio and run it through the RunPod phoneme model.
    Returns ref_phonemes, decode_phonemes, and dys_detect lists.
    ref_text is optional — if omitted the model uses CTC greedy decode.
    """
    audio_bytes = await audio.read()
    _validate_audio_upload(audio, audio_bytes)

    result = await analyze_phonemes(audio_bytes, ref_text)

    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])

    return JSONResponse(result)


@router.post("/transcript")
async def api_analyze_transcript(audio: UploadFile = File(...)) -> JSONResponse:
    """
    Transcribe uploaded audio with OpenAI and return plain transcript text.
    """
    audio_bytes = await audio.read()
    _validate_audio_upload(audio, audio_bytes)
    request_id = f"tx_{uuid.uuid4().hex[:10]}"
    started_at = time.perf_counter()

    api_key = os.getenv("OPENAI_API_KEY", "").strip().strip('"').strip("'")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Transcription unavailable: OPENAI_API_KEY is not configured.",
                "reason_code": "transcription_unavailable",
                "request_id": request_id,
            },
        )

    try:
        normalized_audio = to_wav_bytes(audio_bytes)
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Could not normalize uploaded audio for transcription.",
                "reason_code": "audio_normalization_failed",
                "request_id": request_id,
            },
        ) from exc

    in_memory_file = io.BytesIO(normalized_audio)
    in_memory_file.name = "recording.wav"
    in_memory_file.content_type = "audio/wav"

    client = OpenAI(api_key=api_key)
    try:
        result = client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe",
            file=in_memory_file,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": f"Transcription provider failed: {exc}",
                "reason_code": "provider_error",
                "request_id": request_id,
            },
        ) from exc

    transcript = (getattr(result, "text", "") or "").strip()
    if not transcript:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "No speech transcript detected from uploaded audio.",
                "reason_code": "transcription_empty",
                "request_id": request_id,
            },
        )

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    return JSONResponse(
        {
            "transcript": transcript,
            "status": "ok",
            "reason_code": None,
            "request_id": request_id,
            "model": "gpt-4o-mini-transcribe",
            "latency_ms": elapsed_ms,
        }
    )
