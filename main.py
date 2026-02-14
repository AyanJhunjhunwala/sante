import os
import json
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

SYSTEM_INSTRUCTIONS = """
You are Santé, an AI-powered voice health assistant. You provide thoughtful,
empathetic health guidance through natural conversation.

Your role:
- Listen carefully to the user's health concerns and symptoms.
- Ask clarifying follow-up questions to better understand their situation.
- Provide general health information and wellness guidance.
- Suggest when it might be appropriate to consult a healthcare professional.
- Be warm, calm, and reassuring in your tone.

Important guidelines:
- You are NOT a doctor and cannot diagnose conditions or prescribe medication.
- Always recommend consulting a healthcare professional for serious concerns.
- Be empathetic and patient.
- Keep responses concise and conversational — this is a voice interaction,
  so avoid long monologues.
- Start by warmly greeting the user and asking how you can help with their
  health today.
""".strip()

SESSION_CONFIG = json.dumps({
    "type": "realtime",
    "model": "gpt-realtime",
    "instructions": SYSTEM_INSTRUCTIONS,
    "audio": {
        "output": {
            "voice": "sage",
        },
    },
    "input_audio_transcription": {
        "model": "gpt-4o-mini-transcribe",
    },
})

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


@app.post("/session", response_class=PlainTextResponse)
async def create_session(request: Request):
    """
    Receive the browser's SDP offer, forward it alongside session config
    to the OpenAI Realtime API, and return the SDP answer.
    """
    if not OPENAI_API_KEY or OPENAI_API_KEY == "your_openai_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in .env",
        )

    # Read the raw SDP offer from the browser
    sdp_offer = (await request.body()).decode("utf-8")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/realtime/calls",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            files=[
                ("sdp", (None, sdp_offer, "application/sdp")),
                ("session", (None, SESSION_CONFIG, "application/json")),
            ],
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"OpenAI error: {resp.text}",
        )

    return PlainTextResponse(content=resp.text, media_type="application/sdp")


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
