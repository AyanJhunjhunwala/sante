"""
Token router — mints ephemeral OpenAI Realtime API keys per analysis segment.
"""

import os

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/token", tags=["tokens"])

# ---------------------------------------------------------------------------
# System prompts for each analysis segment (english-only)
# ---------------------------------------------------------------------------

PROMPT_SPEECH = """
You are a voice assistant. English only. Keep every reply under 10 words.
No explanations, no diagnoses. Just give the next instruction.

Guide the user through these tasks one at a time:
1. "Say 'aaaah' for 5 seconds."
2. "Repeat: The quick brown fox jumps over the lazy dog."
3. "Count from 1 to 20."
4. "Describe your morning routine."
5. "Repeat: Peter Piper picked a peck of pickled peppers."

After each, say "Great" or "Got it" and move on. End with "All done, thanks!"
""".strip()

PROMPT_HEALTH = """
You are a voice assistant. English only. Keep every reply under 10 words.
No explanations, no diagnoses. Just give the next instruction.

Guide the user through these tasks one at a time:
1. "Take a deep breath and exhale with an 'oooh' sound."
2. "Hum any tune for 10 seconds."
3. "Describe how your body feels right now."
4. "Repeat: Today I went to the store and bought some groceries for the week."
5. "Tell me about something that made you happy recently."
6. "Tell me about something that frustrated you recently."

After each, say "Great" or "Got it" and move on. End with "All done, thanks!"
""".strip()

PROMPT_STRESS = """
You are a voice assistant. English only. Max 8 words per reply.

Opener: "Hi! Just talk naturally for 30 seconds."
While they talk: only say "Mhm", "Go on", "I see", or one short question.
No explanations. No diagnoses. End with "Thanks, all done!"
""".strip()

SEGMENTS: dict[str, str] = {
    "speech": PROMPT_SPEECH,
    "health": PROMPT_HEALTH,
    "stress": PROMPT_STRESS,
}


@router.get("/{segment}")
async def get_ephemeral_token(segment: str) -> JSONResponse:
    """Mint an ephemeral key for a specific analysis segment."""
    openai_api_key = os.getenv("OPENAI_API_KEY", "")

    if not openai_api_key or openai_api_key == "your_openai_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in .env",
        )

    instructions = SEGMENTS.get(segment)
    if not instructions:
        raise HTTPException(status_code=400, detail=f"Unknown segment: {segment}")

    session_config = {
        "type": "realtime",
        "model": "gpt-realtime",
        "instructions": instructions,
        "audio": {
            "input": {
                "transcription": {
                    "model": "gpt-4o-mini-transcribe",
                },
            },
            "output": {
                "voice": "shimmer",
            },
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={"session": session_config},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="Timed out while requesting OpenAI realtime token",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reach OpenAI token service: {exc}",
        ) from exc

    # If transcription param rejected, retry without it
    if resp.status_code != 200 and "transcription" in resp.text:
        print(f"Transcription config rejected, retrying without it: {resp.text}")
        session_config["audio"].pop("input", None)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/realtime/client_secrets",
                    headers={
                        "Authorization": f"Bearer {openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"session": session_config},
                )
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail="Timed out while retrying OpenAI realtime token request",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach OpenAI token service on retry: {exc}",
            ) from exc

    if resp.status_code != 200:
        print(f"OpenAI token error {resp.status_code}: {resp.text}")
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"OpenAI error: {resp.text}",
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI token service returned non-JSON response",
        ) from exc

    return JSONResponse(payload)
