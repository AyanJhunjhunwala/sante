import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from agents.stress_detector import analyze_stress
from agents.session_summary import generate_dummy_chat_reply, generate_dummy_session_report

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

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

SEGMENTS = {
        "conversation": PROMPT_CONVERSATION,
}

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Santé", description="Voice AI Health Platform")

BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/token/{segment}")
async def get_ephemeral_token(segment: str):
    """
    Mint an ephemeral key for a specific analysis segment.
    Segments: conversation
    """
    if not OPENAI_API_KEY or OPENAI_API_KEY == "your_openai_api_key_here":
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
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
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

    # If the nested transcription param was rejected, retry without it
    if resp.status_code != 200 and "transcription" in resp.text:
        print(f"Transcription config rejected, retrying without it: {resp.text}")
        session_config["audio"].pop("input", None)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/realtime/client_secrets",
                    headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
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


# ---------------------------------------------------------------------------
# Voice analysis endpoints
# ---------------------------------------------------------------------------


class SessionSummaryRequest(BaseModel):
    segment: str
    user_transcription: str = ""
    ai_transcription: str = ""
    duration_seconds: float = 0.0


class SessionSummaryChatRequest(BaseModel):
    report: dict
    message: str


@app.post("/api/session-summary")
async def api_session_summary(payload: SessionSummaryRequest):
    report = generate_dummy_session_report(
        segment=payload.segment,
        user_transcription=payload.user_transcription,
        ai_transcription=payload.ai_transcription,
        duration_seconds=payload.duration_seconds,
    )
    return JSONResponse(report)


@app.post("/api/session-summary/chat")
async def api_session_summary_chat(payload: SessionSummaryChatRequest):
    reply = generate_dummy_chat_reply(report=payload.report, message=payload.message)
    return JSONResponse({"reply": reply})

@app.post("/api/analyze/stress")
async def api_analyze_stress(audio: UploadFile = File(...)):
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


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
