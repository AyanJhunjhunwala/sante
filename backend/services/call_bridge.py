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

# Mirror the web app constants exactly.
# Greeting counts as response #1, so 4 prompts = 5 total AI responses in conversation phase.
CONVERSATION_PROMPT_COUNT = 4  # matches frontend/lib/constants.ts
READ_ALOUD_PROMPT_COUNT = 3  # matches frontend/lib/constants.ts

# Identical to tokens.py PROMPT_CONVERSATION_PHASE — phone greeting differs only in opener.
PHONE_CONVERSATION_PROMPT = """
You are Santé, a live voice conversation agent. English only.
This is the CONVERSATION phase.

Core behavior:
- Behave like a real discussion partner, not a script reader.
- Respond to what the user just said, then ask ONE natural follow-up question.
- Keep language supportive, neutral, and non-diagnostic.
- Never claim medical certainty. Do not provide diagnosis or treatment.

CRITICAL output rules:
- NEVER start your response with "Conversation:", "Read Aloud:", or any label/prefix.
- NEVER include a "Read Aloud" or "Repeat Back" section.
- Just speak naturally without any labels or formatting.
- Give exactly ONE response per user turn. Do NOT say multiple things.
- After you ask your question, STOP and WAIT for the user to answer.

Length constraints:
- Max 15 words per response.
- One sentence only.

Flow guidance:
- Start with: "Hi, this is Santé. How are you feeling today?"
- Ask one question at a time, adapting based on the user's prior answer.
- Topics: how they're feeling, their day, recent activities, sleep, energy, mood.
- Use brief acknowledgments, then continue with the next best follow-up.
""".strip()

# Identical to tokens.py PROMPT_READ_ALOUD_PHASE.
PHONE_READ_ALOUD_PROMPT = """
You are Santé, a live voice conversation agent. English only.
This is the READ ALOUD phase.

Core behavior:
- Provide exactly ONE short sentence for the user to repeat back to you.
- The sentence should be clear, natural English for speech signal capture.
- After the user repeats it, give a brief one-word acknowledgment ("Good", "Great", "Nice") then the next sentence.
- Do NOT have a conversation. Do NOT ask personal questions.

CRITICAL output rules:
- NEVER start your response with "Read Aloud:", "Conversation:", or any label/prefix.
- Just say the sentence directly without any labels or formatting.
- Give exactly ONE sentence per turn. Do NOT give multiple sentences.
- Output only the repeat sentence; do NOT add a second sentence, follow-up, or extra prompt.
- Do NOT give the next repeat sentence until the user has spoken.
- After giving a sentence, STOP and WAIT for the user to repeat it.

Length constraints:
- Each sentence: 5-10 words.
- Vary sentence structure and phoneme coverage.

Flow guidance:
- Start with: "Thanks—now repeat after me: The sun is shining today."
- Use everyday sentences that cover diverse sounds and phonemes.
- Keep a calm, supportive tone.
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
        # Phase tracking — mirrors the web app two-phase flow
        self._phase: str = "conversation"  # "conversation" | "read_aloud"
        self._conversation_ai_count: int = (
            0  # AI responses in conversation (greeting = 1)
        )
        self._read_aloud_user_count: int = 0  # user turns completed in read aloud
        self._phase_transitioning: bool = False  # guard against double-transition
        self._goodbye_sent: bool = (
            False  # True after explicit goodbye response.create fired
        )
        self._user_spoke: bool = (
            False  # True when user item created since last AI response
        )
        # Transcript accumulators
        self._ai_transcript_parts: list[str] = []
        self._user_transcript_parts: list[str] = []
        self._current_ai_turn: list[str] = []  # buffer for current AI turn deltas

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

    async def _configure_openai_session(self, instructions: str | None = None) -> None:
        """Send session.update to set voice, instructions, and audio formats."""
        config = {
            "type": "session.update",
            "session": {
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.85,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 1500,
                    "create_response": True,
                },
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {"model": "whisper-1", "language": "en"},
                "voice": "shimmer",
                "instructions": instructions or PHONE_CONVERSATION_PROMPT,
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
                    if self._audio_paths is not None:
                        if self.audio_path:
                            self._audio_paths[self.call_sid] = self.audio_path
                            logger.info(
                                f"[bridge] Audio path registered: {self.audio_path}"
                            )
                        # Also register transcripts so the status callback can pass them
                        self._audio_paths[f"{self.call_sid}:ai_transcript"] = " ".join(
                            self._ai_transcript_parts
                        )
                        self._audio_paths[f"{self.call_sid}:user_transcript"] = (
                            " ".join(self._user_transcript_parts)
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

                    elif event_type == "response.audio_transcript.delta":
                        self._current_ai_turn.append(event.get("delta", ""))

                    elif event_type == "response.audio_transcript.done":
                        turn_text = "".join(self._current_ai_turn).strip()
                        if turn_text:
                            self._ai_transcript_parts.append(turn_text)
                            logger.info(f"[bridge] AI turn: {turn_text[:80]}")
                        self._current_ai_turn.clear()

                    elif event_type == "conversation.item.created":
                        item = event.get("item", {})
                        if item.get("role") == "user":
                            # Mark that the user actually spoke — used to gate conversation
                            # prompt counting so echo/noise doesn't auto-advance the phase.
                            self._user_spoke = True
                            # In read aloud phase, count each user turn as a completed repeat.
                            # NOTE: input_audio transcript is null here — it arrives via
                            # conversation.item.input_audio_transcription.completed later.
                            if self._phase == "read_aloud":
                                self._read_aloud_user_count += 1
                                logger.info(
                                    f"[bridge] Read aloud: {self._read_aloud_user_count}/{READ_ALOUD_PROMPT_COUNT} user repeats"
                                )
                                if (
                                    self._read_aloud_user_count
                                    >= READ_ALOUD_PROMPT_COUNT
                                ):
                                    # User has done all repeats. Cancel the VAD-triggered
                                    # auto-response immediately so the AI doesn't say a
                                    # 4th sentence. The response.done (cancelled) will
                                    # trigger the goodbye sequence.
                                    logger.info(
                                        "[bridge] Read aloud complete — cancelling auto-response, will send goodbye"
                                    )
                                    self._phase = "ending"
                                    await self.openai_ws.send(
                                        json.dumps({"type": "response.cancel"})
                                    )

                    elif (
                        event_type
                        == "conversation.item.input_audio_transcription.completed"
                    ):
                        # User speech transcript arrives asynchronously after item creation.
                        transcript = event.get("transcript", "").strip()
                        if transcript:
                            self._user_transcript_parts.append(transcript)
                            logger.info(f"[bridge] User turn: {transcript[:80]}")

                    elif event_type == "error":
                        logger.error(f"[bridge] OpenAI error: {event.get('error')}")

                    elif event_type == "response.done":
                        resp = event.get("response", {})
                        status = resp.get("status")
                        usage = resp.get("usage", {})
                        output = resp.get("output", [])
                        logger.info(
                            f"[bridge] response.done: phase={self._phase}, status={status}, "
                            f"output_items={len(output)}, usage={usage}"
                        )
                        if status == "failed":
                            logger.error(
                                f"[bridge] response failed: {resp.get('status_details')}"
                            )
                        elif (
                            status in ("completed", "cancelled")
                            and self._phase == "ending"
                            and not self._goodbye_sent
                        ):
                            # Handle both completed (AI said acknowledgment naturally)
                            # and cancelled (we cancelled the auto-response on 3rd repeat)
                            # to trigger the goodbye sequence.
                            logger.info(
                                "[bridge] Saving audio+transcripts before goodbye"
                            )
                            self.audio_path = _save_mulaw_as_wav(
                                self._mulaw_chunks, self.call_sid
                            )
                            if self._audio_paths is not None:
                                if self.audio_path:
                                    self._audio_paths[self.call_sid] = self.audio_path
                                    logger.info(
                                        f"[bridge] Audio path registered early: {self.audio_path}"
                                    )
                                self._audio_paths[f"{self.call_sid}:ai_transcript"] = (
                                    " ".join(self._ai_transcript_parts)
                                )
                                self._audio_paths[
                                    f"{self.call_sid}:user_transcript"
                                ] = " ".join(self._user_transcript_parts)
                            self._goodbye_sent = True
                            logger.info("[bridge] Disabling VAD and sending goodbye")
                            await self.openai_ws.send(
                                json.dumps({"type": "input_audio_buffer.clear"})
                            )
                            await self.openai_ws.send(
                                json.dumps(
                                    {
                                        "type": "session.update",
                                        "session": {
                                            "turn_detection": None,
                                            "instructions": (
                                                "Say exactly and only: "
                                                "'Thank you for completing the assessment. Goodbye!' "
                                                "Do not say anything else."
                                            ),
                                        },
                                    }
                                )
                            )
                            await self.openai_ws.send(
                                json.dumps(
                                    {
                                        "type": "response.create",
                                        "response": {
                                            "modalities": ["text", "audio"],
                                        },
                                    }
                                )
                            )
                        elif status == "completed":
                            if self._phase == "conversation":
                                is_greeting = self._conversation_ai_count == 0
                                if is_greeting or self._user_spoke:
                                    # Only count this AI response if the user actually spoke
                                    # first (or it's the initial greeting). This prevents
                                    # VAD echo / background noise from auto-advancing the phase.
                                    self._conversation_ai_count += 1
                                    self._user_spoke = False
                                    # Greeting = count 1; real prompts start at count 2.
                                    prompts_asked = max(
                                        0, self._conversation_ai_count - 1
                                    )
                                    logger.info(
                                        f"[bridge] Conversation: {prompts_asked}/{CONVERSATION_PROMPT_COUNT} prompts asked"
                                    )
                                    if (
                                        prompts_asked >= CONVERSATION_PROMPT_COUNT
                                        and not self._phase_transitioning
                                    ):
                                        self._phase_transitioning = True
                                        await self._transition_to_read_aloud()
                                else:
                                    logger.info(
                                        "[bridge] AI response without user input — ignoring (echo/noise suppression)"
                                    )
                            elif self._phase == "ending" and self._goodbye_sent:
                                # Goodbye audio has finished playing — hang up now.
                                logger.info(
                                    f"[bridge] Goodbye complete — hanging up {self.call_sid}"
                                )
                                await _hangup_call(self.call_sid)
                                self._running = False
                                break

                    elif event_type == "session.updated":
                        if (
                            self._phase == "conversation"
                            and self._conversation_ai_count == 0
                        ):
                            # Initial session setup — fire greeting
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
                        elif self._phase == "read_aloud" and self._phase_transitioning:
                            # Read aloud session.update confirmed — fire first sentence
                            logger.info(
                                "[bridge] Read aloud session.updated — triggering first sentence"
                            )
                            self._phase_transitioning = False
                            await self.openai_ws.send(
                                json.dumps({"type": "response.create"})
                            )

                    elif event_type == "session.created":
                        logger.info("[bridge] OpenAI session.created")

                    else:
                        logger.info(f"[bridge] OpenAI event (unhandled): {event_type}")

                except Exception as exc:
                    logger.error(f"[bridge] openai_to_twilio inner error: {exc}")
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"[bridge] OpenAI WS closed for call {self.call_sid}")

    async def _transition_to_read_aloud(self) -> None:
        """
        Mirror the web app's phase transition:
        1. Send session.update with read-aloud instructions (VAD create_response=False
           so the AI waits to be explicitly triggered, not auto-respond to the user).
        2. session.updated fires → we send response.create to kick off the first sentence.
        """
        logger.info("[bridge] Transitioning to read aloud phase")
        # Cancel any in-progress response before switching instructions (mirrors web app)
        await self.openai_ws.send(json.dumps({"type": "response.cancel"}))
        self._phase = "read_aloud"
        await self.openai_ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "instructions": PHONE_READ_ALOUD_PROMPT,
                        "input_audio_transcription": {"model": "whisper-1", "language": "en"},
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.85,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 1500,
                            "create_response": True,
                        },
                    },
                }
            )
        )
        # response.create is fired in the session.updated handler once confirmed.

    async def cleanup(self) -> None:
        """Close the OpenAI WebSocket connection gracefully."""
        self._running = False
        if self.openai_ws:
            try:
                await self.openai_ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Twilio REST helper
# ---------------------------------------------------------------------------


async def _hangup_call(call_sid: str) -> None:
    """Use the Twilio REST API to end an active call programmatically."""
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
    if not account_sid or not auth_token:
        logger.warning(
            "[bridge] TWILIO_ACCOUNT_SID/AUTH_TOKEN not set — cannot hang up"
        )
        return
    try:
        from twilio.rest import Client as TwilioClient

        # Run the blocking Twilio SDK call in a thread pool so we don't block the event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: TwilioClient(account_sid, auth_token)
            .calls(call_sid)
            .update(status="completed"),
        )
        logger.info(f"[bridge] Twilio call {call_sid} ended via REST API")
    except Exception as exc:
        logger.error(f"[bridge] Failed to hang up {call_sid}: {exc}")


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
