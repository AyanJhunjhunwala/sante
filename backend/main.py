"""
Santé — Voice Health Analysis
FastAPI backend: token minting, stress analysis upload, and real-time WS analysis.
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import analysis, summary, tokens, twilio_voice, websocket

load_dotenv()

app = FastAPI(title="Santé", description="Voice AI Health Platform")

# ---------------------------------------------------------------------------
# CORS — dev origins always included; production Vercel URL(s) read from env.
# On Railway set ALLOWED_ORIGINS to a comma-separated list, e.g.:
#   https://sante.vercel.app,https://sante-git-main.vercel.app
# ---------------------------------------------------------------------------
_default_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_extra_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(tokens.router)
app.include_router(analysis.router)
app.include_router(summary.router)
app.include_router(websocket.router)
app.include_router(twilio_voice.router)

# Serve generated PDF reports at /static/reports/{call_sid}.pdf
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
