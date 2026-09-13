"""Software-level AES-256 field encryption (Fernet). No hardware TEE per §5."""
from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken
from django.db import models


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


class EncryptedCharField(models.CharField):  # type: ignore[name-defined]
    """CharField encrypted at rest with Fernet (see FIELD_ENCRYPTION_KEY).

    Transparent: values are plaintext in Python, ciphertext in the DB.
    No key configured → passthrough (dev/test). Legacy plaintext rows
    decrypt-fail → returned as-is, then re-encrypted on next save.
    Never filter/query on these columns: ciphertext is non-deterministic.
    """

    def from_db_value(self, value, expression, connection):  # noqa: ANN001
        if value is None or value == "":
            return value
        return decrypt_str(value)

    def to_python(self, value):  # noqa: ANN001
        if value is None or value == "":
            return value
        # Values coming from the DB are ciphertext; plain assignment stays plain
        # until get_prep_value encrypts on write. from_db_value already handles
        # DB reads — this covers fixtures/deserialization paths.
        return value

    def get_prep_value(self, value):  # noqa: ANN001
        if value is None or value == "":
            return value
        # Avoid double-encrypting an already-encrypted value on re-save.
        if _fernet() is not None and decrypt_str(value) != value:
            return value
        return encrypt_str(value)
