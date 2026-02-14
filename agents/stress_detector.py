"""
Stress Detector Agent
Calls the RunPod-hosted stress detection model with base64-encoded audio.
Returns: prediction (STRESSED / NOT STRESSED), confidence, and raw scores.
"""

import os
import base64

import httpx

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "")
RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/bfl4ave2lkfph1/runsync"


async def analyze_stress(audio_bytes: bytes) -> dict:
    """
    Send audio bytes to the RunPod stress detector.

    Args:
        audio_bytes: Raw audio file content (WAV, MP3, FLAC, etc.)

    Returns:
        dict with keys: prediction, confidence, not_stressed, stressed, raw
    """
    if not RUNPOD_API_KEY or RUNPOD_API_KEY.startswith("your_"):
        return {"error": "RUNPOD_API_KEY not configured in .env"}

    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            RUNPOD_ENDPOINT,
            headers={
                "Authorization": f"Bearer {RUNPOD_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"input": {"audio_base64": audio_b64}},
        )

    if resp.status_code != 200:
        return {"error": f"RunPod returned {resp.status_code}: {resp.text}"}

    data = resp.json()

    # Handle async job status (shouldn't happen with /runsync but just in case)
    if data.get("status") == "FAILED":
        return {"error": data.get("error", "RunPod job failed")}

    # Extract results from the RunPod response
    output = data.get("output", {})
    results = output.get("results", output)

    return {
        "prediction": results.get("prediction", "UNKNOWN"),
        "confidence": results.get("confidence", 0),
        "not_stressed": results.get("not_stressed", 0),
        "stressed": results.get("stressed", 0),
        "raw": results,
    }
