"""
Action-forwarding policy and execution helpers.

This module decides whether a session report should be forwarded to a clinician
and executes the outbound alert when eligible.
"""

import os
from typing import Any

from services.sms_sender import send_clinician_alert

_GRADE_ORDER = {"A": 4, "B": 3, "C": 2, "D": 1}


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_phone(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit() or ch == "+")


def _allowlisted(recipient: str) -> bool:
    allowlist = os.getenv("ACTION_FORWARD_ALLOWLIST", "")
    if not allowlist.strip():
        return False
    normalized = _normalize_phone(recipient)
    allowed = {_normalize_phone(item.strip()) for item in allowlist.split(",") if item.strip()}
    return normalized in allowed


def _quality_meets_minimum(report: dict[str, Any], min_grade: str) -> bool:
    quality = report.get("quality") or {}
    grade = str(quality.get("grade") or "D").upper()
    return _GRADE_ORDER.get(grade, 1) >= _GRADE_ORDER.get(min_grade.upper(), 2)


def _max_signal_score(report: dict[str, Any]) -> float:
    estimates = report.get("estimates") or []
    if not isinstance(estimates, list) or not estimates:
        return 0.0
    scores: list[float] = []
    for item in estimates:
        if not isinstance(item, dict):
            continue
        try:
            scores.append(float(item.get("score", 0.0)))
        except (TypeError, ValueError):
            continue
    return max(scores) if scores else 0.0


def evaluate_forwarding(
    *,
    report: dict[str, Any],
    forward_opt_in: bool,
    forward_recipient: str,
) -> dict[str, Any]:
    if not _env_bool("ACTION_FORWARD_ENABLED", default=False):
        return {"status": "disabled", "reason": "feature_disabled"}

    if not forward_opt_in:
        return {"status": "not_forwarded", "reason": "opt_in_required"}

    recipient = (forward_recipient or "").strip()
    if not recipient:
        return {"status": "not_forwarded", "reason": "recipient_missing"}

    if not _allowlisted(recipient):
        return {"status": "not_forwarded", "reason": "recipient_not_allowlisted"}

    threshold = float(os.getenv("ACTION_FORWARD_THRESHOLD", "70"))
    min_grade = os.getenv("ACTION_FORWARD_MIN_QUALITY_GRADE", "C").upper()

    max_signal = _max_signal_score(report)
    if max_signal < threshold:
        return {
            "status": "not_forwarded",
            "reason": "below_threshold",
            "max_signal_score": max_signal,
            "threshold": threshold,
        }

    if not _quality_meets_minimum(report, min_grade=min_grade):
        return {
            "status": "not_forwarded",
            "reason": "quality_gate_failed",
            "min_grade": min_grade,
        }

    return {
        "status": "eligible",
        "reason": "threshold_met",
        "max_signal_score": max_signal,
        "threshold": threshold,
    }


def execute_forwarding(
    *,
    report: dict[str, Any],
    report_url: str,
    forward_opt_in: bool,
    forward_recipient: str,
    source: str,
    call_sid: str = "",
) -> dict[str, Any]:
    decision = evaluate_forwarding(
        report=report,
        forward_opt_in=forward_opt_in,
        forward_recipient=forward_recipient,
    )
    if decision.get("status") != "eligible":
        return decision

    send_result = send_clinician_alert(
        to_phone=forward_recipient,
        report_url=report_url,
        report_id=str(report.get("report_id", "")),
        signal_score=float(decision.get("max_signal_score", 0.0)),
        source=source,
        call_sid=call_sid,
    )

    return {
        "status": "forwarded" if send_result.get("status") != "error" else "error",
        "reason": "sent" if send_result.get("status") != "error" else "send_failed",
        "recipient": forward_recipient,
        "source": source,
        "signal_score": decision.get("max_signal_score", 0.0),
        "send": send_result,
    }
