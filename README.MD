TREEHACKSSS BAYBE

## Benchmark replay (offline)

This benchmark is intentionally light-weight and **comparison-oriented**:
- not for exact apples-to-apples performance claims,
- meant to show output capability differences (e.g., domain signal coverage and evidence richness).

Run from `backend/` with your virtualenv active:

```bash
python scripts/benchmark_replay.py --audio-dir <path_to_audio_folder> --benchmark-id feb15-run
```

Fastest path (no args, uses built-in sample audio and auto benchmark id):

```bash
python scripts/benchmark_replay.py
```

Default providers are now:
- `sante-analysis` (local acoustic signal-based output)
- `chatgpt-realtime` (prompted transcript-based baseline)

Key limitation metrics in summary JSON:
- `instruction_compliance`
- `output_richness`
- `domain_signal_coverage`
- `numeric_evidence_count`

Windows one-command wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_benchmark_easy.ps1
```

Optional flags:
- `--providers sante-mock chatgpt-realtime`
- `--max-files 20`
- `--shuffle`
- `--timeout 45`

Outputs:
- Raw runs JSONL: `backend/static/reports/benchmarks/<benchmark_id>.jsonl`
- Aggregate summary: `backend/static/reports/benchmarks/<benchmark_id>_summary.json`