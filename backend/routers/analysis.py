"""
Analysis router — receives recorded audio and dispatches to RunPod models.
"""

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from agents.phoneme_detector import analyze_phonemes
from agents.stress_detector import analyze_stress

router = APIRouter(prefix="/api/analyze", tags=["analysis"])


@router.post("/stress")
async def api_analyze_stress(audio: UploadFile = File(...)) -> JSONResponse:
    """
    Receive recorded audio from the stress session and run it through
    the RunPod stress-detector model.
    """
    audio_bytes = await audio.read()

    if len(audio_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Audio too short")

    result = await analyze_stress(audio_bytes)

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

    if len(audio_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Audio too short")

    result = await analyze_phonemes(audio_bytes, ref_text)

    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])

    return JSONResponse(result)
