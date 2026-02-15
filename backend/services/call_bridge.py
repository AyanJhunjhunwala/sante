"""
CallBridge — bidirectional audio bridge between Twilio Media Streams and OpenAI Realtime API.

Audio format conversions:
  Twilio -> OpenAI : mulaw 8 kHz  -> PCM16 24 kHz  (ulaw2lin + ratecv upsample)
  OpenAI -> Twilio : PCM16 24 kHz -> mulaw 8 kHz   (ratecv downsample + lin2ulaw)

OpenAI Realtime events (server WebSocket mode, no ephemeral token needed):
  Outbound: session.update, input_audio_buffer.append
  Inbound:  session.created, response.audio.delta, response.audio.done, error
"""

import asyncio
import audioop
import base64
import json
import logging
import os
from typing import TYPE_CHECKING

import websockets
import websockets.exceptions

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)

OPENAI_REALTIME_URL = (
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
)

# Reuse the conversation phase prompt from tokens.py (same content, phone-adapted greeting)
PHONE_SYSTEM_PROMPT = """
You are Santé, a live voice conversation agent. English only.
This is the CONVERSATION phase.

Core behavior:
- Behave like a real discussion partner, not a script reader.
- Respond to what the user just said, then ask one natural follow-up question.
- Keep language supportive, neutral, and non-diagnostic.
- Never claim medical certainty. Do not provide diagnosis or treatment.

CRITICAL output rules:
- NEVER start your response with "Conversation:", "Read Aloud:", or any label/prefix.
- NEVER include a "Read Aloud" or "Repeat Back" section.
- Just speak naturally without any labels or formatting.

Length constraints:
- Max 15 words per response.

Flow guidance:
- Start with: "Hi, this is Santé. How are you feeling today?"
- Ask one question at a time, adapting based on the user's prior answer.
- Topics: how they're feeling, their day, recent activities, sleep, energy, mood.
- Use brief acknowledgments, then continue with the next best follow-up.
""".strip()


class CallBridge:
    """
    Manages one phone call's bidirectional audio bridge.

    Usage:
        bridge = CallBridge(call_sid="CA...", twilio_ws=websocket)
        await bridge.run()    # blocks until call ends
        await bridge.cleanup()
    """

    def __init__(self, call_sid: str, twilio_ws: "WebSocket") -> None:
        self.call_sid = call_sid
        self.twilio_ws = twilio_ws
        self.openai_ws: websockets.WebSocketClientProtocol | None = None
        self.caller_phone: str = "unknown"
        self.stream_sid: str = ""
        self._running = True

    async def run(self) -> None:
        """Open OpenAI Realtime connection and run bidirectional audio bridge."""
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            logger.error("[bridge] OPENAI_API_KEY not set")
            return

        headers = {
            "Authorization": f"Bearer {api_key}",
            "OpenAI-Beta": "realtime=v1",
        }

        async with websockets.connect(
            OPENAI_REALTIME_URL, extra_headers=headers
        ) as oai_ws:
            self.openai_ws = oai_ws
            logger.info(f"[bridge] OpenAI Realtime connected for call {self.call_sid}")

            await self._configure_openai_session()

            # Run both directions concurrently; either can terminate the bridge
            await asyncio.gather(
                self._twilio_to_openai(),
                self._openai_to_twilio(),
                return_exceptions=True,
            )

    async def _configure_openai_session(self) -> None:
        """Send session.update to set voice, instructions, and audio formats."""
        config = {
            "type": "session.update",
            "session": {
                "turn_detection": {"type": "server_vad"},
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "voice": "shimmer",
                "instructions": PHONE_SYSTEM_PROMPT,
                "modalities": ["text", "audio"],
                "temperature": 0.8,
            },
        }
        await self.openai_ws.send(json.dumps(config))

    async def _twilio_to_openai(self) -> None:
        """
        Read JSON frames from the Twilio Media Stream WebSocket and forward
        audio to OpenAI Realtime.

        Twilio frame events:
          - connected : initial handshake (ignored)
          - start     : stream metadata; contains stream_sid and custom params
          - media     : base64-encoded mulaw 8 kHz audio chunk
          - stop      : stream ended (caller hung up)
        """
        while self._running:
            try:
                raw = await self.twilio_ws.receive_text()
                frame = json.loads(raw)
                event = frame.get("event")

                if event == "start":
                    self.stream_sid = frame["start"]["streamSid"]
                    params = frame["start"].get("customParameters", {})
                    self.caller_phone = params.get("caller_phone", "unknown")
                    logger.info(
                        f"[bridge] Stream started: stream_sid={self.stream_sid}, "
                        f"caller={self.caller_phone}"
                    )

                elif event == "media":
                    mulaw_b64: str = frame["media"]["payload"]
                    mulaw_bytes = base64.b64decode(mulaw_b64)
                    pcm16_bytes = _mulaw_to_pcm16_24k(mulaw_bytes)
                    pcm16_b64 = base64.b64encode(pcm16_bytes).decode()

                    await self.openai_ws.send(
                        json.dumps(
                            {
                                "type": "input_audio_buffer.append",
                                "audio": pcm16_b64,
                            }
                        )
                    )

                elif event == "stop":
                    logger.info(f"[bridge] Twilio stream stopped: {self.call_sid}")
                    self._running = False
                    break

            except Exception as exc:
                logger.error(
                    f"[bridge] twilio_to_openai error ({self.call_sid}): {exc}"
                )
                self._running = False
                break

    async def _openai_to_twilio(self) -> None:
        """
        Read events from OpenAI Realtime and forward audio back to Twilio.
        Only response.audio.delta events carry audio to send to the caller.
        """
        try:
            async for raw_message in self.openai_ws:
                if not self._running:
                    break
                try:
                    event = json.loads(raw_message)
                    event_type = event.get("type")

                    if event_type == "response.audio.delta":
                        pcm16_b64: str = event.get("delta", "")
                        if pcm16_b64 and self.stream_sid:
                            pcm16_bytes = base64.b64decode(pcm16_b64)
                            mulaw_bytes = _pcm16_24k_to_mulaw(pcm16_bytes)
                            mulaw_b64 = base64.b64encode(mulaw_bytes).decode()

                            await self.twilio_ws.send_text(
                                json.dumps(
                                    {
                                        "event": "media",
                                        "streamSid": self.stream_sid,
                                        "media": {"payload": mulaw_b64},
                                    }
                                )
                            )

                    elif event_type == "error":
                        logger.error(f"[bridge] OpenAI error: {event.get('error')}")

                    elif event_type in ("session.created", "session.updated"):
                        logger.info(f"[bridge] OpenAI session event: {event_type}")

                except Exception as exc:
                    logger.error(f"[bridge] openai_to_twilio inner error: {exc}")
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"[bridge] OpenAI WS closed for call {self.call_sid}")

    async def cleanup(self) -> None:
        """Close the OpenAI WebSocket connection gracefully."""
        self._running = False
        if self.openai_ws:
            try:
                await self.openai_ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Audio format conversion helpers
# ---------------------------------------------------------------------------


def _mulaw_to_pcm16_24k(mulaw_8k: bytes) -> bytes:
    """
    Convert 8 kHz mulaw (G.711) bytes to 24 kHz PCM16 bytes.

    Steps:
      1. audioop.ulaw2lin  — mulaw -> signed 16-bit linear at 8 kHz
      2. audioop.ratecv   — upsample 8000 -> 24000 Hz (3:1 ratio)
    """
    pcm_8k = audioop.ulaw2lin(mulaw_8k, 2)
    pcm_24k, _ = audioop.ratecv(pcm_8k, 2, 1, 8000, 24000, None)
    return pcm_24k


def _pcm16_24k_to_mulaw(pcm_24k: bytes) -> bytes:
    """
    Convert 24 kHz PCM16 bytes to 8 kHz mulaw (G.711) bytes.

    Steps:
      1. audioop.ratecv — downsample 24000 -> 8000 Hz (1:3 ratio)
      2. audioop.lin2ulaw — signed 16-bit linear -> mulaw
    """
    pcm_8k, _ = audioop.ratecv(pcm_24k, 2, 1, 24000, 8000, None)
    mulaw_8k = audioop.lin2ulaw(pcm_8k, 2)
    return mulaw_8k
