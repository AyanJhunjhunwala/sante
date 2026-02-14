"""
In-memory session manager for WebSocket analysis sessions.
Stores audio buffer, transcript, and metadata per session.
"""

from __future__ import annotations

import time
from collections import deque
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
    # Rolling window of the last 6 raw chunks (~3 s) for phoneme analysis
    phoneme_chunk_buffer: deque = field(default_factory=lambda: deque(maxlen=6))
    transcript: list[TranscriptEntry] = field(default_factory=list)
    # Latest user transcript text — used as ref_text for the phoneme model
    latest_user_transcript: str = ""
    # Accumulated decoded phonemes across all RunPod calls this session
    accumulated_phonemes: list[str] = field(default_factory=list)
    accumulated_dys_detect: list[str] = field(default_factory=list)
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
        """Append audio chunk, update rolling buffer, return new chunk count."""
        session = self._sessions.get(session_id)
        if session is None:
            return 0
        session.audio_buffer.extend(chunk)
        session.phoneme_chunk_buffer.append(chunk)
        session.chunk_count += 1
        return session.chunk_count

    def append_transcript(self, session_id: str, role: str, text: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.transcript.append(TranscriptEntry(role=role, text=text))
        # Track latest user speech for phoneme ref_text
        if role == "user" and text.strip():
            session.latest_user_transcript = text.strip()

    def get_phoneme_audio(self, session_id: str) -> bytes:
        """Return joined bytes from the rolling phoneme chunk buffer (~3 s)."""
        session = self._sessions.get(session_id)
        if session is None:
            return b""
        return b"".join(session.phoneme_chunk_buffer)

    def get_latest_user_transcript(self, session_id: str) -> str:
        session = self._sessions.get(session_id)
        if session is None:
            return ""
        return session.latest_user_transcript

    def append_phonemes(
        self, session_id: str, phonemes: list[str], dys_detect: list[str]
    ) -> None:
        """Accumulate decoded phonemes + disfluency labels for the end-of-session report."""
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.accumulated_phonemes.extend(phonemes)
        session.accumulated_dys_detect.extend(dys_detect)

    def get_accumulated_phonemes(self, session_id: str) -> dict:
        """Return all accumulated phonemes and dys_detect labels for this session."""
        session = self._sessions.get(session_id)
        if session is None:
            return {"phonemes": [], "dys_detect": []}
        return {
            "phonemes": list(session.accumulated_phonemes),
            "dys_detect": list(session.accumulated_dys_detect),
        }

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
            # Real phonemes detected by RunPod during the session
            "accumulated_phonemes": list(session.accumulated_phonemes),
            "accumulated_dys_detect": list(session.accumulated_dys_detect),
        }

    def remove_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# Singleton instance shared across requests
session_manager = SessionManager()
