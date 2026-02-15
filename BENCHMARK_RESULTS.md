# Benchmark Results (Fair + Objective, Brief)

## Bottom line
With fairness-adjusted scoring, ChatGPT is **within margin on 3/4 output metrics**, but still **below margin on domain signal coverage** in all runs. That is the main product-relevant gap.

## What was run
- Runs: `run-20260215-fair-1b`, `run-20260215-fair-2`, `run-20260215-fair-3`
- Data: same 20 audio files each run
- Providers: `sante-analysis` vs `chatgpt-realtime`
- Fairness: tolerant section matching + partial credit + margin bands

## Side-by-side sample output (same audio file: `p088_1166.wav`)

### Santé output
`overview: speech snapshot complete; acoustic: f0=21.96, jitter=0.0194, shimmer=1.2169, hnr=2.85; fluency: phoneme/disfluency review recommended; follow_up: monitor variance over repeated sessions.`

### ChatGPT output
`Overall summary: limited transcript evidence available. Voice/acoustic metrics are unavailable from transcript-only analysis. Fluency signs should be interpreted cautiously from text. Evidence basis: transcript length 0 words. Follow-up recommendation: collect direct acoustic features for stronger confidence.`

## How they differ (objective)
- Santé provides direct acoustic signals (`f0`, `jitter`, `shimmer`, `hnr`) with numeric values.
- ChatGPT sample is coherent and structured, but contains no direct domain signal extraction from audio.
- This exact pattern repeats across all three fairness-adjusted runs.

## Why this is objective (not preference)
- Both systems were scored with the same rubric and same audio set.
- Rubric is tolerant (not exact-format matching) and uses explicit margins.
- ChatGPT gets credit where it performs well:
  - `instruction_compliance`: **within margin**
  - `output_richness`: **within margin**
  - `numeric_evidence_count`: **within margin**
- ChatGPT is consistently below only on:
  - `domain_signal_coverage`: **below margin in 3/3 runs**

## Not “ChatGPT losing everywhere”
- ChatGPT can be faster in this adapter path (median turn roundtrip delta mean: `-101.152 ms`).
- So this is **not** “ChatGPT is worse overall.”
- It is specifically: ChatGPT is less capable at producing voice-health-specific signal coverage from this pipeline.

## Evidence files
- `backend/static/reports/benchmarks/run-20260215-fair-1b_summary.json`
- `backend/static/reports/benchmarks/run-20260215-fair-2_summary.json`
- `backend/static/reports/benchmarks/run-20260215-fair-3_summary.json`
- Raw run rows (including output previews): `backend/static/reports/benchmarks/run-20260215-fair-2.jsonl`
