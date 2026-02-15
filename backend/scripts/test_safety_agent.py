#!/usr/bin/env python
"""
Smoke-test for the safety-signal pipeline (rules + LLM agent).

Usage (from backend/):
    python scripts/test_safety_agent.py          # runs all 4 cases
    python scripts/test_safety_agent.py --rules   # rules-only (skip LLM)

Each case prints the merged result and a PASS/FAIL based on expected urgency.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Ensure backend package root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.session_summary import (
    _analyze_safety_signal,
    _analyze_safety_signal_rules,
    _analyze_safety_signal_with_llm,
    _merge_safety_signals,
)

# ── Test cases ────────────────────────────────────────────────────────────────

CASES: list[dict] = [
    {
        "label": "1 · Explicit self-harm intent",
        "transcript": (
            "I feel so hopeless. I have been thinking about ways to kill myself. "
            "Nothing helps anymore and I just want to end my life."
        ),
        "expected_urgency": "urgent",
        "expected_min_confidence": 0.45,
    },
    {
        "label": "2 · Negated / denied intent",
        "transcript": (
            "My therapist asked if I ever think about suicide and I said no, "
            "I am not suicidal. I would never hurt myself."
        ),
        "expected_urgency": "routine",
        "expected_max_confidence": 0.80,
    },
    {
        "label": "3 · Historical / past-tense mention",
        "transcript": (
            "When I was younger I went through a very dark time where I thought "
            "about self-harm, but I have been in a much better place for years now."
        ),
        "expected_urgency": "routine",
        "expected_max_confidence": 0.80,
    },
    {
        "label": "4 · Ambiguous / metaphorical phrasing",
        "transcript": (
            "This job is killing me. I feel like I am dying inside every day I "
            "walk into that office. I just want it to end."
        ),
        "expected_urgency": "routine",
        "expected_max_confidence": 0.80,
    },
]


def _pp(obj: dict) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def run_case(case: dict, *, skip_llm: bool = False) -> bool:
    label = case["label"]
    transcript = case["transcript"]
    expected_urgency = case["expected_urgency"]

    print(f"\n{'=' * 72}")
    print(f"  {label}")
    print(f"{'=' * 72}")
    print(f"  Transcript: {transcript[:120]}{'…' if len(transcript) > 120 else ''}")

    # ── Rules layer ───────────────────────────────────────────────────────
    rules = _analyze_safety_signal_rules(text=transcript)
    print(f"\n  [rules] category={rules['category']}  urgency={rules['urgency']}  "
          f"confidence={rules['confidence']}")

    # ── LLM layer ─────────────────────────────────────────────────────────
    llm = None
    if not skip_llm:
        llm = _analyze_safety_signal_with_llm(text=transcript)
        if llm is None:
            print("  [llm]   (skipped / unavailable)")
        else:
            print(f"  [llm]   category={llm['category']}  urgency={llm['urgency']}  "
                  f"confidence={llm['confidence']}  negated={llm.get('is_negated_or_quoted')}")
    else:
        print("  [llm]   (disabled via --rules flag)")

    # ── Merged ────────────────────────────────────────────────────────────
    merged = _merge_safety_signals(rules_signal=rules, llm_signal=llm)
    print(f"\n  [merged] {_pp(merged)}")

    # ── Assertions ────────────────────────────────────────────────────────
    passed = True
    actual_urgency = merged.get("urgency", "routine")
    if actual_urgency != expected_urgency:
        print(f"\n  ** FAIL ** expected urgency={expected_urgency}, got {actual_urgency}")
        passed = False

    if "expected_min_confidence" in case and merged["confidence"] < case["expected_min_confidence"]:
        print(f"  ** FAIL ** expected confidence >= {case['expected_min_confidence']}, "
              f"got {merged['confidence']}")
        passed = False

    if "expected_max_confidence" in case and merged["confidence"] > case["expected_max_confidence"]:
        print(f"  ** WARN ** confidence higher than expected ceiling "
              f"({merged['confidence']} > {case['expected_max_confidence']})")
        # Not a hard fail — LLM may still be correct but confident

    if passed:
        print("\n  PASS")
    return passed


def main() -> None:
    skip_llm = "--rules" in sys.argv

    print("Santé Safety-Signal Smoke Test")
    print(f"  SAFETY_AGENT_ENABLED     = {os.getenv('SAFETY_AGENT_ENABLED', '(unset)')}")
    print(f"  SAFETY_LLM_AGENT_ENABLED = {os.getenv('SAFETY_LLM_AGENT_ENABLED', '(unset)')}")
    _key = os.getenv("OPENAI_API_KEY", "").strip().strip('"')
    print(f"  OPENAI_API_KEY           = {'set' if _key else 'NOT SET'}")
    if skip_llm:
        print("  Mode: rules-only (--rules)")
    else:
        print("  Mode: rules + LLM")

    results = [run_case(c, skip_llm=skip_llm) for c in CASES]

    print(f"\n{'=' * 72}")
    passed = sum(results)
    total = len(results)
    print(f"  Results: {passed}/{total} passed")
    if passed < total:
        print("  Some cases did not match expected outcomes. Review output above.")
        sys.exit(1)
    else:
        print("  All cases passed.")


if __name__ == "__main__":
    main()
