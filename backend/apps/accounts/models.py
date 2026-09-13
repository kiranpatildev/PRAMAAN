from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.security import EncryptedCharField


class Role(models.TextChoices):
    SHO = "sho", "SHO / Supervisor"
    INVESTIGATOR = "investigator", "Investigator"
    ADMIN = "admin", "Admin"


class User(AbstractUser):
    """Custom user with a coarse role. Fine-grained case permissions live on CaseAssignment."""

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.INVESTIGATOR)
    # PII at rest: Fernet-encrypted (max_length sized for tokens; never filter on this).
    phone = EncryptedCharField(max_length=255, blank=True, default="")
    # Phase 8: optional TOTP 2FA (dormant — no enrollment UI). Secret is set at
    # setup, enabled after verify. Encrypted at rest; never filter on this.
    totp_secret = EncryptedCharField(max_length=255, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)

    def is_sho(self) -> bool:
        return self.role in (Role.SHO, Role.ADMIN) or self.is_superuser
