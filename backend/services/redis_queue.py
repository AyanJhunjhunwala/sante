"""
Redis queue setup using rq.
All job enqueueing for phone call analysis goes through this module.
"""

import os
from typing import Any

import redis
from rq import Queue
from rq.job import Job


def _get_redis_connection() -> redis.Redis:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.from_url(redis_url)


def get_queue(name: str = "default") -> Queue:
    """Return an rq Queue connected to Redis."""
    conn = _get_redis_connection()
    return Queue(name, connection=conn)


def enqueue_call_analysis(
    *,
    call_sid: str,
    caller_phone: str,
    call_status: str,
    duration_seconds: int,
) -> Job:
    """
    Enqueue a call analysis job on the 'calls' queue.
    The rq worker runs workers.call_analysis_job.process_call.
    Returns the rq Job (job.id is useful for logging).
    """
    q = get_queue("calls")
    job = q.enqueue(
        "workers.call_analysis_job.process_call",
        kwargs={
            "call_sid": call_sid,
            "caller_phone": caller_phone,
            "call_status": call_status,
            "duration_seconds": duration_seconds,
        },
        job_timeout=120,
        result_ttl=3600,
    )
    return job
