"""
Analysis router — receives recorded audio and dispatches to RunPod stress detector.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

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
