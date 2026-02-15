# API Reference

## Health

### `GET /health`

Returns service liveness:

```json
{"status": "ok"}
```

## Token routes

### `GET /token/{segment}`

Mint OpenAI realtime ephemeral session secret.

- Valid segment currently enforced: `conversation`
- Error on unsupported segment

### `GET /token/read-aloud-prompt`

Returns read-aloud instruction prompt used for phase transition.

## Analysis routes (`/api/analyze`)

### `POST /api/analyze/stress`

Input: multipart audio file.
Output: stress prediction payload from RunPod adapter.

### `POST /api/analyze/acoustics`

Input: multipart audio file.
Output: 11 openSMILE-derived acoustic metrics.

### `POST /api/analyze/phonemes`

Input: multipart audio file and optional `ref_text` form field.
Output: phoneme and disfluency arrays from RunPod WFST endpoint.

### `POST /api/analyze/transcript`

Input: multipart audio file.
Output: text transcription from OpenAI transcription model.

## Session summary routes (`/api/session-summary`)

### `POST /api/session-summary`

Generates full session report object from transcript + analysis signals.
Can optionally trigger action forwarding.

### `POST /api/session-summary/chat`

Chat over an existing report.

### `POST /api/session-summary/report`

Generate narrative AI report text.

### `POST /api/session-summary/report-structured`

Generate structured report sections JSON.

### `POST /api/session-summary/export-pdf`

Export report PDF and return URL metadata.

## Benchmark routes (`/api/benchmark`)

### `POST /api/benchmark/runs`

Append benchmark run payload to JSONL store.

### `POST /api/benchmark/summary`

Aggregate provider summary and optional baseline-vs-candidate deltas.

## WebSocket routes

### `WS /ws/analysis/{session_id}`

Client sends:

- binary audio chunks
- JSON control messages (`transcript`, `end_session`)

Server emits message types including:

- `connected`
- `waveform`
- `pitch`
- `transcript_ack`
- `session_complete`
- `error`

### `WS /twilio/media-stream/{call_sid}`

Twilio media stream bridge for telephony sessions.

## Twilio webhooks

### `POST /twilio/voice`

Inbound call entrypoint. Returns TwiML stream instructions.

### `POST /twilio/status`

Call status callback. Enqueues post-call processing job.

## Upload constraints

Analysis upload paths enforce minimum/maximum payload and extension/MIME checks.
