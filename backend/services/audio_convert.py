"""
Audio format conversion — webm/opus → wav (16kHz mono PCM).
Uses ffmpeg subprocess directly (no pydub dependency issues with Python 3.13).
"""

import subprocess
import tempfile
import os


def to_wav_bytes(audio_bytes: bytes) -> bytes:
    """
    Convert any ffmpeg-supported audio (webm, opus, ogg, mp3, etc.) to
    16kHz mono 16-bit WAV bytes. If the input is already valid WAV,
    it still normalises to 16kHz mono.
    """
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f_in:
        f_in.write(audio_bytes)
        tmp_in = f_in.name

    tmp_out = tmp_in.replace(".webm", ".wav")

    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_in,
                "-ar", "16000",
                "-ac", "1",
                "-sample_fmt", "s16",
                tmp_out,
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )

        with open(tmp_out, "rb") as f_out:
            return f_out.read()
    finally:
        for p in (tmp_in, tmp_out):
            try:
                os.unlink(p)
            except OSError:
                pass
