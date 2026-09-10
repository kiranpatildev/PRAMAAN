"""Mocked digest emails (Phase 7 explicitly allows mocking for demo).

For every user with email_digest rules: roll the last 24h of in-app
notifications into one email_mock Notification (the "sent email") and print
it. A real SMTP backend replaces _send() without touching callers.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.alerts.models import AlertRule, Notification


def _send(to_user, subject, body) -> None:
    print(f"[mock-email to={to_user} subject={subject!r}]\n{body}\n")


class Command(BaseCommand):
    help = "Compose mocked 24h digest emails for opted-in users."

    def handle(self, *args, **opts):
        since = timezone.now() - timedelta(hours=24)
        user_ids = (AlertRule.objects.filter(enabled=True, email_digest=True)
                    .values_list("user_id", flat=True).distinct())
        sent = 0
        for uid in user_ids:
            from apps.accounts.models import User
            try:
                user = User.objects.get(pk=uid)
            except User.DoesNotExist:
                continue
            notes = (Notification.objects.filter(user=user, channel="inapp", created_at__gte=since)
                     .select_related("alert").order_by("-created_at")[:50])
            if not notes:
                continue
            lines = [f"- [{n.alert.severity}] {n.alert.kind}: {n.alert.message}" for n in notes]
            body = f"PRAMAAN daily digest ({len(notes)} alert(s), last 24h):\n" + "\n".join(lines)
            first = notes[0]
            Notification.objects.create(user=user, alert=first.alert, channel="email_mock")
            _send(user.username, f"PRAMAAN digest: {len(notes)} alerts", body)
            sent += 1
        self.stdout.write(self.style.SUCCESS(f"Mock digests composed for {sent} user(s)."))
