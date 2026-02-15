from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.session_summary import generate_session_report
from agents.phoneme_detector import analyze_phonemes
from services.acoustic_features import analyze_acoustics
from services.audio_convert import to_wav_bytes

SUPPORTED_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"}
MODES = ["baseline", "sick", "tired", "stressed", "drunk"]
FOUR_SIGNALS = [
    "intoxication_slur",
    "sick_tired_state",
    "stress_activation",
    "aphasia_pattern",
]
EXPECTED_DOMINANT = {
    "baseline": None,
    "sick": "sick_tired_state",
    "tired": "sick_tired_state",
    "stressed": "stress_activation",
    "drunk": "intoxication_slur",
}


def infer_mode(path: Path) -> str:
    stem = path.stem.lower().strip()
    for mode in MODES:
        if stem.startswith(mode):
            return mode
    return "unknown"


def ffprobe_duration_seconds(audio_bytes: bytes, suffix: str) -> float:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                tmp_path,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "ffprobe failed")

        value = float((result.stdout or "0").strip())
        return max(0.0, value)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def transcribe_audio(audio_bytes: bytes, api_key: str) -> str:
    wav_bytes = to_wav_bytes(audio_bytes)
    file_obj = io.BytesIO(wav_bytes)
    file_obj.name = "recording.wav"
    file_obj.content_type = "audio/wav"

    client = OpenAI(api_key=api_key)
    result = client.audio.transcriptions.create(
        model="gpt-4o-mini-transcribe",
        file=file_obj,
    )
    return (getattr(result, "text", "") or "").strip()


async def get_phonemes(audio_bytes: bytes, transcript: str) -> tuple[list[str], list[dict[str, Any]]]:
    result = await analyze_phonemes(audio_bytes, transcript)
    if "error" in result:
        raise RuntimeError(str(result["error"]))
    return result.get("decode_phonemes", []) or [], result.get("dys_detect", []) or []


def score_map(report: dict[str, Any]) -> dict[str, int]:
    estimates = report.get("estimates") or []
    by_key = {item.get("key"): int(item.get("score", 0)) for item in estimates}
    return {key: by_key.get(key, 0) for key in FOUR_SIGNALS}


def dominant_signal(scores: dict[str, int]) -> str:
    return max(scores.items(), key=lambda kv: kv[1])[0]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lightweight mode calibration using uploaded audio samples")
    parser.add_argument(
        "--audio-dir",
        type=Path,
        default=ROOT.parent / "frontend" / "public" / "audio-tests",
        help="Directory containing mode-labeled audio files",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT.parent / "frontend" / "public" / "audio-tests" / "calibration-summary.json",
        help="Output JSON summary path",
    )
    parser.add_argument(
        "--use-phonemes",
        action="store_true",
        help="Enable phoneme/dysfluency model calls (slower; requires RunPod setup)",
    )
    parser.add_argument(
        "--no-transcribe",
        action="store_true",
        help="Skip transcription (not recommended for parity testing)",
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv(ROOT / ".env")
    args = parse_args()

    audio_dir: Path = args.audio_dir
    if not audio_dir.exists():
        raise SystemExit(f"Audio directory not found: {audio_dir}")

    files = sorted([p for p in audio_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXT])
    if not files:
        raise SystemExit(f"No supported audio files found in {audio_dir}")

    api_key = os.getenv("OPENAI_API_KEY", "").strip().strip('"').strip("'")
    if not args.no_transcribe and not api_key:
        raise SystemExit("OPENAI_API_KEY missing. Set it to run transcription parity checks.")

    runs: list[dict[str, Any]] = []

    for path in files:
        mode = infer_mode(path)
        entry: dict[str, Any] = {
            "file": path.name,
            "mode": mode,
        }

        try:
            audio_bytes = path.read_bytes()
            duration_seconds = ffprobe_duration_seconds(audio_bytes, path.suffix)

            transcript = ""
            if not args.no_transcribe:
                transcript = transcribe_audio(audio_bytes, api_key)
                if not transcript:
                    raise RuntimeError("Transcription empty")

            phonemes: list[str] = []
            dys_detect: list[dict[str, Any]] = []
            if args.use_phonemes:
                phonemes, dys_detect = asyncio.run(get_phonemes(audio_bytes, transcript))

            acoustic = analyze_acoustics(audio_bytes)
            if "error" in acoustic:
                raise RuntimeError(str(acoustic["error"]))

            report = generate_session_report(
                segment="conversation",
                user_transcription=transcript,
                ai_transcription="",
                duration_seconds=duration_seconds,
                detected_phonemes=phonemes,
                detected_dys_detect=dys_detect,
                acoustic_features=acoustic,
            )

            scores = score_map(report)
            entry.update(
                {
                    "status": "ok",
                    "duration_seconds": round(duration_seconds, 2),
                    "transcript_chars": len(transcript),
                    "quality_score": report.get("quality", {}).get("score"),
                    "noise_likelihood": report.get("quality", {}).get("noise_likelihood"),
                    "scores": scores,
                    "dominant_signal": dominant_signal(scores),
                }
            )
        except Exception as exc:
            entry.update({"status": "error", "error": str(exc)})

        runs.append(entry)

    baseline = next((r for r in runs if r.get("status") == "ok" and r.get("mode") == "baseline"), None)
    baseline_scores = baseline.get("scores") if baseline else None

    assessments: list[dict[str, Any]] = []
    for run in runs:
        if run.get("status") != "ok":
            continue
        mode = run.get("mode")
        scores = run.get("scores", {})
        deltas = None
        if baseline_scores:
            deltas = {k: int(scores.get(k, 0)) - int(baseline_scores.get(k, 0)) for k in FOUR_SIGNALS}

        expected = EXPECTED_DOMINANT.get(mode)
        assessments.append(
            {
                "file": run.get("file"),
                "mode": mode,
                "dominant_signal": run.get("dominant_signal"),
                "expected_dominant": expected,
                "dominant_matches_expectation": (expected is None) or (run.get("dominant_signal") == expected),
                "deltas_vs_baseline": deltas,
            }
        )

    output = {
        "audio_dir": str(audio_dir),
        "use_phonemes": bool(args.use_phonemes),
        "transcription_enabled": not bool(args.no_transcribe),
        "runs": runs,
        "assessments": assessments,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2), encoding="utf-8")

    print("Calibration run complete")
    print(f"Samples: {len(runs)} | Output: {args.out}")
    for run in runs:
        if run.get("status") != "ok":
            print(f"- {run['file']}: ERROR - {run.get('error')}")
            continue
        scores = run.get("scores", {})
        print(
            f"- {run['file']}: mode={run.get('mode')} dom={run.get('dominant_signal')} "
            f"intox={scores.get('intoxication_slur')} aphasia={scores.get('aphasia_pattern')} "
            f"sick_tired={scores.get('sick_tired_state')} stressed={scores.get('stress_activation')}"
        )


if __name__ == "__main__":
    main()
