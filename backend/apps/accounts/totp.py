"""TOTP two-factor auth (Phase 8): stdlib-only (no new dependency).

Secrets are base32, 30s steps, SHA-1, 6 digits (RFC 6238). Verification
accepts ±1 step of clock skew. `provisioning_uri` fits authenticator apps
that accept manual key entry (otpauth:// URL is also returned).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time

STEP = 30
DIGITS = 6
WINDOW = 1


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode()


def provisioning_uri(username: str, secret: str, issuer: str = "PRAMAAN") -> str:
    return (f"otpauth://totp/{issuer}:{username}?secret={secret}"
            f"&issuer={issuer}&algorithm=SHA1&digits={DIGITS}&period={STEP}")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret.upper())
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    num = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(num % (10 ** DIGITS)).zfill(DIGITS)


def verify(secret: str, code: str, at: float | None = None) -> bool:
    """Constant-time-ish compare within ±WINDOW steps. Never raises."""
    code = (code or "").strip().replace(" ", "")
    if not (secret and code.isdigit() and len(code) == DIGITS):
        return False
    now = int((at if at is not None else time.time()) // STEP)
    for delta in range(-WINDOW, WINDOW + 1):
        if hmac.compare_digest(_code(secret, now + delta), code):
            return True
    return False
