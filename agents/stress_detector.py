"""
Stress Detector Agent
Calls the RunPod-hosted stress detection model with base64-encoded audio.
Returns: prediction (STRESSED / NOT STRESSED), confidence, and raw scores.

Uses async /run + polling, with automatic retries for cold-start errors.
"""

import asyncio
import os
import base64

import httpx

RUNPOD_BASE = "https://api.runpod.ai/v2/bfl4ave2lkfph1"
POLL_INTERVAL = 2          # seconds between status checks
MAX_POLL_TIME = 120        # per-attempt timeout
MAX_RETRIES = 3            # retry on cold-start errors
RETRY_DELAY = 8            # seconds to wait before retry (let model load)

# Errors that indicate the worker is still initializing
COLD_START_ERRORS = [
    "not initialized",
    "loading",
    "warming",
    "starting",
    "model not loaded",
]


def _is_cold_start_error(error_msg: str) -> bool:
    """Check if an error is a transient cold-start issue."""
    lower = (error_msg or "").lower()
    return any(phrase in lower for phrase in COLD_START_ERRORS)


async def analyze_stress(audio_bytes: bytes) -> dict:
    """
    Send audio bytes to the RunPod stress detector.
    Retries automatically if the worker is still cold-starting.
    """
    api_key = os.getenv("RUNPOD_API_KEY", "")

    if not api_key or api_key.startswith("your_"):
        return {"error": "RUNPOD_API_KEY not configured in .env"}

    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"input": {"audio_base64": audio_b64}}

    for attempt in range(1, MAX_RETRIES + 1):
        print(f"[stress_detector] Attempt {attempt}/{MAX_RETRIES} — "
              f"sending {len(audio_bytes)} bytes...")

        result = await _submit_and_poll(headers, payload)

        # If it succeeded or is a non-retryable error, return immediately
        if "error" not in result:
            return result

        if not _is_cold_start_error(result["error"]):
            print(f"[stress_detector] Non-retryable error: {result['error']}")
            return result

        # Cold-start error — wait and retry
        if attempt < MAX_RETRIES:
            print(f"[stress_detector] Cold-start error: {result['error']}. "
                  f"Waiting {RETRY_DELAY}s before retry...")
            await asyncio.sleep(RETRY_DELAY)

    # All retries exhausted
    return result


async def _submit_and_poll(headers: dict, payload: dict) -> dict:
    """Submit a job via /run and poll /status until done."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Submit
        resp = await client.post(
            f"{RUNPOD_BASE}/run",
            headers=headers,
            json=payload,
        )

        if resp.status_code != 200:
            body = resp.text[:500]
            print(f"[stress_detector] Submit failed {resp.status_code}: {body}")
            return {"error": f"RunPod submit error ({resp.status_code}): {body}"}

        job = resp.json()
        job_id = job.get("id")
        status = job.get("status")
        print(f"[stress_detector] Job {job_id}: status={status}")

        # Immediate completion (warm worker)
        if status == "COMPLETED":
            return _extract_results(job)

        if status == "FAILED":
            err = job.get("error") or job.get("output", {}).get("error", "Job failed")
            return {"error": str(err)}

        # 2. Poll
        elapsed = 0
        while elapsed < MAX_POLL_TIME:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            poll = await client.get(
                f"{RUNPOD_BASE}/status/{job_id}",
                headers=headers,
            )

            if poll.status_code != 200:
                print(f"[stress_detector] Poll error {poll.status_code}")
                continue

            data = poll.json()
            status = data.get("status")
            print(f"[stress_detector] Poll {job_id}: status={status} ({elapsed}s)")

            if status == "COMPLETED":
                return _extract_results(data)

            if status == "FAILED":
                err = (data.get("error")
                       or _get_output_error(data)
                       or "Job failed")
                return {"error": str(err)}

    return {"error": f"Timed out after {MAX_POLL_TIME}s"}


def _get_output_error(data: dict) -> str | None:
    """Check if the output itself contains an error message."""
    output = data.get("output")
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        return output.get("error")
    return None


def _extract_results(data: dict) -> dict:
    """Pull prediction/confidence from the RunPod response envelope."""
    output = data.get("output", {})

    # Handle string output (error as plain text)
    if isinstance(output, str):
        return {"error": output}

    # Check for error inside output
    if "error" in output and "results" not in output:
        return {"error": output["error"]}

    results = output.get("results", output)

    # Handle case where results is also a string
    if isinstance(results, str):
        return {"error": results}

    print(f"[stress_detector] Results: {results}")

    return {
        "prediction": results.get("prediction", "UNKNOWN"),
        "confidence": results.get("confidence", 0),
        "not_stressed": results.get("not_stressed", 0),
        "stressed": results.get("stressed", 0),
        "raw": results,
    }
