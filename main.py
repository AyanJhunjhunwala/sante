import os
import io
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from openai import OpenAI

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

app = FastAPI(title="Santé", description="Voice Biomarker Platform")

# Static files & templates
BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def _get_openai_client() -> OpenAI:
    """Return an OpenAI client, raising a clear error if the key is missing."""
    if not OPENAI_API_KEY or OPENAI_API_KEY == "your_openai_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in your .env file.",
        )
    return OpenAI(api_key=OPENAI_API_KEY)


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ---------------------------------------------------------------------------
# ASR  –  Speech-to-Text  (OpenAI Whisper)
# ---------------------------------------------------------------------------
@app.post("/api/asr")
async def asr(audio: UploadFile = File(...)):
    """Receive an audio file and return a Whisper transcription."""
    client = _get_openai_client()

    try:
        contents = await audio.read()
        audio_file = io.BytesIO(contents)
        audio_file.name = audio.filename or "recording.webm"

        transcription = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
        )
        return JSONResponse({"text": transcription.text})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# TTS  –  Text-to-Speech  (OpenAI TTS)
# ---------------------------------------------------------------------------
class TTSRequest(BaseModel):
    text: str
    voice: str = "nova"


@app.post("/api/tts")
async def tts(body: TTSRequest):
    """Generate speech from text and return an audio stream."""
    client = _get_openai_client()

    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text is required.")

    valid_voices = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
    voice = body.voice if body.voice in valid_voices else "nova"

    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=body.text.strip(),
        )
        audio_bytes = response.content

        return StreamingResponse(
            io.BytesIO(audio_bytes),
            media_type="audio/mpeg",
            headers={"Content-Length": str(len(audio_bytes))},
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
