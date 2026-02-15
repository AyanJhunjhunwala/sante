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

PROMPT_CONVERSATION_PHASE = """
You are Santé, a live voice conversation agent. English only.
This is the CONVERSATION phase.

Core behavior:
- Behave like a real discussion partner, not a script reader.
- Respond to what the user just said, then ask ONE natural follow-up question.
- Keep language supportive, neutral, and non-diagnostic.
- Never claim medical certainty. Do not provide diagnosis or treatment.

CRITICAL output rules:
- NEVER start your response with "Conversation:", "Read Aloud:", or any label/prefix.
- NEVER include a "Read Aloud" or "Repeat Back" section.
- Just speak naturally without any labels or formatting.
- Give exactly ONE response per user turn. Do NOT say multiple things.
- After you ask your question, STOP and WAIT for the user to answer.
- If you're unsure whether the user finished speaking, wait silently.

Length constraints:
- Max 12 words per response.
- One sentence only.

Flow guidance:
- Start with: "Hi, ready to begin?"
- Ask one question at a time, adapting based on the user's prior answer.
- Topics: how they're feeling, their day, recent activities, sleep, energy, mood.
- Use brief acknowledgments, then continue with the next best follow-up.
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

SEGMENTS = {
        "conversation": PROMPT_CONVERSATION_PHASE,
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

    if segment == "read-aloud-prompt":
        return JSONResponse({"instructions": PROMPT_READ_ALOUD_PHASE})

    instructions = SEGMENTS.get(segment)
    if not instructions:
        raise HTTPException(status_code=400, detail=f"Unknown segment: {segment}")

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


@app.get("/token/read-aloud-prompt")
async def get_read_aloud_prompt():
    return JSONResponse({"instructions": PROMPT_READ_ALOUD_PHASE})


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


class GenerateReportRequest(BaseModel):
    report: dict


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


@app.post("/api/session-summary/report")
async def api_generate_report(payload: GenerateReportRequest):
    report = payload.report or {}
    exec_summary = report.get("executive_summary", {}) if isinstance(report, dict) else {}
    top_flags = exec_summary.get("top_flags", []) if isinstance(exec_summary, dict) else []
    labels = []
    for flag in top_flags[:3]:
        if isinstance(flag, dict) and flag.get("label"):
            labels.append(str(flag["label"]))

    ai_summary = report.get("ai_summary") if isinstance(report, dict) else None
    if isinstance(ai_summary, str) and ai_summary.strip():
        narrative = ai_summary.strip()
    elif labels:
        narrative = (
            "Session overview: notable signals include "
            + ", ".join(labels)
            + ". This is a preliminary, non-diagnostic summary."
        )
    else:
        narrative = "Session overview generated. This is a preliminary, non-diagnostic summary."

    return JSONResponse({"report": narrative})

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
