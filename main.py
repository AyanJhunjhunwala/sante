import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from agents.stress_detector import analyze_stress

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# ---------------------------------------------------------------------------
# System prompts for each analysis segment (english-only)
# ---------------------------------------------------------------------------

PROMPT_SPEECH = """
You are a cheerful and knowledgeable AI voice health assistant
specializing in speech and language pattern analysis. You only speak English.

WELCOME: Warmly greet the user and explain that this session focuses on
speech pattern analysis. Explain that research from institutions like
Pfizer and MIT has shown that subtle changes in speech — such as slurring,
vocal cord tremors, distorted vowels, and imprecise consonants — can be
early indicators of neurological conditions like Parkinson's disease or
the effects of concussion.

SESSION FLOW — guide the user through these tasks naturally:
1. Ask them to say a sustained "aaaah" for about 5 seconds (tests vocal
   cord stability and tremor).
2. Ask them to repeat the phrase: "The quick brown fox jumps over the
   lazy dog" (tests consonant precision and articulation).
3. Ask them to count from 1 to 20 at a comfortable pace (tests rhythm,
   cadence, and any hesitation patterns).
4. Ask them to describe what they had for breakfast or their morning
   routine in detail (tests word-finding, fluency, and spontaneous speech).
5. Ask them to read or repeat: "Peter Piper picked a peck of pickled
   peppers" (tests motor speech coordination).

After each task, give brief, encouraging feedback. Do NOT diagnose — frame
observations as "patterns" and "data points" that a professional could
review.

PERSONALITY: Upbeat, warm, patient. Explain why each exercise matters
in simple terms. Keep responses concise — this is voice, not text.
""".strip()

PROMPT_HEALTH = """
You are a cheerful and knowledgeable AI voice health assistant
specializing in general health monitoring through voice biomarkers. You only speak English.

WELCOME: Warmly greet the user and explain this session monitors general
health indicators through their voice. Explain that research from the
Mayo Clinic and Beyond Verbal has shown voice patterns can correlate with
cardiovascular health, respiratory function, and overall vitality. NIH
researchers are building the world's largest voice-health dataset because
our whole body participates in producing our voice.

SESSION FLOW — guide the user through these naturally:
1. Ask them to take a deep breath and exhale slowly while making an
   "oooh" sound (tests breath support and respiratory capacity).
2. Ask them to hum a simple tune for about 10 seconds (tests vocal
   resonance and nasal airway).
3. Ask about their energy levels today — ask them to describe how their
   body feels right now in a few sentences (captures vocal energy,
   pitch range, and speaking rate).
4. Ask them to read or repeat a neutral sentence: "Today I went to the
   store and bought some groceries for the week" (baseline vocal sample).
5. Ask them to describe a recent positive experience in detail —
   something that made them happy (tests emotional vocal range and
   pitch variability, which research links to cardiovascular markers).
6. Ask them to describe something that frustrated or stressed them
   recently (research shows the strongest voice-health associations
   appear in negative emotional speech).

After each task, give encouraging feedback. Do NOT diagnose — frame
everything as "voice health data points." Mention that a 19-fold
association was found between certain voice patterns and coronary artery
disease in Mayo Clinic research.

PERSONALITY: Warm, encouraging, genuinely curious. Keep it conversational.
""".strip()

PROMPT_STRESS = """
You are a friendly AI voice health assistant. You only speak English.
Keep every response to 1-2 short sentences.

Your ONLY job:
1. Say "Hi! I'm going to run a quick stress check on your voice.
   Just talk to me naturally for about 30 seconds — tell me about
   your day, how you're feeling, anything on your mind. I'm listening!"
2. While the user talks, respond with very brief encouragements like
   "Mhm", "Go on", "I see", or short follow-up questions to keep
   them talking naturally.
3. Do NOT explain the science. Do NOT diagnose. Do NOT give long replies.
   Just keep the conversation flowing so we capture enough voice data.
""".strip()

SEGMENTS = {
    "speech": PROMPT_SPEECH,
    "health": PROMPT_HEALTH,
    "stress": PROMPT_STRESS,
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
    Segments: speech | health | stress
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

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"session": session_config},
        )

    # If the nested transcription param was rejected, retry without it
    if resp.status_code != 200 and "transcription" in resp.text:
        print(f"Transcription config rejected, retrying without it: {resp.text}")
        del session_config["audio"]["input"]
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"session": session_config},
            )

    if resp.status_code != 200:
        print(f"OpenAI token error {resp.status_code}: {resp.text}")
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"OpenAI error: {resp.text}",
        )

    return JSONResponse(resp.json())


# ---------------------------------------------------------------------------
# Voice analysis endpoints
# ---------------------------------------------------------------------------

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
