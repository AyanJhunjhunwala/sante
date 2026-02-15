"""
Lightweight benchmark storage + aggregation helpers.

Design goals:
- No DB migrations (JSONL files under static/reports/benchmarks)
- Provider-agnostic run schema
- Fast, reproducible aggregate metrics for A/B comparisons
"""

from __future__ import annotations

import json
import math
import statistics
import time
from collections import Counter
from pathlib import Path
from typing import Any

BENCHMARK_DIR = Path("static/reports/benchmarks")


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, bool):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * pct
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return ordered[low]
    low_weight = high - rank
    high_weight = rank - low
    return ordered[low] * low_weight + ordered[high] * high_weight


def _round(value: float | None, digits: int = 3) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def _metric_stats(runs: list[dict[str, Any]], key: str) -> dict[str, float | None]:
    values = [_as_float(run.get(key)) for run in runs]
    vals = [v for v in values if v is not None]
    if not vals:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "p90": None,
            "p95": None,
        }
    return {
        "count": len(vals),
        "mean": _round(statistics.fmean(vals)),
        "median": _round(_percentile(vals, 0.5)),
        "p90": _round(_percentile(vals, 0.9)),
        "p95": _round(_percentile(vals, 0.95)),
    }


def _sum_metric(runs: list[dict[str, Any]], key: str) -> float:
    total = 0.0
    for run in runs:
        value = _as_float(run.get(key))
        if value is not None:
            total += value
    return total


def _provider_summary(provider: str, runs: list[dict[str, Any]]) -> dict[str, Any]:
    total_turns = _sum_metric(runs, "turn_count")
    total_failures = _sum_metric(runs, "turn_failure_count")
    total_timeouts = _sum_metric(runs, "timeout_count")
    total_interruptions = _sum_metric(runs, "interruption_count")
    total_recovered = _sum_metric(runs, "interruption_recovery_count")
    total_cost = _sum_metric(runs, "cost_usd")
    total_input_tokens = _sum_metric(runs, "input_tokens")
    total_output_tokens = _sum_metric(runs, "output_tokens")
    total_session_minutes = _sum_metric(runs, "session_total_ms") / 60000.0

    quality_grades = Counter(
        str(run.get("quality_grade")) for run in runs if run.get("quality_grade")
    )

    return {
        "provider": provider,
        "run_count": len(runs),
        "latency_ms": {
            "first_token": _metric_stats(runs, "first_token_ms"),
            "first_audio": _metric_stats(runs, "first_audio_ms"),
            "turn_roundtrip": _metric_stats(runs, "turn_roundtrip_ms"),
            "session_total": _metric_stats(runs, "session_total_ms"),
        },
        "cost": {
            "total_usd": _round(total_cost),
            "usd_per_session": _round(total_cost / len(runs)) if runs else None,
            "usd_per_minute": (
                _round(total_cost / total_session_minutes)
                if total_session_minutes > 0
                else None
            ),
            "input_tokens_total": int(total_input_tokens),
            "output_tokens_total": int(total_output_tokens),
            "tokens_total": int(total_input_tokens + total_output_tokens),
        },
        "reliability": {
            "turn_failure_rate": (
                _round(total_failures / total_turns, 4) if total_turns > 0 else None
            ),
            "timeout_rate": (
                _round(total_timeouts / total_turns, 4) if total_turns > 0 else None
            ),
            "interruption_recovery_rate": (
                _round(total_recovered / total_interruptions, 4)
                if total_interruptions > 0
                else None
            ),
            "turn_count_total": int(total_turns),
            "turn_failures_total": int(total_failures),
            "timeouts_total": int(total_timeouts),
        },
        "quality": {
            "disfluency_ratio": _metric_stats(runs, "disfluency_ratio"),
            "disfluency_count": _metric_stats(runs, "disfluency_count"),
            "phoneme_coverage": _metric_stats(runs, "phoneme_coverage"),
            "speech_rate_wpm": _metric_stats(runs, "speech_rate_wpm"),
            "noise_likelihood": _metric_stats(runs, "noise_likelihood"),
            "quality_grade_distribution": dict(quality_grades),
        },
        "output": {
            "instruction_compliance": _metric_stats(runs, "instruction_compliance"),
            "output_richness": _metric_stats(runs, "output_richness"),
            "domain_signal_coverage": _metric_stats(runs, "domain_signal_coverage"),
            "numeric_evidence_count": _metric_stats(runs, "numeric_evidence_count"),
            "output_word_count": _metric_stats(runs, "output_word_count"),
            "acoustic_numeric_coverage": _metric_stats(runs, "acoustic_numeric_coverage"),
            "acoustic_numeric_count": _metric_stats(runs, "acoustic_numeric_count"),
            "value_score": _metric_stats(runs, "value_score"),
        },
    }


def _safe_delta(lhs: float | None, rhs: float | None) -> float | None:
    if lhs is None or rhs is None:
        return None
    return _round(lhs - rhs)


def _comparison(
    summaries_by_provider: dict[str, dict[str, Any]],
    baseline_provider: str,
    candidate_provider: str,
) -> dict[str, Any] | None:
    baseline = summaries_by_provider.get(baseline_provider)
    candidate = summaries_by_provider.get(candidate_provider)
    if baseline is None or candidate is None:
        return None

    def _median(summary: dict[str, Any], section: str, metric: str) -> float | None:
        return summary.get(section, {}).get(metric, {}).get("median")

    return {
        "baseline_provider": baseline_provider,
        "candidate_provider": candidate_provider,
        "delta": {
            "turn_roundtrip_ms_median": _safe_delta(
                _median(candidate, "latency_ms", "turn_roundtrip"),
                _median(baseline, "latency_ms", "turn_roundtrip"),
            ),
            "first_audio_ms_median": _safe_delta(
                _median(candidate, "latency_ms", "first_audio"),
                _median(baseline, "latency_ms", "first_audio"),
            ),
            "session_total_ms_median": _safe_delta(
                _median(candidate, "latency_ms", "session_total"),
                _median(baseline, "latency_ms", "session_total"),
            ),
            "usd_per_session": _safe_delta(
                candidate.get("cost", {}).get("usd_per_session"),
                baseline.get("cost", {}).get("usd_per_session"),
            ),
            "turn_failure_rate": _safe_delta(
                candidate.get("reliability", {}).get("turn_failure_rate"),
                baseline.get("reliability", {}).get("turn_failure_rate"),
            ),
            "disfluency_ratio_median": _safe_delta(
                _median(candidate, "quality", "disfluency_ratio"),
                _median(baseline, "quality", "disfluency_ratio"),
            ),
            "phoneme_coverage_median": _safe_delta(
                _median(candidate, "quality", "phoneme_coverage"),
                _median(baseline, "quality", "phoneme_coverage"),
            ),
            "speech_rate_wpm_median": _safe_delta(
                _median(candidate, "quality", "speech_rate_wpm"),
                _median(baseline, "quality", "speech_rate_wpm"),
            ),
            "instruction_compliance_median": _safe_delta(
                _median(candidate, "output", "instruction_compliance"),
                _median(baseline, "output", "instruction_compliance"),
            ),
            "output_richness_median": _safe_delta(
                _median(candidate, "output", "output_richness"),
                _median(baseline, "output", "output_richness"),
            ),
            "domain_signal_coverage_median": _safe_delta(
                _median(candidate, "output", "domain_signal_coverage"),
                _median(baseline, "output", "domain_signal_coverage"),
            ),
            "numeric_evidence_count_median": _safe_delta(
                _median(candidate, "output", "numeric_evidence_count"),
                _median(baseline, "output", "numeric_evidence_count"),
            ),
            "acoustic_numeric_coverage_median": _safe_delta(
                _median(candidate, "output", "acoustic_numeric_coverage"),
                _median(baseline, "output", "acoustic_numeric_coverage"),
            ),
            "acoustic_numeric_count_median": _safe_delta(
                _median(candidate, "output", "acoustic_numeric_count"),
                _median(baseline, "output", "acoustic_numeric_count"),
            ),
            "value_score_median": _safe_delta(
                _median(candidate, "output", "value_score"),
                _median(baseline, "output", "value_score"),
            ),
        },
    }


def _benchmark_file(benchmark_id: str) -> Path:
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    safe_id = benchmark_id.replace("/", "_").replace("\\", "_").strip()
    if not safe_id:
        safe_id = "default"
    return BENCHMARK_DIR / f"{safe_id}.jsonl"


def append_run(run_payload: dict[str, Any]) -> dict[str, Any]:
    """
    Persist one benchmark run as JSONL and return persisted metadata.
    """
    benchmark_id = str(run_payload.get("benchmark_id") or "default")
    provider = str(run_payload.get("provider") or "unknown")
    run_id = str(run_payload.get("run_id") or "") or f"run_{int(time.time() * 1000)}"

    record = {
        "benchmark_id": benchmark_id,
        "provider": provider,
        "run_id": run_id,
        "audio_id": run_payload.get("audio_id"),
        "created_at": int(time.time()),
        **run_payload,
    }

    path = _benchmark_file(benchmark_id)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    return {
        "benchmark_id": benchmark_id,
        "provider": provider,
        "run_id": run_id,
        "path": str(path),
    }


def load_runs(benchmark_id: str) -> list[dict[str, Any]]:
    path = _benchmark_file(benchmark_id)
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def summarize_runs(
    benchmark_id: str,
    baseline_provider: str | None = None,
    candidate_provider: str | None = None,
) -> dict[str, Any]:
    runs = load_runs(benchmark_id)
    by_provider: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        provider = str(run.get("provider") or "unknown")
        by_provider.setdefault(provider, []).append(run)

    summaries = {
        provider: _provider_summary(provider, provider_runs)
        for provider, provider_runs in by_provider.items()
    }

    provider_names = sorted(summaries.keys())
    baseline = baseline_provider
    candidate = candidate_provider

    if baseline is None and len(provider_names) >= 1:
        baseline = provider_names[0]
    if candidate is None and len(provider_names) >= 2:
        candidate = provider_names[1]

    comparison = (
        _comparison(summaries, baseline, candidate)
        if baseline is not None and candidate is not None
        else None
    )

    return {
        "benchmark_id": benchmark_id,
        "total_runs": len(runs),
        "providers": summaries,
        "comparison": comparison,
    }
