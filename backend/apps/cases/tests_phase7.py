"""Phase 7 report + district + workflow tests."""
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment, CaseComment, CaseLink, CaseTask
from apps.evidence.models import ChainOfCustody, CustodyAction, Evidence
from apps.graph_api.models import ExtractedEntity, ReviewStatus
from apps.reports.models import Report


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class ReportTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho12", Role.SHO)
        self.inv = _mkuser("inv12", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P7-4", title="p7rep", owner=self.sho,
                                        station="S1", district="Pune")
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        blob = b"rep-bytes"
        self.ev = Evidence.objects.create(
            case=self.case, file_name="fir.pdf", file_type="fir", mime_type="application/pdf",
            size_bytes=len(blob), sha256=Evidence.hash_bytes(blob), storage_key="k",
            uploaded_by=self.inv, classification="fir", classification_confidence=0.9)
        ChainOfCustody.log(self.ev, self.inv, CustodyAction.UPLOADED, {"x": 1})
        ExtractedEntity.objects.create(case=self.case, node_type="Person", value="Rahul Sharma",
                                       normalized="rahul sharma", confidence=0.8,
                                       status=ReviewStatus.CONFIRMED, evidence=self.ev)

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_package_pdf(self):
        c = self._client(self.inv)
        with mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k"), \
             mock.patch("apps.evidence.services.storage.presigned_get_url",
                        return_value="http://minio/report.pdf"):
            r = c.post("/api/reports/case-package/", {"case_id": self.case.id})
        self.assertEqual(r.status_code, 201, r.content[:300])
        rep = Report.objects.get(pk=r.data["id"])
        self.assertEqual(rep.sha256, r.data["sha256"])
        self.assertTrue(rep.size_bytes > 1000)
        with mock.patch("apps.evidence.services.storage.download_bytes", return_value=b"%PDF-fake"):
            dl = c.get(f"/api/reports/{rep.id}/download/")
        self.assertEqual(dl.status_code, 200)
        lst = c.get(f"/api/reports/?case_id={self.case.id}").data  # function view: raw list
        self.assertEqual(len(lst), 1)

    def test_pdf_content_shape(self):
        from apps.reports.services.package import build_evidence_package
        pdf = build_evidence_package(self.case, generated_by="tester")
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 2000)

    def test_outsider_forbidden(self):
        c = self._client(_mkuser("out12", Role.INVESTIGATOR))
        self.assertEqual(c.post("/api/reports/case-package/", {"case_id": self.case.id}).status_code, 403)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class DistrictTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho13", Role.SHO)
        self.inv = _mkuser("inv13", Role.INVESTIGATOR)
        self.c1 = Case.objects.create(fir_no="FIR-P7-5", title="d1", owner=self.sho,
                                      district="Pune", status="open", risk_level="high")
        self.c2 = Case.objects.create(fir_no="FIR-P7-6", title="d2", owner=self.sho,
                                      district="Pune", status="closed", risk_level="low")
        Case.objects.create(fir_no="FIR-P7-7", title="d3", owner=self.sho, district="Mumbai")
        CaseAssignment.objects.create(case=self.c1, user=self.inv, permission="edit", assigned_by=self.sho)
        ExtractedEntity.objects.create(case=self.c1, node_type="Person", value="A",
                                       normalized="a", confidence=0.8, status="pending")

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_district_aggregates(self):
        c = self._client(self.sho)
        ds = c.get("/api/analytics/districts/").data["districts"]
        self.assertIn("Pune", ds)
        r = c.get("/api/analytics/district/?district=Pune").data
        self.assertEqual(r["cases"]["total"], 2)
        self.assertEqual(r["cases"]["by_status"], {"open": 1, "closed": 1})
        self.assertEqual(r["cases"]["by_risk"]["high"], 1)
        w = {x["username"]: x for x in r["workload"]}
        self.assertEqual(w["inv13"]["pending_reviews"], 1)
        self.assertEqual(c.get("/api/analytics/district/").status_code, 400)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class WorkflowTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho14", Role.SHO)
        self.inv = _mkuser("inv14", Role.INVESTIGATOR)
        self.outsider = _mkuser("out14", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P7-8", title="p7w", owner=self.sho)
        self.case2 = Case.objects.create(fir_no="FIR-P7-9", title="p7w2", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_tasks(self):
        inv_c, out_c = self._client(self.inv), self._client(self.outsider)
        self.assertEqual(out_c.get(f"/api/cases/{self.case.id}/tasks/").status_code, 403)
        t = inv_c.post(f"/api/cases/{self.case.id}/tasks/",
                       {"title": "Verify CDR", "assignee": self.inv.id}).data
        self.assertEqual(t["assignee_name"], "inv14")
        bad = inv_c.post(f"/api/cases/{self.case.id}/tasks/",
                         {"title": "x", "assignee": self.outsider.id})
        self.assertEqual(bad.status_code, 400)  # assignee must see the case
        tid = t["id"]
        self.assertEqual(inv_c.patch(f"/api/cases/{self.case.id}/tasks/{tid}/",
                                     {"status": "doing"}).data["status"], "doing")
        self.assertEqual(inv_c.delete(f"/api/cases/{self.case.id}/tasks/{tid}/").status_code, 204)
        self.assertFalse(CaseTask.objects.filter(pk=tid).exists())

    def test_comments(self):
        inv_c, sho_c = self._client(self.inv), self._client(self.sho)
        c1 = inv_c.post(f"/api/cases/{self.case.id}/comments/", {"text": "note one"}).data
        self.assertEqual(len(inv_c.get(f"/api/cases/{self.case.id}/comments/").data), 1)
        # author deletes own; SHO deletes others'
        self.assertEqual(inv_c.delete(f"/api/cases/{self.case.id}/comments/{c1['id']}/").status_code, 204)
        c2 = inv_c.post(f"/api/cases/{self.case.id}/comments/", {"text": "note two"}).data
        other = self._client(_mkuser("out14b", Role.INVESTIGATOR))
        self.assertEqual(other.delete(f"/api/cases/{self.case.id}/comments/{c2['id']}/").status_code, 403)
        self.assertEqual(sho_c.delete(f"/api/cases/{self.case.id}/comments/{c2['id']}/").status_code, 204)
        self.assertFalse(CaseComment.objects.filter(pk=c2["id"]).exists())

    def test_links(self):
        inv_c = self._client(self.inv)
        self.assertEqual(inv_c.post(f"/api/cases/{self.case.id}/links/",
                                    {"to_case": self.case.id}).status_code, 400)  # self-link
        # target invisible to inv -> 403 (inv sees case 1 only)
        self.assertEqual(inv_c.post(f"/api/cases/{self.case.id}/links/",
                                    {"to_case": self.case2.id, "reason": "x"}).status_code, 403)
        sho_c = self._client(self.sho)
        link = sho_c.post(f"/api/cases/{self.case.id}/links/",
                          {"to_case": self.case2.id, "reason": "shared phone"}).data
        self.assertEqual(link["to_fir"], "FIR-P7-9")
        dup = sho_c.post(f"/api/cases/{self.case.id}/links/", {"to_case": self.case2.id})
        self.assertEqual(dup.status_code, 409)
        lst = sho_c.get(f"/api/cases/{self.case2.id}/links/").data  # visible from either side
        self.assertEqual(len(lst), 1)
        self.assertEqual(sho_c.delete(f"/api/cases/{self.case.id}/links/{link['id']}/").status_code, 204)
        self.assertFalse(CaseLink.objects.filter(pk=link["id"]).exists())

    def test_activity(self):
        inv_c = self._client(self.inv)
        inv_c.post(f"/api/cases/{self.case.id}/comments/", {"text": "activity probe"})
        inv_c.post(f"/api/cases/{self.case.id}/tasks/", {"title": "task probe"})
        feed = inv_c.get(f"/api/cases/{self.case.id}/activity/").data["activity"]
        kinds = {e["kind"].split(":")[0] for e in feed}
        self.assertTrue({"comment", "task", "audit"} <= kinds)
