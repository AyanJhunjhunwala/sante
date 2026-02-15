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
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from services.audio_analyzer import analyze_chunk
from services.benchmarking import append_run
from services.session_manager import session_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/analysis/{session_id}")
async def analysis_ws(
    websocket: WebSocket,
    session_id: str,
    segment: str = Query(default="conversation"),
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

                # Pass full accumulated audio buffer for pitch detection
                session = session_manager.get_session(session_id)
                audio_buf = session.audio_buffer if session else None

                frames = await analyze_chunk(chunk, chunk_count, segment, audio_buf)
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

                    benchmark_id = str(data.get("benchmark_id") or "").strip()
                    if benchmark_id:
                        provider = str(data.get("provider") or "sante-realtime")
                        run_id = str(data.get("run_id") or f"ws_{uuid.uuid4().hex}")
                        session_state = session_manager.get_session(session_id)
                        transcript = session_state.transcript if session_state else []
                        turn_count = len(
                            [
                                t
                                for t in transcript
                                if getattr(t, "role", "") == "user"
                                and getattr(t, "text", "").strip()
                            ]
                        )
                        session_total_ms = summary.get("duration_seconds", 0.0) * 1000

                        try:
                            append_run(
                                {
                                    "benchmark_id": benchmark_id,
                                    "provider": provider,
                                    "run_id": run_id,
                                    "session_total_ms": session_total_ms,
                                    "turn_count": turn_count,
                                    "metadata": {
                                        "session_id": session_id,
                                        "segment": summary.get("segment"),
                                        "audio_bytes": summary.get("audio_bytes"),
                                        "transcript_turns": summary.get("transcript_turns"),
                                    },
                                }
                            )
                        except Exception as exc:
                            logger.warning(
                                f"[WS] Failed benchmark logging for {session_id}: {exc}"
                            )

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
