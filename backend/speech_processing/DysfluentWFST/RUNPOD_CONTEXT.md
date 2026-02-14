# DysfluentWFST — RunPod Serverless Deployment Context

## What This Is

Zero-shot speech disfluency detection using WFST (Weighted Finite-State Transducers).
Interspeech 2025 paper. The goal is to deploy this as a RunPod Serverless API endpoint
for the sante app backend.

## How the Inference Pipeline Works

1. Load audio (.wav, 22050 Hz) → resample to 16 kHz
2. Run `facebook/wav2vec2-xlsr-53-phon-cv-ft` (HuggingFace CTC model) → logits `[B, T, 272]`
3. Wrap logits + reference text in a batch
4. Pass to `WFSTdecoder.decode()` → returns disfluency annotations per phoneme

Output example:
```json
{
  "ref_phonemes": ["DH", "EY", "L", "EH", "F", "T", "ER", "L", "IY"],
  "decode_phonemes": ["DH", "EY", "L", "L", "EH", "F", "T", "L", "IY"],
  "dys_detect": [
    {"phoneme": "l", "start_state": 2, "end_state": 3, "dysfluency_type": "normal"},
    {"phoneme": "l", "start_state": 7, "end_state": 8, "dysfluency_type": "repetition"}
  ]
}
```

## Key Constraints

- **k2 is CPU-only** — `k2.intersect_dense`, `k2.compose`, `k2.shortest_path` do not support CUDA
- **k2 is Linux-only** — no Windows wheels exist; do not attempt local Windows install
- **Relative paths** — `decoder.py:17` loads `utils/rule_sim_matrix.npy` relative to CWD.
  The Docker container WORKDIR must be set to the DysfluentWFST root directory.
- **Wav2Vec2 CAN use GPU** — only the logits need to be `.cpu()` before passing to k2
- **WFST decoding is not incremental** — needs complete audio + reference text upfront.
  Streaming means: buffer audio until utterance boundary, then run full inference.

## File Structure

```
DysfluentWFST/
├── handler.py              ← TO CREATE: RunPod serverless entry point
├── Dockerfile              ← TO CREATE: container definition
├── utils/
│   ├── decoder.py          ← WFSTdecoder class (426 lines) — do not modify
│   ├── wper.py             ← W_PER metric — do not modify
│   └── rule_sim_matrix.npy ← 41×41 phoneme similarity matrix (loaded at init)
├── config/
│   ├── ipa2cmu.json        ← IPA → CMU phoneme mapping
│   └── lexicon.json        ← full IPA phoneme inventory
└── data/                   ← demo samples only, NOT deployed
```

## Exact Dependency Versions

```
k2==1.24.4.dev20251029+cpu.torch2.9.0   # CPU wheel, tied to torch 2.9.0 exactly
torch==2.9.0                             # must match k2 wheel
torchaudio==2.9.0                        # match torch
transformers>=4.48.0                     # for Wav2Vec2
cmudict                                  # text → CMU phoneme lookup
jiwer                                    # WER metric (used inside decoder.py)
runpod                                   # serverless framework
```

k2 CPU wheel index URL: https://k2-fsa.github.io/k2/cpu.html

## RunPod Serverless Architecture

- **Input**: `{"audio_base64": "<base64 encoded .wav>", "ref_text": "They left early"}`
- **Output**: `{"id": "...", "ref_phonemes": [...], "decode_phonemes": [...], "dys_detect": [...]}`
- Load Wav2Vec2 model + WFSTdecoder **at module level** (warm, once per container)
- Worker type: CPU (k2 forces this; Wav2Vec2 on CPU is acceptable at this throughput)
- Min workers: 0 (scale to zero), Max workers: start with 1-2

## Deployment Workflow

```
Write code (Windows, Docker Desktop) → docker build → docker push to Docker Hub
→ RunPod Serverless UI: New Endpoint → point at image → test in UI
```

No WSL needed. Docker Desktop on Windows builds Linux images fine.

## Model Caching

`facebook/wav2vec2-xlsr-53-phon-cv-ft` is ~1.2 GB. Options:
- **Bake into Docker image** (simplest): run `huggingface-cli download` during docker build
- **RunPod Network Volume** (faster iteration): mount volume, download once
- **Download at startup** (avoid): ~2 min cold start

Recommended for first pass: bake into image.

## Testing

1. RunPod UI → endpoint → Requests tab → paste JSON → Run
2. `runpod` Python SDK: `runpod.run_sync(endpoint_id, payload)`
3. Small local test script: base64-encode one of the `data/audio/*.wav` files + ref_text → POST

## What To Build Next

1. `handler.py` — module-level model init + `handler(job)` function
2. `Dockerfile` — Ubuntu 22.04, Python 3.9, torch 2.9.0, k2 CPU wheel, bake in model
3. Local test script — encode a sample wav, call the endpoint

## Future: Streaming Audio

Not implemented yet. Design will be:
- Client streams audio chunks to sante backend
- VAD/silence detection to find utterance boundaries
- Complete utterance sent to this RunPod endpoint as base64
- Handler unchanged — streaming complexity lives in the sante backend, not here
