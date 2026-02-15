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

import logging
import os

from fastapi import APIRouter, Form, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from services.call_bridge import CallBridge
from services.redis_queue import enqueue_call_analysis

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/twilio", tags=["twilio"])


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

    bridge = CallBridge(call_sid=call_sid, twilio_ws=websocket)
    try:
        await bridge.run()
    except WebSocketDisconnect:
        logger.info(f"[twilio] Twilio disconnected: call_sid={call_sid}")
    except Exception as exc:
        logger.error(f"[twilio] Bridge error for {call_sid}: {exc}")
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
        try:
            job = enqueue_call_analysis(
                call_sid=CallSid,
                caller_phone=From,
                call_status=CallStatus,
                duration_seconds=int(CallDuration or 0),
            )
            logger.info(f"[twilio] Enqueued analysis job: {job.id} for call {CallSid}")
        except Exception as exc:
            logger.error(f"[twilio] Failed to enqueue job for {CallSid}: {exc}")

    return Response(content="", status_code=204)
