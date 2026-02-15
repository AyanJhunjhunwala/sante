# openSMILE Integration

## Purpose

openSMILE provides local CPU acoustic feature extraction used in session reports.

## Implementation

File: `backend/services/acoustic_features.py`

- Feature set: `eGeMAPSv02`
- Feature level: functionals
- Input: uploaded or converted WAV
- Output: numeric biomarker dictionary

## Extracted feature set

- `f0_mean`
- `f0_std`
- `jitter`
- `shimmer_db`
- `hnr`
- `loudness_mean`
- `loudness_std`
- `speaking_rate`
- `voiced_segments_per_sec`
- `mean_pause_length`
- `mean_voiced_length`

These metrics feed summary quality scoring and exploratory signal estimates.

## Runtime dependencies

- Python `opensmile` package
- ffmpeg for format normalization where needed

## Related docs

- [RUNPOD.md](RUNPOD.md)
- [../ARCHITECTURE.md](../ARCHITECTURE.md)
