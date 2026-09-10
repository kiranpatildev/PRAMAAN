from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    SHO = "sho", "SHO / Supervisor"
    INVESTIGATOR = "investigator", "Investigator"
    ADMIN = "admin", "Admin"


class User(AbstractUser):
    """Custom user with a coarse role. Fine-grained case permissions live on CaseAssignment."""

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.INVESTIGATOR)
    phone = models.CharField(max_length=32, blank=True, default="")
    # Phase 8: optional TOTP 2FA. Secret is set at setup, enabled after verify.
    totp_secret = models.CharField(max_length=64, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)

    def is_sho(self) -> bool:
        return self.role in (Role.SHO, Role.ADMIN) or self.is_superuser
