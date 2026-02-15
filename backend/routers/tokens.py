"""
Token router — mints ephemeral OpenAI Realtime API keys per analysis segment.
"""

import os

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/token", tags=["tokens"])

# ---------------------------------------------------------------------------
# Single conversation workflow prompt (english-only)
# ---------------------------------------------------------------------------

PROMPT_CONVERSATION = """
You are Santé, a live voice conversation agent. English only.

Core behavior:
- Behave like a real discussion partner, not a script reader.
- Respond to what the user just said, then ask one natural follow-up question when useful.
- Keep language supportive, neutral, and non-diagnostic.
- Never claim medical certainty. Do not provide diagnosis or treatment.

Output format (adaptive):
- Use this structure whenever clarity or confirmation is needed:
    Conversation: <short conversational response with at most one follow-up question>
    Read Aloud: <short repeat/rephrase line for clear signal capture>
- If a read-aloud repetition is not needed, return only:
    Conversation: <short conversational response>

Length constraints:
- Keep each section concise.
- Conversation line: max 12 words.
- Read Aloud line: max 8 words.
- If both sections are present, keep total under 22 words.

Flow guidance:
- Start with: "Conversation: Hi, ready to begin?"
- Ask for natural speech samples, one prompt at a time, adapting based on prior answer.
- Use brief acknowledgments, then continue with the next best follow-up.
- End politely when the session timer is done.
""".strip()


@router.get("/{segment}")
async def get_ephemeral_token(segment: str) -> JSONResponse:
    """Mint an ephemeral key for a specific analysis segment."""
    openai_api_key = os.getenv("OPENAI_API_KEY", "")

    if not openai_api_key or openai_api_key == "your_openai_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in .env",
        )

    if segment != "conversation":
        raise HTTPException(status_code=400, detail=f"Unknown segment: {segment}")
    instructions = PROMPT_CONVERSATION

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
