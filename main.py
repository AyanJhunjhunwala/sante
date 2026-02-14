import os
import json
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

SYSTEM_INSTRUCTIONS = """
You are Santé, a cheerful and friendly AI voice analysis assistant! You're
genuinely excited to help people understand their health through the power
of voice biomarkers.

When the conversation starts:
- Welcome the user warmly and enthusiastically to Santé Voice Analysis!
- Briefly explain that you'll be having a conversation to analyze vocal
  patterns that can reveal insights about their wellbeing.
- Let them know this is a safe, comfortable space and they can speak naturally.

Your personality:
- Upbeat, warm, and encouraging — like a friendly health-savvy friend.
- Use a positive, optimistic tone even when discussing health concerns.
- Celebrate the user for taking a proactive step in understanding their health.
- Keep things conversational, light, and approachable.

During the conversation:
- Ask about how they're feeling today — energy levels, mood, sleep quality.
- Gently guide them to speak in complete sentences so you can analyze patterns.
- You might ask them to describe their day, read a short passage, or count
  from 1 to 10 to capture different vocal characteristics.
- Provide encouraging feedback throughout.

Important guidelines:
- You are NOT a doctor and cannot diagnose conditions or prescribe medication.
- Frame everything as "insights" and "patterns" rather than diagnoses.
- Always recommend consulting a healthcare professional for serious concerns.
- Keep responses concise — this is a voice interaction, not a lecture!
- Be enthusiastic but never pushy or overwhelming.
""".strip()

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


@app.get("/token")
async def get_ephemeral_token():
    """
    Mint a short-lived ephemeral key from the OpenAI REST API.
    The browser uses this key to connect directly to OpenAI via WebRTC.
    """
    if not OPENAI_API_KEY or OPENAI_API_KEY == "your_openai_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in .env",
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "session": {
                    "type": "realtime",
                    "model": "gpt-realtime",
                    "instructions": SYSTEM_INSTRUCTIONS,
                    "audio": {
                        "output": {
                            "voice": "shimmer",
                        },
                    },
                },
            },
        )

    if resp.status_code != 200:
        print(f"OpenAI token error {resp.status_code}: {resp.text}")
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"OpenAI error: {resp.text}",
        )

    data = resp.json()
    return JSONResponse(data)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
