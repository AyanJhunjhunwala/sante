"""
Stress Detector Agent
Calls the RunPod-hosted stress detection model with base64-encoded audio.
Returns: prediction (STRESSED / NOT STRESSED), confidence, and raw scores.

Uses the async /run endpoint + polling to survive cold starts.
"""

import asyncio
import os
import base64

import httpx

RUNPOD_BASE = "https://api.runpod.ai/v2/bfl4ave2lkfph1"
POLL_INTERVAL = 2          # seconds between status checks
MAX_POLL_TIME = 120        # give up after 2 minutes


async def analyze_stress(audio_bytes: bytes) -> dict:
    """
    Send audio bytes to the RunPod stress detector.
    Uses /run (async) + /status polling so cold starts don't time out.
    """
    api_key = os.getenv("RUNPOD_API_KEY", "")

    if not api_key or api_key.startswith("your_"):
        return {"error": "RUNPOD_API_KEY not configured in .env"}

    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    print(f"[stress_detector] Sending {len(audio_bytes)} bytes to RunPod (async)...")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Submit the job asynchronously
        submit_resp = await client.post(
            f"{RUNPOD_BASE}/run",
            headers=headers,
            json={"input": {"audio_base64": audio_b64}},
        )

        if submit_resp.status_code != 200:
            print(f"[stress_detector] Submit failed {submit_resp.status_code}: {submit_resp.text[:500]}")
            return {"error": f"RunPod submit failed: {submit_resp.text}"}

        job = submit_resp.json()
        job_id = job.get("id")
        status = job.get("status")
        print(f"[stress_detector] Job submitted: id={job_id}, status={status}")

        # If it completed immediately (warm worker), use the result
        if status == "COMPLETED":
            return _extract_results(job)

        if status == "FAILED":
            return {"error": job.get("error", "RunPod job failed immediately")}

        # 2. Poll for completion
        elapsed = 0
        while elapsed < MAX_POLL_TIME:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            poll_resp = await client.get(
                f"{RUNPOD_BASE}/status/{job_id}",
                headers=headers,
            )

            if poll_resp.status_code != 200:
                print(f"[stress_detector] Poll error {poll_resp.status_code}: {poll_resp.text[:300]}")
                continue

            poll_data = poll_resp.json()
            status = poll_data.get("status")
            print(f"[stress_detector] Poll: status={status} ({elapsed}s elapsed)")

            if status == "COMPLETED":
                return _extract_results(poll_data)

            if status == "FAILED":
                return {"error": poll_data.get("error", "RunPod job failed")}

            # IN_QUEUE or IN_PROGRESS — keep polling

    return {"error": f"Stress analysis timed out after {MAX_POLL_TIME}s"}


def _extract_results(data: dict) -> dict:
    """Pull prediction/confidence from the RunPod response envelope."""
    output = data.get("output", {})
    results = output.get("results", output)
    print(f"[stress_detector] Results: {results}")

    return {
        "prediction": results.get("prediction", "UNKNOWN"),
        "confidence": results.get("confidence", 0),
        "not_stressed": results.get("not_stressed", 0),
        "stressed": results.get("stressed", 0),
        "raw": results,
    }
