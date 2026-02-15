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

## Action-forwarding MVP (clinician alerts)

To enable autonomous forwarding when a high-risk session is detected, set these env vars in `backend/.env`:

- `ACTION_FORWARD_ENABLED=true`
- `ACTION_FORWARD_THRESHOLD=70`
- `ACTION_FORWARD_MIN_QUALITY_GRADE=C`
- `ACTION_FORWARD_ALLOWLIST=+15551234567,+15557654321`

Twilio call-flow defaults:

- `ACTION_FORWARD_TWILIO_OPT_IN=true`
- `ACTION_FORWARD_DEFAULT_RECIPIENT=+15551234567`

Frontend/web-flow opt-in (optional):

- `NEXT_PUBLIC_ACTION_FORWARD_OPT_IN=true`
- `NEXT_PUBLIC_ACTION_FORWARD_RECIPIENT=+15551234567`

Safety semantic agent (end-session transcript reasoning):

- `SAFETY_AGENT_ENABLED=true`
- `SAFETY_URGENT_CONFIDENCE_THRESHOLD=0.65`
- `SAFETY_KEYWORDS_HARD_STOP=suicide,kill myself,end my life,hurt myself`

Behavior summary:

- Forwarding only runs when enabled and opted in.
- Recipient must be present in `ACTION_FORWARD_ALLOWLIST`.
- Session forwards only if signal threshold and quality gate pass.
- Urgent safety signals (self-harm/violence language) bypass normal score threshold and escalate immediately to clinician alerting.