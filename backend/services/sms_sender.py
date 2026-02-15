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


def send_clinician_alert(
    *,
    to_phone: str,
    report_url: str,
    report_id: str,
    signal_score: float,
    urgency: str,
    safety_category: str,
    safety_confidence: float,
    source: str,
    call_sid: str = "",
) -> dict[str, Any]:
    """
    Send a concise clinician-facing alert with report link.

    Never raises — always returns a result dict.
    """
    from twilio.rest import Client  # lazy import

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
    from_number = os.getenv("TWILIO_PHONE_NUMBER", "")

    if not all([account_sid, auth_token, from_number]):
        logger.error("[alert] Twilio credentials not configured")
        return {
            "sid": None,
            "status": "error",
            "error": "Twilio credentials not configured",
        }

    try:
        client = Client(account_sid, auth_token)
        if urgency == "urgent":
            body = (
                "Sante URGENT safety alert: possible harm-to-self/others language detected. "
                f"Category={safety_category or 'harm_to_self_or_others'}. "
                f"Confidence={safety_confidence:.2f}. "
                f"Report={report_id}. Source={source}. Details: {report_url}"
            )
        else:
            body = (
                "Sante alert: Elevated voice risk signal detected. "
                f"Score={signal_score:.1f}. "
                f"Report={report_id}. "
                f"Source={source}. "
                f"Details: {report_url}"
            )
        if call_sid:
            body = f"{body} (CallSID={call_sid})"

        message = client.messages.create(
            body=body,
            from_=from_number,
            to=to_phone,
        )
        logger.info(
            f"[alert] Sent clinician alert to {to_phone}: sid={message.sid}, status={message.status}"
        )
        return {"sid": message.sid, "status": message.status, "error": None}
    except Exception as exc:
        logger.error(f"[alert] Failed clinician alert to {to_phone}: {exc}")
        return {"sid": None, "status": "error", "error": str(exc)}
