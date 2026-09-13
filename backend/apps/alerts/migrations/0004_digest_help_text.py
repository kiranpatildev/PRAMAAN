# email_digest sender removed (digest command cut); flag kept dormant on rules.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("alerts", "0003_notification_alerts_noti_user_id_4b0072_idx"),
    ]

    operations = [
        migrations.AlterField(
            model_name="alertrule",
            name="email_digest",
            field=models.BooleanField(
                default=False, help_text="Reserved: email digest is disabled (no sender)."
            ),
        ),
    ]
