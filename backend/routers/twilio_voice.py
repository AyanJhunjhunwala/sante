"""
Twilio Voice router.

Three endpoints:
  POST /twilio/voice
      Twilio calls this when an inbound call arrives.
      Returns TwiML that connects the call to our Media Streams WebSocket.

  WS   /twilio/media-stream/{call_sid}
      Twilio opens this WebSocket to stream real-time mulaw audio.
      We bridge it bidirectionally to OpenAI Realtime API via CallBridge.

  POST /twilio/status
      Twilio calls this when the call ends (statusCallback).
      We enqueue the analysis + PDF + SMS job in Redis.
"""

import asyncio
import logging
import os

from fastapi import APIRouter, Form, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from services.call_bridge import CallBridge
from services.redis_queue import enqueue_call_analysis

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/twilio", tags=["twilio"])

# In-memory store: call_sid -> audio WAV path (set by bridge when call ends)
_audio_paths: dict[str, str] = {}

# Track call SIDs that have already been enqueued to prevent duplicate jobs
# from the second Twilio status callback that arrives ~3s after the first.
_enqueued_sids: set[str] = set()

# Twilio sends the status POST almost simultaneously with the WS stop frame.
# We wait up to this many seconds for the bridge to write the audio path before
# giving up and enqueuing with audio_path=None.
_AUDIO_PATH_WAIT_SECS = 3


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@router.post("/voice")
async def twilio_voice_webhook(
    CallSid: str = Form(...),
    From: str = Form(...),
    To: str = Form(default=""),
) -> Response:
    """
    Twilio webhook: inbound call arrived.
    Returns TwiML that opens a Media Stream WebSocket back to this server.
    The <Connect action> tells Twilio to POST to /twilio/status when the stream ends.
    """
    backend_base_url = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
    # Twilio requires WSS for production; WS is accepted when using ngrok or localhost
    ws_base = backend_base_url.replace("https://", "wss://").replace("http://", "ws://")
    stream_url = f"{ws_base}/twilio/media-stream/{CallSid}"
    status_url = f"{backend_base_url}/twilio/status"

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="{status_url}" method="POST">
    <Stream url="{stream_url}">
      <Parameter name="caller_phone" value="{From}"/>
    </Stream>
  </Connect>
</Response>"""

    logger.info(f"[twilio] Inbound call: CallSid={CallSid}, From={From}")
    return Response(content=twiml, media_type="application/xml")


@router.websocket("/media-stream/{call_sid}")
async def twilio_media_stream(websocket: WebSocket, call_sid: str) -> None:
    """
    Twilio Media Stream WebSocket endpoint.
    Creates a CallBridge that forwards audio between Twilio and OpenAI Realtime.
    """
    await websocket.accept()
    logger.info(f"[twilio] Media stream connected: call_sid={call_sid}")

    import os, traceback as _tb

    logger.info(f"[twilio] OPENAI_API_KEY set: {bool(os.getenv('OPENAI_API_KEY'))}")

    bridge = CallBridge(
        call_sid=call_sid, twilio_ws=websocket, audio_paths=_audio_paths
    )
    try:
        await bridge.run()
        logger.info(f"[twilio] bridge.run() returned normally for {call_sid}")
    except WebSocketDisconnect:
        logger.info(f"[twilio] Twilio disconnected: call_sid={call_sid}")
    except Exception as exc:
        logger.error(f"[twilio] Bridge error for {call_sid}: {exc}\n{_tb.format_exc()}")
    finally:
        await bridge.cleanup()


@router.post("/status")
async def twilio_status_callback(
    CallSid: str = Form(...),
    CallStatus: str = Form(...),
    From: str = Form(...),
    To: str = Form(default=""),
    CallDuration: str = Form(default="0"),
) -> Response:
    """
    Twilio status callback: called when a call reaches a terminal state.
    Enqueues the analysis + PDF generation + SMS job in Redis.
    """
    terminal_statuses = {"completed", "failed", "busy", "no-answer", "canceled"}

    logger.info(
        f"[twilio] Status callback: CallSid={CallSid}, status={CallStatus}, "
        f"from={From}, duration={CallDuration}s"
    )

    if CallStatus in terminal_statuses:
        # Twilio sends two status POSTs for the same call (one when the stream
        # ends, one when the call record is finalized). Only process the first.
        if CallSid in _enqueued_sids:
            logger.info(f"[twilio] Duplicate status callback for {CallSid} — ignoring")
            return Response(content="", status_code=204)
        _enqueued_sids.add(CallSid)

        try:
            # Wait briefly for the bridge's stop handler to write the audio path.
            # The WS stop frame and this POST arrive almost simultaneously.
            audio_path: str | None = None
            deadline = asyncio.get_event_loop().time() + _AUDIO_PATH_WAIT_SECS
            while asyncio.get_event_loop().time() < deadline:
                if CallSid in _audio_paths:
                    audio_path = _audio_paths.pop(CallSid)
                    break
                await asyncio.sleep(0.1)

            ai_transcript = _audio_paths.pop(f"{CallSid}:ai_transcript", "") or ""
            user_transcript = _audio_paths.pop(f"{CallSid}:user_transcript", "") or ""

            if audio_path:
                logger.info(f"[twilio] Audio path ready for {CallSid}: {audio_path}")
            else:
                logger.warning(
                    f"[twilio] No audio path for {CallSid} after waiting {_AUDIO_PATH_WAIT_SECS}s"
                )
            if ai_transcript or user_transcript:
                logger.info(
                    f"[twilio] Transcript captured — AI: {len(ai_transcript)} chars, "
                    f"User: {len(user_transcript)} chars"
                )

            job = enqueue_call_analysis(
                call_sid=CallSid,
                caller_phone=From,
                call_status=CallStatus,
                duration_seconds=int(CallDuration or 0),
                audio_path=audio_path,
                ai_transcript=ai_transcript,
                user_transcript=user_transcript,
                forward_opt_in=_env_bool("ACTION_FORWARD_TWILIO_OPT_IN", default=False),
                forward_recipient=os.getenv("ACTION_FORWARD_DEFAULT_RECIPIENT", ""),
            )
            logger.info(f"[twilio] Enqueued analysis job: {job.id} for call {CallSid}")
        except Exception as exc:
            logger.error(f"[twilio] Failed to enqueue job for {CallSid}: {exc}")

    return Response(content="", status_code=204)
