"""
Twilio MMS sender.
Sends the PDF report as a downloadable attachment to the patient after a call completes.
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def send_sms_report(
    *,
    to_phone: str,
    report_url: str,
    call_sid: str,
) -> dict[str, Any]:
    """
    Send the PDF report as an MMS attachment via Twilio.
    The patient receives it as a downloadable file in their messaging app.

    Never raises — always returns a result dict so callers can log outcomes.
    Returns: {"sid": str | None, "status": str, "error": str | None}
    """
    from twilio.rest import Client  # lazy import

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
    from_number = os.getenv("TWILIO_PHONE_NUMBER", "")

    if not all([account_sid, auth_token, from_number]):
        logger.error("[sms] Twilio credentials not configured")
        return {
            "sid": None,
            "status": "error",
            "error": "Twilio credentials not configured",
        }

    try:
        client = Client(account_sid, auth_token)
        message = client.messages.create(
            body="Your Sante voice health report is attached.",
            from_=from_number,
            to=to_phone,
            media_url=[report_url],  # Twilio fetches and attaches the PDF
        )
        logger.info(
            f"[mms] Sent to {to_phone}: sid={message.sid}, status={message.status}"
        )
        return {"sid": message.sid, "status": message.status, "error": None}
    except Exception as exc:
        logger.error(f"[mms] Failed to send MMS to {to_phone}: {exc}")
        return {"sid": None, "status": "error", "error": str(exc)}
