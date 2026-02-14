import runpod
import base64
import io
import json

import torch
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

from utils.decoder import WFSTdecoder

# ── Module-level init (runs once per container, stays warm) ──────────────────

MODEL_NAME = "facebook/wav2vec2-xlsr-53-phon-cv-ft"

print("Loading Wav2Vec2...")
processor = Wav2Vec2Processor.from_pretrained(MODEL_NAME)
model = Wav2Vec2ForCTC.from_pretrained(MODEL_NAME)
model.eval()

print("Loading WFST decoder...")
phoneme_lexicon = json.load(open("config/lexicon.json"))
decoder = WFSTdecoder(device="cpu", phoneme_lexicon=phoneme_lexicon, is_ipa=True)

print("Ready.")

# ── Handler ───────────────────────────────────────────────────────────────────

def handler(job):
    job_input = job["input"]
    audio_bytes = base64.b64decode(job_input["audio_base64"])
    ref_text = job_input["ref_text"]

    # Load audio and resample to 16 kHz
    waveform, sample_rate = torchaudio.load(io.BytesIO(audio_bytes))
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=16000)(waveform)
    waveform = waveform.squeeze()

    # Wav2Vec2 → logits [1, T, 272]
    input_values = processor(waveform, return_tensors="pt", sampling_rate=16000).input_values
    with torch.no_grad():
        logits = model(input_values).logits

    # Build batch dict as WFSTdecoder.decode() expects
    batch = {
        "id": ["input"],
        "tensor": logits,
        "ref_text": [ref_text],
        "lengths": torch.tensor([logits.shape[1]], dtype=torch.int32),
    }

    results = decoder.decode(batch, beta=5, num_beam=25, back=True, skip=False)
    r = results[0]

    return {
        "id": r["id"],
        "ref_phonemes": r["ref_phonemes"],
        "decode_phonemes": r["decode_phonemes"],
        "dys_detect": r["dys_detect"],
    }


runpod.serverless.start({"handler": handler})
