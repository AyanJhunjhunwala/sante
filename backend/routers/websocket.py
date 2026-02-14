"""
WebSocket router — streams real-time analysis back to the frontend
as the user speaks during a voice session.

Protocol:
  Client → Server binary:  raw audio/webm chunks (500ms intervals)
  Client → Server text:    JSON { type: "transcript"|"end_session", ... }
  Server → Client text:    JSON frames (waveform, stress_score, speech_metrics, ...)
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from agents.phoneme_detector import analyze_phonemes
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
                    if frame["type"] == "_phoneme_trigger":
                        # Fire-and-forget phoneme analysis — never blocks the WS loop
                        audio = session_manager.get_phoneme_audio(session_id)
                        ref_text = session_manager.get_latest_user_transcript(
                            session_id
                        )
                        if len(audio) >= 1000 and ref_text:
                            asyncio.create_task(
                                _run_phoneme_analysis(
                                    session_id, websocket, audio, ref_text
                                )
                            )
                    else:
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


async def _run_phoneme_analysis(
    session_id: str,
    websocket: WebSocket,
    audio: bytes,
    ref_text: str,
) -> None:
    """
    Background task: call RunPod phoneme model and push result to client.
    Errors are logged silently — never crashes the session.
    """
    logger.info(
        f"[WS] Phoneme analysis triggered for {session_id} "
        f"({len(audio)} bytes, ref={repr(ref_text[:60])})"
    )
    try:
        result = await analyze_phonemes(audio, ref_text)
        if "error" in result:
            logger.warning(f"[WS] Phoneme error for {session_id}: {result['error']}")
            return
        await websocket.send_json(
            {
                "type": "phonemes",
                "ref_phonemes": result.get("ref_phonemes", []),
                "decode_phonemes": result.get("decode_phonemes", []),
                "dys_detect": result.get("dys_detect", []),
            }
        )
        logger.info(f"[WS] Phonemes sent for {session_id}")
    except Exception as exc:
        logger.warning(f"[WS] Phoneme analysis failed for {session_id}: {exc}")
