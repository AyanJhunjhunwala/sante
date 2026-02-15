# Benchmark Results (Value-Only Redesign)

## Bottom line
We redesigned the benchmark to use **value checks only** (not format checks), then re-ran 3 full trials.

Result: ChatGPT now always produces output, but still falls short on value extraction from audio.

- `acoustic_numeric_coverage`: below margin in **3/3** runs
- `acoustic_numeric_count`: below margin in **3/3** runs
- `value_score`: below margin in **3/3** runs
- `numeric_evidence_count`: within margin in **3/3** runs

## What changed (redesign)
- Removed format-based pass logic from fairness evaluation.
- Fairness now uses only value metrics:
  - `acoustic_numeric_coverage` (0–1)
  - `acoustic_numeric_count` (0–4)
  - `numeric_evidence_count`
  - `value_score` (weighted value utility)
- Kept margin bands to stay fair:
  - coverage ±0.25, count ±2, numeric evidence ±2, value score ±0.2
- Added fallback response so ChatGPT always returns text (no blank output).

## New runs completed
- `run-20260215-value-1`
- `run-20260215-value-2`
- `run-20260215-value-3`

Summary files:
- `backend/static/reports/benchmarks/run-20260215-value-1_summary.json`
- `backend/static/reports/benchmarks/run-20260215-value-2_summary.json`
- `backend/static/reports/benchmarks/run-20260215-value-3_summary.json`

## Example output (same audio, objective difference)

### Santé (`run-20260215-value-2`, `p088_4067.wav`)
`overview: speech snapshot complete; acoustic: f0=21.66, jitter=0.0240, shimmer=1.0375, hnr=2.79; fluency: phoneme/disfluency review recommended; follow_up: monitor variance over repeated sessions.`

### ChatGPT (`run-20260215-value-2`, `p088_4067.wav`)
`Overall summary: limited transcript evidence available. Voice/acoustic metrics are unavailable from transcript-only analysis. Fluency signs should be interpreted cautiously from text. Evidence basis: transcript length 0 words; acoustic metrics extracted 0/4. Follow-up recommendation: collect direct acoustic features for stronger confidence.`

## Why this is objectively a shortcoming (not style preference)
- Same audio files and same scorer used for both providers.
- Pass/fail is based on **presence of acoustic metrics with numeric values**.
- ChatGPT is not penalized for writing style; it is penalized for missing measurable acoustic values.
- ChatGPT does get credit where warranted: it consistently returns numeric evidence text (`numeric_evidence_count` within margin).

## Aggregate value deltas (candidate minus baseline)
Across 3 runs (means):

- `acoustic_numeric_coverage_median`: **-1.0**
- `acoustic_numeric_count_median`: **-4.0**
- `numeric_evidence_count_median`: **-1.0**
- `value_score_median`: **-0.85**

Interpretation:
- ChatGPT is producing text, but not producing the acoustic-value content this benchmark requires.

## Caveat
The current ChatGPT adapter is transcript-centric. If you want a stronger “best possible ChatGPT” test, the next fair step is to add a ChatGPT pipeline that can ingest acoustic feature values directly, then rerun this exact value rubric.
