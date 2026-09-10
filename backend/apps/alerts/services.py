"""Alert emission + realtime fan-out (Phase 7).

Flow: pipeline/review code calls emit_event() -> deduped case-level Alert ->
per-user Notifications for matching rules -> WebSocket push to user groups.

Strictness: a user is only notified about cases they can see; for
cross_case events referencing other cases, only users who see ALL involved
cases are notified (hidden cases never leak through alerts).
"""
from __future__ import annotations

import logging
from datetime import timedelta

from asgiref.sync import async_to_sync
from django.utils import timezone

log = logging.getLogger(__name__)


def _layer():
    try:
        from channels.layers import get_channel_layer
        return get_channel_layer()
    except Exception:
        return None


def broadcast(user_id: int, payload: dict) -> None:
    layer = _layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(
            f"user_{user_id}", {"type": "alert.message", "data": payload})
    except Exception as exc:
        log.warning("alert broadcast failed for user %s: %s", user_id, exc)


def _payload(notification) -> dict:
    a = notification.alert
    return {
        "notification_id": notification.id,
        "alert_id": a.id,
        "kind": a.kind, "severity": a.severity, "message": a.message,
        "case_id": a.case_id, "refs": a.refs,
        "channel": notification.channel,
        "created_at": notification.created_at.isoformat(),
    }


def emit_event(kind: str, case, message: str, severity: str = "low",
               refs: dict | None = None, confidence: float = 0.0,
               dedupe_key: str = ""):
    """Create a deduped Alert + fan out Notifications. Returns Alert or None."""
    from .models import Alert, AlertRule, Notification

    from apps.cases.permissions import user_can_view_case

    refs = refs or {}
    if dedupe_key:
        since = timezone.now() - timedelta(hours=24)
        existing = (Alert.objects.filter(dedupe_key=dedupe_key, created_at__gte=since)
                    .order_by("-created_at").first())
        if existing is not None:
            return existing
    alert = Alert.objects.create(
        case=case, kind=kind, message=message[:512], severity=severity,
        refs=refs, dedupe_key=dedupe_key or "")
    others = {c.get("id") for c in (refs.get("other_cases") or []) if isinstance(c, dict)}

    rules = (AlertRule.objects.filter(enabled=True)
             .select_related("user", "case")
             .filter(models_Q(kind)))
    for rule in rules:
        user = rule.user
        if rule.case_id is not None and rule.case_id != (case.id if case else None):
            continue
        if not rule.matches(kind, severity, confidence):
            continue
        if case is not None and not user_can_view_case(user, case):
            continue
        if others and not _sees_all(user, others):
            continue
        note = Notification.objects.create(user=user, alert=alert, channel="inapp")
        broadcast(user.id, _payload(note))
    return alert


def models_Q(kind):
    from django.db.models import Q
    return (Q(kind="any") | Q(kind=kind))


def _sees_all(user, case_ids: set[int]) -> bool:
    """Strict cross-case rule: user must see every referenced case."""
    from apps.cases.models import Case as CaseModel
    from apps.cases.permissions import user_can_view_case
    for oid in case_ids:
        try:
            oc = CaseModel.objects.get(pk=oid)
        except CaseModel.DoesNotExist:
            continue
        if not user_can_view_case(user, oc):
            return False
    return True
