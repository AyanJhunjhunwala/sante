"""
Phoneme Detector Agent
Calls the RunPod-hosted phoneme/disfluency model with base64-encoded audio
and reference text.

Returns: ref_phonemes, decode_phonemes, dys_detect lists from the WFST decoder.

Uses async /run + polling, with automatic retries for cold-start errors.
"""

import asyncio
import os
import base64

import httpx

from services.audio_convert import to_wav_bytes

RUNPOD_PHONEME_ENDPOINT_ID = os.getenv("RUNPOD_PHONEME_ENDPOINT_ID", "eib51lbk8ca3wl")
RUNPOD_BASE = f"https://api.runpod.ai/v2/{RUNPOD_PHONEME_ENDPOINT_ID}"
POLL_INTERVAL = 2  # seconds between status checks
MAX_POLL_TIME = 300  # 5 min — cold starts on 23GB image can take 2-3 min
MAX_RETRIES = 2  # fewer retries — real-time context
RETRY_DELAY = 6  # seconds to wait before retry

COLD_START_ERRORS = [
    "not initialized",
    "loading",
    "warming",
    "starting",
    "model not loaded",
]


def _is_cold_start_error(error_msg: str) -> bool:
    lower = (error_msg or "").lower()
    return any(phrase in lower for phrase in COLD_START_ERRORS)


async def analyze_phonemes(
    audio_bytes: bytes, ref_text: str = "", *, wav_path: str | None = None
) -> dict:
    """
    Send audio bytes + reference text to the RunPod phoneme model.
    Returns dict with ref_phonemes, decode_phonemes, dys_detect on success,
    or {"error": "..."} on failure.

    If wav_path is given the file is read directly (skips ffmpeg re-encode).
    Otherwise audio_bytes are converted via to_wav_bytes (webm/opus → WAV).
    """
    api_key = os.getenv("RUNPOD_API_KEY", "").strip().strip('"').strip("'")

    if not api_key or api_key.startswith("your_"):
        return {"error": "RUNPOD_API_KEY not configured in .env"}

    if wav_path is not None:
        import pathlib

        wav_bytes = pathlib.Path(wav_path).read_bytes()
    else:
        # Convert webm/opus → WAV so the RunPod handler (soundfile) can parse it
        wav_bytes = to_wav_bytes(audio_bytes)
    audio_b64 = base64.b64encode(wav_bytes).decode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"input": {"audio_base64": audio_b64, "ref_text": ref_text}}

    for attempt in range(1, MAX_RETRIES + 1):
        print(
            f"[phoneme_detector] Attempt {attempt}/{MAX_RETRIES} — "
            f"sending {len(wav_bytes)} wav bytes (from {len(audio_bytes)} input), ref_text={repr(ref_text[:60])}"
        )

        result = await _submit_and_poll(headers, payload)

        if "error" not in result:
            return result

        if not _is_cold_start_error(result["error"]):
            print(f"[phoneme_detector] Non-retryable error: {result['error']}")
            return result

        if attempt < MAX_RETRIES:
            print(
                f"[phoneme_detector] Cold-start error: {result['error']}. "
                f"Waiting {RETRY_DELAY}s before retry..."
            )
            await asyncio.sleep(RETRY_DELAY)

    return result


async def _submit_and_poll(headers: dict, payload: dict) -> dict:
    """Submit a job via /run and poll /status until done."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{RUNPOD_BASE}/run",
            headers=headers,
            json=payload,
        )

        if resp.status_code != 200:
            body = (resp.text or "").strip()[:500]
            print(f"[phoneme_detector] Submit failed {resp.status_code}: {body}")
            if resp.status_code == 401:
                return {
                    "error": (
                        "RunPod submit error (401): unauthorized for endpoint "
                        f"{RUNPOD_PHONEME_ENDPOINT_ID}. Check RUNPOD_API_KEY and "
                        "RUNPOD_PHONEME_ENDPOINT_ID."
                    )
                }
            return {
                "error": (
                    f"RunPod submit error ({resp.status_code}) on endpoint "
                    f"{RUNPOD_PHONEME_ENDPOINT_ID}: {body}"
                )
            }

        job = resp.json()
        job_id = job.get("id")
        status = job.get("status")
        print(f"[phoneme_detector] Job {job_id}: status={status}")

        if status == "COMPLETED":
            return _extract_results(job)

        if status == "FAILED":
            err = job.get("error") or job.get("output", {}).get("error", "Job failed")
            return {"error": str(err)}

        elapsed = 0
        while elapsed < MAX_POLL_TIME:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            poll = await client.get(
                f"{RUNPOD_BASE}/status/{job_id}",
                headers=headers,
            )

            if poll.status_code != 200:
                print(f"[phoneme_detector] Poll error {poll.status_code}")
                continue

            data = poll.json()
            status = data.get("status")
            print(f"[phoneme_detector] Poll {job_id}: status={status} ({elapsed}s)")

            if status == "COMPLETED":
                return _extract_results(data)

            if status == "FAILED":
                err = data.get("error") or _get_output_error(data) or "Job failed"
                return {"error": str(err)}

    return {"error": f"Timed out after {MAX_POLL_TIME}s"}


def _get_output_error(data: dict) -> str | None:
    output = data.get("output")
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        return output.get("error")
    return None


def _extract_results(data: dict) -> dict:
    """Pull phoneme results from the RunPod response envelope."""
    output = data.get("output", {})

    if isinstance(output, str):
        return {"error": output}

    if "error" in output:
        return {"error": output["error"]}

    decode = output.get("decode_phonemes", [])
    dys = output.get("dys_detect", [])
    print(
        f"[phoneme_detector] Results received: "
        f"decode_phonemes={len(decode)}, dys_detect={len(dys)}, "
        f"keys={list(output.keys())}"
    )

    return {
        "ref_phonemes": output.get("ref_phonemes", []),
        "decode_phonemes": output.get("decode_phonemes", []),
        "dys_detect": output.get("dys_detect", []),
    }
