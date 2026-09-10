"""Software-level AES-256 field encryption (Fernet). No hardware TEE per §5."""
from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet | None:
    key = os.environ.get("FIELD_ENCRYPTION_KEY", "")
    if not key:
        return None
    return Fernet(key.encode())


def encrypt_str(plaintext: str) -> str:
    f = _fernet()
    if f is None or not plaintext:
        return plaintext
    return f.encrypt(plaintext.encode()).decode()


def decrypt_str(token: str) -> str:
    f = _fernet()
    if f is None or not token:
        return token
    try:
        return f.decrypt(token.encode()).decode()
    except InvalidToken:
        return token
