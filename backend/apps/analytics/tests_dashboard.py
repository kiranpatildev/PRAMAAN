"""Spec §11 additions: dashboard KPIs, global review queue, relationships
breakdown, nested confirm/reject, reopen, assistant alias."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment
from apps.graph_api.models import ExtractedEntity, ExtractedRelation


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


class SpecEndpointsTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho_spec", Role.SHO)
        self.inv = _mkuser("inv_spec", Role.INVESTIGATOR)
        self.out = _mkuser("out_spec", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-SPEC-1", title="spec", owner=self.sho,
                                        risk_level="high")
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit",
                                      assigned_by=self.sho)
        self.ent = ExtractedEntity.objects.create(case=self.case, node_type="Person",
                                                  value="Rahul Sharma", normalized="rahul sharma",
                                                  confidence=0.9, engine="spacy")
        self.ent2 = ExtractedEntity.objects.create(case=self.case, node_type="PhoneNumber",
                                                   value="9876543210", normalized="9876543210",
                                                   confidence=0.8, engine="regex")
        ExtractedRelation.objects.create(case=self.case, src=self.ent, dst=self.ent2,
                                         edge_type="CALLED", confidence=0.7, snippet="s")

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_dashboard_kpis(self):
        d = self._client(self.sho).get("/api/analytics/dashboard/").data
        for k in ("cases_total", "cases_open", "evidence_files", "evidence_in_pipeline",
                  "entities_extracted", "entities_pending", "high_risk_cases"):
            self.assertIn(k, d)
        self.assertEqual(d["cases_total"], 1)
        self.assertEqual(d["entities_extracted"], 2)
        self.assertEqual(d["entities_pending"], 2)
        self.assertEqual(d["high_risk_cases"], 1)
        # Outsider sees nothing.
        d2 = self._client(self.out).get("/api/analytics/dashboard/").data
        self.assertEqual(d2["cases_total"], 0)
        self.assertEqual(d2["entities_extracted"], 0)

    def test_review_queue_global(self):
        d = self._client(self.inv).get("/api/entities/review/queue/").data
        self.assertEqual(d["entities"]["count"], 2)
        self.assertEqual(d["relations"]["count"], 1)
        self.assertTrue(all("case_fir" in e for e in d["entities"]["results"]))
        d2 = self._client(self.out).get("/api/entities/review/queue/").data
        self.assertEqual(d2["entities"]["count"], 0)

    def test_relationships_breakdown(self):
        d = self._client(self.inv).get(f"/api/cases/{self.case.id}/relationships/").data
        self.assertEqual(d, {"types": [{"type": "CALLED", "count": 1}]})
        r = self._client(self.out).get(f"/api/cases/{self.case.id}/relationships/")
        self.assertEqual(r.status_code, 403)

    def test_nested_confirm_reject_roles(self):
        inv_c = self._client(self.inv)
        r = inv_c.post(f"/api/cases/{self.case.id}/entities/{self.ent.id}/confirm/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "confirmed")
        sho_c = self._client(self.sho)
        r = sho_c.post(f"/api/cases/{self.case.id}/entities/{self.ent2.id}/confirm/")
        self.assertEqual(r.status_code, 403)
        r = inv_c.post(f"/api/cases/{self.case.id}/entities/{self.ent2.id}/reject/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "rejected")
        r = self._client(self.out).post(f"/api/cases/{self.case.id}/entities/{self.ent.id}/confirm/")
        self.assertEqual(r.status_code, 403)

    def test_reopen_sho_only(self):
        self.case.status = "closed"
        self.case.save(update_fields=["status"])
        r = self._client(self.inv).post(f"/api/cases/{self.case.id}/reopen/")
        self.assertEqual(r.status_code, 403)
        r = self._client(self.sho).post(f"/api/cases/{self.case.id}/reopen/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "open")

    def test_assistant_alias(self):
        r = self._client(self.inv).post("/api/assistant/query/", {"query": "summarize"})
        self.assertIn(r.status_code, (200, 503))
        if r.status_code == 200:
            self.assertIn("answer", r.data)
