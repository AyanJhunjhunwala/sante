# Clinician Guide

## What Santé provides

Santé produces structured, exploratory voice-derived signal summaries to support triage and follow-up discussions.

It does **not** provide standalone diagnosis.

## Session structure

1. Guided conversation phase (short prompts)
2. Read-aloud phase (controlled phoneme capture)
3. Automated summary with quality grading and signal cards

## Signal categories shown in reports

- Mood/depression-like speech risk signal
- Aphasia-like language pattern flag
- Vocal age/gender proxy signal
- Slurred/intoxication likelihood signal
- Cognitive load/fatigue proxy signal
- Voice strain/respiratory effort signal

Each is quality-weighted and marked as exploratory.

## Acoustic markers used

- Pitch mean and variability
- Jitter and shimmer
- Harmonics-to-noise ratio
- Loudness profile
- Speaking rate and pause structure

## Safety escalation model

Safety checks combine:

- rules-based language signals
- optional semantic LLM triage

Urgent classifications can trigger clinician alert workflows when forwarding is enabled and configured.

## Quality interpretation

Reports include quality grades (A-D) from data coverage and signal reliability checks.

Lower-quality captures should be interpreted cautiously and may warrant repeat collection.

## Operational note

For integration and policy controls, see:

- `docs/integrations/TWILIO.md`
- `docs/SETUP.md`
