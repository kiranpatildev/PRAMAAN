"""Phase 7 alert tests: rules, deduped emission, strict delivery, WS channel."""
import json
from unittest import mock

from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment

from .models import Alert, AlertRule, Notification
from .services import emit_event

INMEM = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


class RuleMatchTests(TestCase):
    def test_matching(self):
        r = AlertRule(kind="risk", min_severity="medium", min_confidence=0.5)
        self.assertTrue(r.matches("risk", "high", 0.9))
        self.assertFalse(r.matches("risk", "low", 0.9))
        self.assertFalse(r.matches("risk", "high", 0.4))
        self.assertFalse(r.matches("anomaly", "high", 0.9))
        r.kind = "any"
        self.assertTrue(r.matches("anomaly", "high", 0.9))
        r.enabled = False
        self.assertFalse(r.matches("anomaly", "high", 0.9))


@override_settings(CHANNEL_LAYERS=INMEM, CELERY_TASK_ALWAYS_EAGER=True)
class EmitTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho10", Role.SHO)
        self.inv = _mkuser("inv10", Role.INVESTIGATOR)
        self.outsider = _mkuser("out10", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P7-1", title="p7", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        AlertRule.objects.create(user=self.inv, kind="any", min_severity="low")
        AlertRule.objects.create(user=self.outsider, kind="any", min_severity="low")

    def test_dedupe_and_fanout(self):
        with mock.patch("apps.alerts.services.broadcast") as bc:
            a1 = emit_event("risk", self.case, "R crossed", "high", {}, 0.9, dedupe_key="k1")
            a2 = emit_event("risk", self.case, "R crossed", "high", {}, 0.9, dedupe_key="k1")
        self.assertEqual(a1.id, a2.id)
        self.assertEqual(Alert.objects.filter(dedupe_key="k1").count(), 1)
        # inv notified (sees case); outsider not (cannot see case)
        self.assertTrue(Notification.objects.filter(user=self.inv, alert=a1).exists())
        self.assertFalse(Notification.objects.filter(user=self.outsider).exists())
        self.assertEqual(bc.call_count, 1)

    def test_cross_case_strict(self):
        other = Case.objects.create(fir_no="FIR-P7-2", title="p7b", owner=self.sho)
        refs = {"other_cases": [{"id": other.id, "fir_no": other.fir_no}]}
        emit_event("cross_case", self.case, "shared!", "medium", refs, 0.8, dedupe_key="k2")
        # inv sees case 1 but NOT case 2 -> no notification (strict)
        self.assertFalse(Notification.objects.filter(user=self.inv).exists())

    def test_review_confirm_emits_connection(self):
        from apps.graph_api.models import ExtractedEntity, ExtractedRelation
        c = self._client(self.inv)
        a = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="A",
                                           normalized="a", confidence=0.7)
        b = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="B",
                                           normalized="b", confidence=0.7)
        rel = ExtractedRelation.objects.create(case=self.case, src=a, dst=b,
                                               edge_type="CALLED", confidence=0.65, snippet="s")
        with mock.patch("apps.alerts.services.broadcast"):
            r = c.post(f"/api/entities/review/relations/{rel.id}/", {"decision": "confirm"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Alert.objects.filter(kind="connection", refs__relation_id=rel.id).exists())

    def test_feed_scoping_and_rules_crud(self):
        c, out_c = self._client(self.inv), self._client(self.outsider)
        emit_event("system", self.case, "hello-feed", "low", {}, 0, dedupe_key="k3")
        feed = c.get("/api/alerts/").data["results"]
        self.assertTrue(any(a["message"] == "hello-feed" for a in feed))
        out_feed = out_c.get("/api/alerts/").data["results"]
        self.assertFalse(any(a["message"] == "hello-feed" for a in out_feed))
        # rules are personal
        mine = c.get("/api/alerts/rules/").data
        self.assertTrue(all(True for _ in mine))
        r = c.post("/api/alerts/rules/", {"kind": "risk", "min_severity": "high"})
        self.assertEqual(r.status_code, 201)
        rid = r.data["id"]
        self.assertEqual(out_c.get(f"/api/alerts/rules/{rid}/").status_code, 404)
        # notifications: unread filter + mark read
        notes = c.get("/api/alerts/notifications/?unread=1").data["results"]
        self.assertTrue(len(notes) >= 1)
        nid = notes[0]["id"]
        self.assertEqual(c.post(f"/api/alerts/notifications/{nid}/read/").status_code, 200)
        self.assertEqual(c.get("/api/alerts/notifications/?unread=1").data["results"], [])

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c


@override_settings(CHANNEL_LAYERS=INMEM)
class ConsumerTests(TransactionTestCase):
    # TransactionTestCase: the consumer resolves JWT users on another thread,
    # which cannot share TestCase's transaction. Usernames are unique per test.
    def _mk(self, username):
        return User.objects.create_user(username, password="pw123456", role=Role.INVESTIGATOR)

    def _token_for(self, user):
        from rest_framework_simplejwt.tokens import RefreshToken
        return str(RefreshToken.for_user(user).access_token)

    def test_connect_and_receive(self):
        from asgiref.sync import async_to_sync
        from channels.testing import ApplicationCommunicator

        from .consumers import AlertsConsumer

        user = self._mk("wsu_recv")
        token = self._token_for(user)
        uid = user.id

        async def scenario():
            from channels.layers import get_channel_layer
            comm = ApplicationCommunicator(
                AlertsConsumer.as_asgi(),
                {"type": "websocket", "path": "/ws/alerts/",
                 "query_string": f"token={token}".encode()})
            await comm.send_input({"type": "websocket.connect"})
            out = await comm.receive_output(2)
            assert out["type"] == "websocket.accept", out
            hello = await comm.receive_output(2)
            assert hello["type"] == "websocket.send", hello
            # push through the real layer (async-safe direct send; broadcast()
            # is the sync-context equivalent used by views/tasks)
            layer = get_channel_layer()
            await layer.group_send(f"user_{uid}",
                                   {"type": "alert.message",
                                    "data": {"kind": "system", "message": "hi-hub"}})
            got = await comm.receive_output(2)
            assert got["type"] == "websocket.send", got
            assert "hi-hub" in json.dumps(got)
            await comm.send_input({"type": "websocket.disconnect", "code": 1000})
            await comm.wait(2)

        async_to_sync(scenario)()

    def test_reject_anoymous(self):
        from asgiref.sync import async_to_sync
        from channels.testing import ApplicationCommunicator

        from .consumers import AlertsConsumer

        async def scenario():
            comm = ApplicationCommunicator(
                AlertsConsumer.as_asgi(),
                {"type": "websocket", "path": "/ws/alerts/", "query_string": b""})
            await comm.send_input({"type": "websocket.connect"})
            out = await comm.receive_output(2)
            assert out["type"] == "websocket.close", out
            await comm.wait(2)

        async_to_sync(scenario)()
