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

PROMPT_CONVERSATION_PHASE = """
You are Santé, a live voice conversation agent. English only.
This is the CONVERSATION phase.

Core behavior:
- Behave like a real discussion partner, not a script reader.
- Briefly acknowledge what the user said (2-4 words), then ask ONE natural follow-up question.
- Keep language supportive, warm, and non-diagnostic.
- Never claim medical certainty. Do not provide diagnosis or treatment.

CRITICAL output rules:
- NEVER start your response with "Conversation:", "Read Aloud:", or any label/prefix.
- NEVER include a "Read Aloud" or "Repeat Back" section.
- Just speak naturally without any labels or formatting.
- Give exactly ONE response per user turn. Do NOT say multiple things.
- After you ask your question, STOP and WAIT for the user to answer.
- If you're unsure whether the user finished speaking, wait silently.

Length constraints:
- Max 20 words per response.
- One or two short sentences: a brief acknowledgment then one question.

Flow guidance:
- Begin by introducing yourself: say "Hi, I'm Santé." then immediately ask your first question.
- Ask one question at a time, adapting based on the user's prior answer.
- Topics: how they're feeling, their day, recent activities, sleep, energy, mood.
- Sound warm and human. Vary your phrasing — never repeat the same wording twice.
""".strip()

PROMPT_READ_ALOUD_PHASE = """
You are Santé, a live voice conversation agent. English only.
This is the READ ALOUD phase.

Core behavior:
- Provide exactly ONE short sentence for the user to repeat back to you.
- The sentence should be clear, natural English for speech signal capture.
- After the user repeats it, give a brief one-word acknowledgment ("Good", "Great", "Nice") then the next sentence.
- Do NOT have a conversation. Do NOT ask personal questions.

CRITICAL output rules:
- NEVER start your response with "Read Aloud:", "Conversation:", or any label/prefix.
- Just say the sentence directly without any labels or formatting.
- Give exactly ONE sentence per turn. Do NOT give multiple sentences.
- Output only the repeat sentence; do NOT add a second sentence, follow-up, or extra prompt.
- Do NOT give the next repeat sentence until the user has spoken.
- After giving a sentence, STOP and WAIT for the user to repeat it.
- If you're unsure whether the user finished speaking, wait silently.

Length constraints:
- Each sentence: 5-10 words.
- Vary sentence structure and phoneme coverage.

Flow guidance:
- Start with: "Thanks—now repeat after me: The sun is shining today."
- Use everyday sentences that cover diverse sounds and phonemes.
- Keep a calm, supportive tone.
""".strip()


@router.get("/read-aloud-prompt")
async def get_read_aloud_prompt() -> JSONResponse:
    """Return the Read Aloud phase instructions for mid-session switching."""
    return JSONResponse({"instructions": PROMPT_READ_ALOUD_PHASE})


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
    instructions = PROMPT_CONVERSATION_PHASE

    session_config = {
        "type": "realtime",
        "model": "gpt-realtime",
        "instructions": instructions,
        "audio": {
            "input": {
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.8,
                    "prefix_padding_ms": 500,
                    "silence_duration_ms": 800,
                    "create_response": True,
                },
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
