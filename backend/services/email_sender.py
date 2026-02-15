"""
Email sender — sends PDF report via Gmail.

Uses PowerShell to send email through Windows networking, which bypasses
the WSL2 TLS handshake issue that blocks Python's smtplib on SMTP ports.

Requires: GMAIL_ADDRESS, GMAIL_APP_PASSWORD, REPORT_RECIPIENT_EMAIL in .env.
"""

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def send_email_report(
    *,
    pdf_path: str,
    call_sid: str,
    caller_phone: str,
) -> dict[str, Any]:
    """
    Send the PDF report as an email attachment via Gmail (PowerShell relay).

    Uses REPORT_RECIPIENT_EMAIL as the destination.
    Requires GMAIL_ADDRESS and GMAIL_APP_PASSWORD in .env.

    Never raises — always returns a result dict so callers can log outcomes.
    Returns: {"status": "sent" | "error", "error": str | None}
    """
    gmail_address = os.getenv("GMAIL_ADDRESS", "")
    gmail_app_password = os.getenv("GMAIL_APP_PASSWORD", "")
    recipient = os.getenv("REPORT_RECIPIENT_EMAIL", "")

    if not all([gmail_address, gmail_app_password, recipient]):
        logger.error("[email] Gmail credentials or recipient not configured")
        return {
            "status": "error",
            "error": "GMAIL_ADDRESS, GMAIL_APP_PASSWORD, or REPORT_RECIPIENT_EMAIL not set in .env",
        }

    pdf_file = Path(pdf_path)
    if not pdf_file.exists():
        logger.error(f"[email] PDF not found: {pdf_path}")
        return {"status": "error", "error": f"PDF not found: {pdf_path}"}

    # Convert WSL path to Windows path for PowerShell
    try:
        win_path = subprocess.run(
            ["wslpath", "-w", str(pdf_file.resolve())],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except Exception:
        win_path = ""

    if not win_path:
        logger.error(f"[email] Could not convert path to Windows format: {pdf_path}")
        return {"status": "error", "error": "wslpath conversion failed"}

    # Escape single quotes in variables for PowerShell
    ps_script = f"""
try {{
    $smtp = New-Object System.Net.Mail.SmtpClient('smtp.gmail.com', 587)
    $smtp.EnableSsl = $true
    $smtp.Credentials = New-Object System.Net.NetworkCredential('{gmail_address}', '{gmail_app_password}')
    $msg = New-Object System.Net.Mail.MailMessage
    $msg.From = '{gmail_address}'
    $msg.To.Add('{recipient}')
    $msg.Subject = 'Sante Voice Health Report - {call_sid[:12]}'
    $msg.Body = "Hi,`n`nYour Sante voice health assessment is complete.`nPlease find your report attached.`n`nCaller: {caller_phone}`nCall ID: {call_sid}`n`n-- Sante"
    $attachment = New-Object System.Net.Mail.Attachment('{win_path}')
    $msg.Attachments.Add($attachment)
    $smtp.Send($msg)
    $attachment.Dispose()
    $msg.Dispose()
    Write-Output 'EMAIL_SENT_OK'
}} catch {{
    Write-Output "ERROR: $_"
}}
"""

    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", ps_script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = result.stdout.strip()

        if "EMAIL_SENT_OK" in output:
            logger.info(f"[email] Report sent to {recipient} for call {call_sid}")
            return {"status": "sent", "error": None}

        error_msg = output or result.stderr.strip() or "Unknown PowerShell error"
        logger.error(f"[email] PowerShell send failed for {call_sid}: {error_msg}")
        return {"status": "error", "error": error_msg}

    except subprocess.TimeoutExpired:
        logger.error(f"[email] PowerShell timed out for {call_sid}")
        return {"status": "error", "error": "Email send timed out (30s)"}
    except Exception as exc:
        logger.error(f"[email] Failed to send report for {call_sid}: {exc}")
        return {"status": "error", "error": str(exc)}
