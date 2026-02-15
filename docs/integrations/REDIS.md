# Redis + rq Integration

## Purpose

Redis and rq are used for asynchronous post-call processing in the Twilio workflow.

Web browser sessions do not require Redis to produce immediate in-app summaries.

## Queue service

File: `backend/services/redis_queue.py`

- Builds Redis connection from backend queue configuration
- Exposes queue accessor
- Enqueues `workers.call_analysis_job.process_call` to queue `calls`

## Worker service

File: `backend/workers/call_analysis_job.py`

Pipeline:

1. Analyze call audio (acoustic + phoneme paths)
2. Generate summary report and export PDF
3. Send report to caller via SMS/MMS
4. Optionally evaluate and execute clinician forwarding
5. Cleanup temporary audio file

## Run worker locally

```powershell
cd backend
uv run rq worker calls --path .
```

## Configuration

Redis connection settings are configured in backend environment files.

## Related docs

- [TWILIO.md](TWILIO.md)
- [RUNPOD.md](RUNPOD.md)
