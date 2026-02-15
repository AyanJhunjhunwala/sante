# OpenAI Integration

## Surfaces used

Santé uses OpenAI in three distinct paths:

1. **Realtime voice sessions** (browser and Twilio bridge)
2. **Speech transcription** (`gpt-4o-mini-transcribe`)
3. **Summary/safety language analysis** (`gpt-4o-mini`)

## Realtime token minting

Backend route: `GET /token/{segment}` in `backend/routers/tokens.py`.

Flow:

1. Backend uses configured OpenAI credentials
2. Backend requests ephemeral client secret from OpenAI Realtime
3. Frontend uses ephemeral secret to establish WebRTC session

## Browser realtime path

- Frontend hook: `frontend/hooks/useWebRTC.ts`
- Realtime endpoint: `https://api.openai.com/v1/realtime/calls`
- Data channel events are used to stream transcripts and speaking state

## Twilio realtime path

- Bridge: `backend/services/call_bridge.py`
- Uses OpenAI Realtime WebSocket for phone call bidirectional audio
- Manages phase transitions (conversation -> read aloud -> goodbye)

## Models and behavior

- `gpt-realtime` / realtime preview model for voice dialogue
- `gpt-4o-mini-transcribe` for audio transcription
- `gpt-4o-mini` for:
  - structured report generation
  - narrative report generation
  - safety semantic classification

## Configuration

OpenAI credentials are loaded from backend environment settings.

## Notes

- Token route includes a fallback when transcription config is rejected by OpenAI.
- Frontend rewrite/proxy is configured in `frontend/next.config.ts` for `/token/*` and `/api/*`.

## Related docs

- [RUNPOD.md](RUNPOD.md)
- [../ARCHITECTURE.md](../ARCHITECTURE.md)
