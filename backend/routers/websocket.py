"""
WebSocket router — streams real-time analysis back to the frontend
as the user speaks during a voice session.

Protocol:
  Client → Server binary:  raw audio/webm chunks (500ms intervals)
  Client → Server text:    JSON { type: "transcript"|"end_session", ... }
  Server → Client text:    JSON frames (waveform, stress_score, speech_metrics, ...)
"""

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from services.audio_analyzer import analyze_chunk
from services.session_manager import session_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/analysis/{session_id}")
async def analysis_ws(
    websocket: WebSocket,
    session_id: str,
    segment: str = Query(default="stress"),
) -> None:
    """
    Real-time analysis WebSocket.
    - Accepts binary audio chunks and JSON control messages.
    - Streams waveform, stress score, and speech metrics back.
    """
    await websocket.accept()
    session_manager.create_session(session_id, segment, websocket)
    logger.info(f"[WS] Session {session_id} connected (segment={segment})")

    await websocket.send_json(
        {
            "type": "connected",
            "session_id": session_id,
            "segment": segment,
        }
    )

    try:
        while True:
            message = await websocket.receive()

            # ── Binary: audio chunk from MediaRecorder ──
            if message.get("bytes"):
                chunk = message["bytes"]
                chunk_count = session_manager.append_audio(session_id, chunk)

                frames = await analyze_chunk(chunk, chunk_count, segment)
                for frame in frames:
                    await websocket.send_json(frame)

            # ── Text: JSON control messages ──
            elif message.get("text"):
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    logger.warning(f"[WS] Invalid JSON from {session_id}")
                    continue

                msg_type = data.get("type")

                if msg_type == "transcript":
                    role = data.get("role", "user")
                    text = data.get("text", "")
                    session_manager.append_transcript(session_id, role=role, text=text)
                    await websocket.send_json({"type": "transcript_ack"})

                elif msg_type == "end_session":
                    summary = session_manager.get_summary(session_id)
                    await websocket.send_json(
                        {
                            "type": "session_complete",
                            "summary": summary,
                        }
                    )
                    break

    except WebSocketDisconnect:
        logger.info(f"[WS] Session {session_id} disconnected")
    except Exception as exc:
        logger.error(f"[WS] Session {session_id} error: {exc}")
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        session_manager.remove_session(session_id)
        logger.info(f"[WS] Session {session_id} cleaned up")
