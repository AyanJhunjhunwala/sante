"""
In-memory session manager for WebSocket analysis sessions.
Stores audio buffer, transcript, and metadata per session.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket


@dataclass
class TranscriptEntry:
    role: str  # "user" | "assistant"
    text: str
    timestamp: float = field(default_factory=time.time)


@dataclass
class SessionState:
    session_id: str
    segment: str
    websocket: "WebSocket"
    audio_buffer: bytearray = field(default_factory=bytearray)
    transcript: list[TranscriptEntry] = field(default_factory=list)
    chunk_count: int = 0
    created_at: float = field(default_factory=time.time)


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}

    def create_session(
        self, session_id: str, segment: str, websocket: "WebSocket"
    ) -> SessionState:
        state = SessionState(
            session_id=session_id, segment=segment, websocket=websocket
        )
        self._sessions[session_id] = state
        return state

    def get_session(self, session_id: str) -> SessionState | None:
        return self._sessions.get(session_id)

    def append_audio(self, session_id: str, chunk: bytes) -> int:
        """Append audio chunk and return the new chunk count."""
        session = self._sessions.get(session_id)
        if session is None:
            return 0
        session.audio_buffer.extend(chunk)
        session.chunk_count += 1
        return session.chunk_count

    def append_transcript(self, session_id: str, role: str, text: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.transcript.append(TranscriptEntry(role=role, text=text))

    def get_summary(self, session_id: str) -> dict:
        session = self._sessions.get(session_id)
        if session is None:
            return {}
        return {
            "session_id": session_id,
            "segment": session.segment,
            "audio_bytes": len(session.audio_buffer),
            "chunks_received": session.chunk_count,
            "transcript_turns": len(session.transcript),
            "duration_seconds": round(time.time() - session.created_at, 1),
        }

    def remove_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# Singleton instance shared across requests
session_manager = SessionManager()
