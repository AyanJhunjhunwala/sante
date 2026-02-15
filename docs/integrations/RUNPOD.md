# RunPod Integration (Primary External ML Path)

This project depends heavily on RunPod serverless endpoints for model inference beyond local DSP features.

## Why RunPod is central in Santé

RunPod currently serves two production-critical workloads:

1. **Stress detection endpoint** (binary stress signal)
2. **DysfluentWFST endpoint** (phoneme + disfluency decoding)

Without RunPod, the app can still perform local acoustic extraction (openSMILE), but stress/phoneme outputs are unavailable.

## Endpoint inventory

| Function | Backend caller | Input | Output |
|---|---|---|---|
| Stress detection | `backend/agents/stress_detector.py` | base64 audio | prediction + confidence |
| Phoneme/disfluency | `backend/agents/phoneme_detector.py` | base64 WAV + optional `ref_text` | `ref_phonemes`, `decode_phonemes`, `dys_detect` |

Endpoint identifiers are configured in backend environment settings.

## Authentication

RunPod credentials are loaded from backend environment configuration.

Call pattern uses bearer auth header at runtime:

```http
Authorization: Bearer <runpod-api-key>
```

## Stress endpoint behavior

File: `backend/agents/stress_detector.py`

- Submits `POST /run` payload with `audio_base64`
- Polls `GET /status/{id}` every 2 seconds
- Retries up to 3 attempts on cold-start-style failures with 8-second delay
- Per-attempt timeout: 120 seconds

Returned shape includes:
- `prediction`: `STRESSED` or `NOT STRESSED`
- `confidence`
- score distribution fields (`stressed`, `not_stressed`)

## DysfluentWFST endpoint behavior

File: `backend/agents/phoneme_detector.py`

- Converts incoming audio to WAV if needed
- Submits base64 WAV plus optional reference text
- Polls status until completion
- Retries up to 2 attempts on cold-start conditions with 6-second delay
- Poll timeout: 300 seconds (large image cold start tolerance)

Returned shape:
- `ref_phonemes`
- `decode_phonemes`
- `dys_detect` (repetition/insertion/deletion style annotations)

## DysfluentWFST model stack (inside endpoint image)

Path: `backend/speech_processing/DysfluentWFST/`

- Acoustic front: `facebook/wav2vec2-xlsr-53-phon-cv-ft`
- Decoder: custom `WFSTdecoder` using k2 lattice operations
- Lexicon/config: `config/lexicon.json`, `config/ipa2cmu.json`
- Similarity matrix: `utils/rule_sim_matrix.npy`

Core decoding concepts:
- CTC logits from wav2vec2
- WFST graph transitions for normal/back/skip/substitution behavior
- k2 compose + intersect_dense to decode against reference constraints
- Post-pass disfluency categorization from state trajectory

## Deployment notes

Primary files:
- `backend/speech_processing/DysfluentWFST/Dockerfile`
- `backend/speech_processing/DysfluentWFST/handler.py`
- `backend/speech_processing/DysfluentWFST/RUNPOD_CONTEXT.md`

Operational constraints:
- Cold starts can be significant (large model image)
- k2 has platform/runtime constraints; Linux environment expected
- Keep endpoint warm for lower latency during demos

## Failure modes and mitigation

- **Cold start timeout**: rely on built-in retries, increase patience before hard-failing.
- **Auth failure**: verify RunPod credential scope and value.
- **Endpoint mismatch**: ensure env endpoint IDs match deployed services.
- **Audio format issues**: verify ffmpeg conversion path and WAV generation before submit.

## Local test command

From `backend/speech_processing/DysfluentWFST/`:

```powershell
python test_endpoint.py
```

Requires backend RunPod credentials in environment.
Requires backend RunPod credentials in environment.

## Related docs

- Main docs entrypoint: `README.MD`
- System topology: `docs/ARCHITECTURE.md`
- Setup: `docs/SETUP.md`
