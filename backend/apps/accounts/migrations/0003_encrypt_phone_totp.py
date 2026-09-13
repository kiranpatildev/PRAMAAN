# Encrypt phone + totp_secret at rest (Fernet via FIELD_ENCRYPTION_KEY).
# max_length grows to fit tokens; existing plaintext rows read back as-is
# (decrypt-fail passthrough) and are re-encrypted on next save.

from django.db import migrations

import apps.security


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_user_totp_enabled"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="phone",
            field=apps.security.EncryptedCharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="user",
            name="totp_secret",
            field=apps.security.EncryptedCharField(blank=True, default="", max_length=255),
        ),
    ]
