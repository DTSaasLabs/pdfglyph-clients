"""Webhook signature verification."""

import hashlib
import hmac


def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
    """Verify a PDFGlyph webhook signature.

    Args:
        payload: The raw request body as a string.
        signature: The X-PDFGlyph-Signature header value.
        secret: Your webhook endpoint secret (whsec_...).

    Returns:
        True if the signature is valid.
    """
    expected = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
