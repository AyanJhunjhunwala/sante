"""
Twilio SMS/MMS sender.
Sends the PDF report link to the patient after a call completes.

Always sends a plain SMS first (guaranteed delivery), then attempts MMS
with the PDF attachment as a bonus. This ensures the patient always receives
a notification even if Twilio can't fetch the media_url (e.g. ngrok tunnel
down, free-tier interstitial page, URL unreachable).
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
    Send the PDF report to the patient via Twilio.

    Strategy:
      1. Always send a plain SMS with the report link (reliable delivery).
      2. Also attempt MMS with the PDF as attachment (best-effort).
         MMS can fail silently if Twilio can't fetch the media_url.

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

    client = Client(account_sid, auth_token)

    # --- Step 1: Plain SMS (always — guaranteed delivery) ---
    sms_result: dict[str, Any] = {"sid": None, "status": "error", "error": None}
    try:
        message = client.messages.create(
            body=(
                "Hi! Your Sante voice health assessment is complete. "
                f"View your report here: {report_url}"
            ),
            from_=from_number,
            to=to_phone,
        )
        logger.info(
            f"[sms] Sent to {to_phone}: sid={message.sid}, status={message.status}"
        )
        sms_result = {"sid": message.sid, "status": message.status, "error": None}
    except Exception as sms_exc:
        logger.error(f"[sms] Plain SMS failed to {to_phone}: {sms_exc}")
        sms_result = {"sid": None, "status": "error", "error": str(sms_exc)}

    # --- Step 2: MMS with PDF attachment (best-effort) ---
    try:
        mms_message = client.messages.create(
            body="Your Sante voice health report is attached.",
            from_=from_number,
            to=to_phone,
            media_url=[report_url],
        )
        logger.info(
            f"[mms] Sent to {to_phone}: sid={mms_message.sid}, status={mms_message.status}"
        )
    except Exception as mms_exc:
        logger.warning(f"[mms] MMS failed to {to_phone} (non-fatal): {mms_exc}")

    return sms_result
