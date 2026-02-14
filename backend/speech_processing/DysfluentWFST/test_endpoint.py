import base64
import runpod
import os
from dotenv import load_dotenv
load_dotenv()
# ── Config ────────────────────────────────────────────────────────────────────
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")   # runpod.io → Settings → API Keys
ENDPOINT_ID = 'eib51lbk8ca3wl'       # runpod.io → Serverless → your endpoint

AUDIO_FILE = "data/audio/p088_4067.wav"
REF_TEXT   = "They left early"
# ─────────────────────────────────────────────────────────────────────────────
print("API key:", RUNPOD_API_KEY)

runpod.api_key = RUNPOD_API_KEY
endpoint = runpod.Endpoint(ENDPOINT_ID)

with open(AUDIO_FILE, "rb") as f:
    audio_b64 = base64.b64encode(f.read()).decode()

print("Sending request...")
run = endpoint.run({"audio_base64": audio_b64, "ref_text": REF_TEXT})

import time
while True:
    status = run.status()
    print("Status:", status)
    if status in ("COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"):
        break
    time.sleep(3)

print("Output:", run.output())
print("Full job:", run)
