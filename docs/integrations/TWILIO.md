# Twilio Integration

## Scope

Twilio covers inbound phone sessions, media streaming, and report/alert delivery.

## Router endpoints

File: `backend/routers/twilio_voice.py`

- `POST /twilio/voice`
- `WS /twilio/media-stream/{call_sid}`
- `POST /twilio/status`

## Call flow

1. Twilio calls `/twilio/voice`
2. Backend returns TwiML with `<Connect><Stream>`
3. Twilio media stream connects to backend WebSocket
4. `CallBridge` relays audio with OpenAI Realtime and captures transcript/audio
5. On status callback, backend enqueues worker job for full report processing

## Audio conversion

`backend/services/call_bridge.py` converts between:

- Twilio mulaw 8kHz
- OpenAI PCM16 24kHz

Then persisted audio is converted for downstream analysis and PDF flow.

## Messaging

File: `backend/services/sms_sender.py`

- `send_sms_report(...)` sends MMS with PDF report link/media
- `send_clinician_alert(...)` sends urgent/routine clinician text alerts

## Forwarding policy

File: `backend/services/action_forwarding.py`

Forwarding checks:

- feature toggle enabled
- recipient allowlisted
- user opted in
- score threshold and quality grade met
- urgent safety bypass path

## Required env

Twilio credentials and forwarding policy settings are configured in backend environment files.

## Related docs

- [REDIS.md](REDIS.md)
- [../SETUP.md](../SETUP.md)
