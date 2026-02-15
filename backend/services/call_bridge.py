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
import base64
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

try:
    import audioop
except ImportError:  # Python 3.13+
    import audioop_lts as audioop

import websockets
import websockets.exceptions

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)

OPENAI_REALTIME_URL = (
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
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

    def __init__(
        self,
        call_sid: str,
        twilio_ws: "WebSocket",
        audio_paths: "dict[str, str] | None" = None,
    ) -> None:
        self.call_sid = call_sid
        self.twilio_ws = twilio_ws
        self.openai_ws: websockets.WebSocketClientProtocol | None = None
        self.caller_phone: str = "unknown"
        self.stream_sid: str = ""
        self._running = True
        self._mulaw_chunks: list[bytes] = []  # accumulate caller audio
        self.audio_path: str | None = None  # set when call ends
        self._audio_paths = audio_paths  # shared dict — written immediately on stop

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
            OPENAI_REALTIME_URL, additional_headers=headers
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
        # response.create is sent after session.updated is confirmed — see _openai_to_twilio

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
                    self._mulaw_chunks.append(mulaw_bytes)  # save for analysis
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
                    self.audio_path = _save_mulaw_as_wav(
                        self._mulaw_chunks, self.call_sid
                    )
                    # Write to shared dict immediately so the status callback
                    # can find it even if it arrives before bridge.run() returns.
                    if self.audio_path and self._audio_paths is not None:
                        self._audio_paths[self.call_sid] = self.audio_path
                        logger.info(
                            f"[bridge] Audio path registered: {self.audio_path}"
                        )
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

        Audio arriving before the Twilio stream_sid is known is buffered and
        flushed once stream_sid is set (by the Twilio 'start' frame).
        """
        pending_mulaw: list[bytes] = []

        try:
            async for raw_message in self.openai_ws:
                if not self._running:
                    break
                try:
                    event = json.loads(raw_message)
                    event_type = event.get("type")

                    if event_type == "response.audio.delta":
                        pcm16_b64: str = event.get("delta", "")
                        if not pcm16_b64:
                            continue
                        pcm16_bytes = base64.b64decode(pcm16_b64)
                        mulaw_bytes = _pcm16_24k_to_mulaw(pcm16_bytes)

                        if not self.stream_sid:
                            # stream_sid not yet received — buffer for later
                            if len(pending_mulaw) == 0:
                                logger.info(
                                    "[bridge] Buffering audio — stream_sid not yet set"
                                )
                            pending_mulaw.append(mulaw_bytes)
                            continue

                        if pending_mulaw:
                            logger.info(
                                f"[bridge] Flushing {len(pending_mulaw)} buffered audio chunks to Twilio"
                            )
                        # Flush any buffered chunks first
                        for buffered in pending_mulaw:
                            await self.twilio_ws.send_text(
                                json.dumps(
                                    {
                                        "event": "media",
                                        "streamSid": self.stream_sid,
                                        "media": {
                                            "payload": base64.b64encode(
                                                buffered
                                            ).decode()
                                        },
                                    }
                                )
                            )
                        pending_mulaw.clear()

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

                    elif event_type == "response.audio.done":
                        logger.info("[bridge] response.audio.done received")
                        # Flush any remaining buffered audio once stream_sid is known
                        if pending_mulaw and self.stream_sid:
                            logger.info(
                                f"[bridge] Flushing {len(pending_mulaw)} buffered chunks on audio.done"
                            )
                            for buffered in pending_mulaw:
                                await self.twilio_ws.send_text(
                                    json.dumps(
                                        {
                                            "event": "media",
                                            "streamSid": self.stream_sid,
                                            "media": {
                                                "payload": base64.b64encode(
                                                    buffered
                                                ).decode()
                                            },
                                        }
                                    )
                                )
                            pending_mulaw.clear()
                        elif pending_mulaw:
                            logger.warning(
                                f"[bridge] {len(pending_mulaw)} buffered chunks dropped — "
                                f"stream_sid not set at audio.done"
                            )

                    elif event_type == "error":
                        logger.error(f"[bridge] OpenAI error: {event.get('error')}")

                    elif event_type == "response.done":
                        resp = event.get("response", {})
                        status = resp.get("status")
                        usage = resp.get("usage", {})
                        output = resp.get("output", [])
                        logger.info(
                            f"[bridge] response.done: status={status}, "
                            f"output_items={len(output)}, usage={usage}"
                        )
                        if status == "failed":
                            logger.error(
                                f"[bridge] response failed: {resp.get('status_details')}"
                            )

                    elif event_type == "session.updated":
                        logger.info(
                            "[bridge] OpenAI session.updated — triggering greeting"
                        )
                        await self.openai_ws.send(
                            json.dumps(
                                {
                                    "type": "response.create",
                                    "response": {
                                        "modalities": ["text", "audio"],
                                        "instructions": "Greet the user with: Hi, this is Santé. How are you feeling today?",
                                    },
                                }
                            )
                        )

                    elif event_type == "session.created":
                        logger.info("[bridge] OpenAI session.created")

                    else:
                        logger.info(f"[bridge] OpenAI event (unhandled): {event_type}")

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


def _save_mulaw_as_wav(chunks: list[bytes], call_sid: str) -> str | None:
    """
    Concatenate mulaw chunks, convert to 16kHz mono WAV via ffmpeg,
    and save to a temp file. Returns the file path or None on failure.
    The caller is responsible for deleting the file after analysis.
    """
    if not chunks:
        logger.warning(f"[bridge] No audio chunks to save for {call_sid}")
        return None

    try:
        import subprocess

        raw_mulaw = b"".join(chunks)

        # Write raw mulaw to temp file
        with tempfile.NamedTemporaryFile(suffix=".ul", delete=False) as f_in:
            f_in.write(raw_mulaw)
            tmp_in = f_in.name

        tmp_out = tmp_in.replace(".ul", ".wav")

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "mulaw",  # input format: raw G.711 mulaw
                "-ar",
                "8000",  # input sample rate
                "-ac",
                "1",  # mono
                "-i",
                tmp_in,
                "-ar",
                "16000",  # output: 16kHz (matches analysis services)
                "-ac",
                "1",
                "-sample_fmt",
                "s16",
                tmp_out,
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )

        Path(tmp_in).unlink(missing_ok=True)
        logger.info(
            f"[bridge] Saved caller audio: {tmp_out} ({len(raw_mulaw)} mulaw bytes)"
        )
        return tmp_out

    except Exception as exc:
        logger.error(f"[bridge] Failed to save audio for {call_sid}: {exc}")
        return None


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
