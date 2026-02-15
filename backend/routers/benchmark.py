"""
Benchmark router — lightweight metrics ingestion + comparison summaries.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services.benchmarking import append_run, summarize_runs

router = APIRouter(prefix="/api/benchmark", tags=["benchmark"])


class BenchmarkRunRequest(BaseModel):
    benchmark_id: str = "default"
    provider: str
    run_id: str | None = None
    audio_id: str | None = None

    first_token_ms: float | None = None
    first_audio_ms: float | None = None
    turn_roundtrip_ms: float | None = None
    session_total_ms: float | None = None

    turn_count: int | None = None
    turn_failure_count: int | None = None
    timeout_count: int | None = None
    interruption_count: int | None = None
    interruption_recovery_count: int | None = None

    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None

    disfluency_ratio: float | None = None
    disfluency_count: int | None = None
    phoneme_coverage: float | None = None
    speech_rate_wpm: float | None = None
    quality_grade: str | None = None
    noise_likelihood: float | None = None

    instruction_compliance: float | None = None
    output_richness: float | None = None
    domain_signal_coverage: float | None = None
    numeric_evidence_count: int | None = None
    output_word_count: int | None = None

    metadata: dict[str, Any] = Field(default_factory=dict)


class BenchmarkSummaryRequest(BaseModel):
    benchmark_id: str = "default"
    baseline_provider: str | None = None
    candidate_provider: str | None = None


@router.post("/runs")
async def api_benchmark_run(payload: BenchmarkRunRequest) -> JSONResponse:
    if not payload.provider.strip():
        raise HTTPException(status_code=400, detail="provider is required")
    saved = append_run(payload.model_dump())
    return JSONResponse({"ok": True, **saved})


@router.post("/summary")
async def api_benchmark_summary(payload: BenchmarkSummaryRequest) -> JSONResponse:
    summary = summarize_runs(
        benchmark_id=payload.benchmark_id,
        baseline_provider=payload.baseline_provider,
        candidate_provider=payload.candidate_provider,
    )
    return JSONResponse(summary)
