"""ICJS import tests: SHO-gated case creation, shared-path flow, log states."""
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case
from apps.evidence.models import ChainOfCustody, Evidence

from .client import IcjsNotFound, IcjsServiceError
from .models import IcjsImportLog

CSV_BYTES = b"caller,callee,timestamp\n9876543210,9123456780,2026-03-12T19:02:11\n"
TXT_BYTES = b"Rahul Sharma called 9876543210 from Kothrud on 12 March 2026."
MANIFEST = {"case_id": "MH-2026-001", "title": "Kothrud Jewellery Heist Ring",
            "state": "Maharashtra", "district": "Pune", "station": "Shivajinagar PS",
            "fir_no": "FIR-2026-9009", "date_registered": "2026-01-14"}
FILES = [
    {"name": "CDR.csv", "size_bytes": len(CSV_BYTES),
     "content_type": "text/csv", "download_url": "/icjs/cases/X/files/CDR.csv"},
    {"name": "note.txt", "size_bytes": len(TXT_BYTES),
     "content_type": "text/plain", "download_url": "/icjs/cases/X/files/note.txt"},
]
BLOBS = {"CDR.csv": (CSV_BYTES, "text/csv"), "note.txt": (TXT_BYTES, "text/plain")}


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class IcjsImportTests(TestCase):
    def setUp(self):
        self.sho = User.objects.create_user("sho", password="pw123456", role=Role.SHO)
        self.inv = User.objects.create_user("inv", password="pw123456", role=Role.INVESTIGATOR)
        self.outsider = User.objects.create_user("out", password="pw123456", role=Role.INVESTIGATOR)

    def _client(self, user):
        c = APIClient()
        resp = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(resp.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + resp.data["access"])
        return c

    def _ok_mocks(self):
        return (mock.patch("apps.icjs.views.icjs_client.get_manifest", return_value=dict(MANIFEST)),
                mock.patch("apps.icjs.views.icjs_client.list_files", return_value=FILES),
                mock.patch("apps.icjs.views.icjs_client.download_file",
                           side_effect=lambda cid, name, timeout=30: BLOBS[name]),
                mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k"),
                mock.patch("apps.evidence.services.storage.object_exists", return_value=True),
                mock.patch("apps.evidence.services.storage.download_bytes",
                           side_effect=lambda key: CSV_BYTES))

    def test_available_cases_sho_only(self):
        sho_c, inv_c = self._client(self.sho), self._client(self.inv)
        with mock.patch("apps.icjs.views.icjs_client.list_cases",
                        return_value=[{"case_id": "MH-2026-001", "title": "T"}]):
            resp = sho_c.get("/api/icjs/available-cases/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["cases"][0]["case_id"], "MH-2026-001")
        self.assertEqual(inv_c.get("/api/icjs/available-cases/").status_code, 403)

    def test_available_cases_service_down(self):
        c = self._client(self.sho)
        with mock.patch("apps.icjs.views.icjs_client.list_cases",
                        side_effect=IcjsServiceError("down")):
            resp = c.get("/api/icjs/available-cases/")
        self.assertEqual(resp.status_code, 502)

    def test_import_is_sho_only(self):
        inv_c, out_c = self._client(self.inv), self._client(self.outsider)
        body = {"external_case_id": "MH-2026-001"}
        self.assertEqual(inv_c.post("/api/cases/icjs-import/", body).status_code, 403)
        self.assertEqual(out_c.post("/api/cases/icjs-import/", body).status_code, 403)
        sho_c = self._client(self.sho)
        self.assertEqual(sho_c.post("/api/cases/icjs-import/", {}).status_code, 400)

    def test_full_success_creates_case(self):
        c = self._client(self.sho)
        with self._ok_mocks()[0], self._ok_mocks()[1], self._ok_mocks()[2], \
             self._ok_mocks()[3], self._ok_mocks()[4], self._ok_mocks()[5], \
             mock.patch("apps.icjs.views.broadcast") as bc:
            resp = c.post("/api/cases/icjs-import/", {"external_case_id": "MH-2026-001"})
        self.assertEqual(resp.status_code, 200, resp.content[:500])
        self.assertEqual(resp.data["status"], "success")
        self.assertEqual((resp.data["files_imported"], resp.data["files_failed"]), (2, 0))
        # New case auto-populated from the manifest, owned by the SHO.
        case = Case.objects.get(pk=resp.data["case_id"])
        self.assertEqual((case.fir_no, case.title, case.station, case.district, case.state),
                         ("FIR-2026-9009", "Kothrud Jewellery Heist Ring",
                          "Shivajinagar PS", "Pune", "Maharashtra"))
        self.assertEqual(case.owner, self.sho)
        # Same rows manual upload would create, but custody says ICJS import.
        evs = Evidence.objects.filter(case=case).order_by("file_name")
        self.assertEqual([e.file_name for e in evs], ["CDR.csv", "note.txt"])
        self.assertEqual(evs[0].sha256, Evidence.hash_bytes(CSV_BYTES))
        actions = set(ChainOfCustody.objects.filter(evidence__in=evs).values_list("action", flat=True))
        self.assertIn("icjs_import", actions)
        self.assertNotIn("uploaded", actions)
        first = ChainOfCustody.objects.filter(evidence=evs[0], action="icjs_import").first()
        self.assertEqual(first.details["external_case_id"], "MH-2026-001")
        self.assertEqual(first.details["source"], "ICJS mock")
        log = IcjsImportLog.objects.get(pk=resp.data["import_log_id"])
        self.assertEqual((log.status, log.files_imported, log.files_failed, log.case), ("success", 2, 0, case))
        self.assertIsNotNone(log.completed_at)
        from apps.graph_api.models import ExtractedEntity
        self.assertTrue(ExtractedEntity.objects.filter(
            case=case, node_type="PhoneNumber", normalized="9876543210").exists())
        kinds = [call.args[1].get("phase") for call in bc.call_args_list]
        for phase in ("connected", "case_found", "fetching", "received", "complete"):
            self.assertIn(phase, kinds)

    def test_duplicate_fir_rejected(self):
        Case.objects.create(fir_no="FIR-2026-9009", title="Existing", owner=self.sho)
        c = self._client(self.sho)
        with mock.patch("apps.icjs.views.icjs_client.get_manifest", return_value=dict(MANIFEST)):
            resp = c.post("/api/cases/icjs-import/", {"external_case_id": "MH-2026-001"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(Case.objects.filter(fir_no="FIR-2026-9009").count(), 1)

    def test_partial_failure_keeps_case(self):
        c = self._client(self.sho)
        def boom(cid, name, timeout=30):
            if name == "note.txt":
                raise IcjsServiceError("reset by peer")
            return BLOBS[name]
        with mock.patch("apps.icjs.views.icjs_client.get_manifest", return_value=dict(MANIFEST)), \
             mock.patch("apps.icjs.views.icjs_client.list_files", return_value=FILES), \
             mock.patch("apps.icjs.views.icjs_client.download_file", side_effect=boom), \
             mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k"), \
             mock.patch("apps.evidence.services.storage.object_exists", return_value=True), \
             mock.patch("apps.evidence.services.storage.download_bytes", return_value=CSV_BYTES):
            resp = c.post("/api/cases/icjs-import/", {"external_case_id": "MH-2026-001"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "partial")
        self.assertEqual((resp.data["files_imported"], resp.data["files_failed"]), (1, 1))
        self.assertTrue(Case.objects.filter(pk=resp.data["case_id"]).exists())
        log = IcjsImportLog.objects.get(pk=resp.data["import_log_id"])
        self.assertEqual(log.status, "partial")
        self.assertIn("note.txt", log.error_detail)

    def test_total_failure_removes_empty_case(self):
        c = self._client(self.sho)
        with mock.patch("apps.icjs.views.icjs_client.get_manifest", return_value=dict(MANIFEST)), \
             mock.patch("apps.icjs.views.icjs_client.list_files", return_value=FILES), \
             mock.patch("apps.icjs.views.icjs_client.download_file",
                        side_effect=IcjsServiceError("boom")):
            resp = c.post("/api/cases/icjs-import/", {"external_case_id": "MH-2026-001"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "failed")
        self.assertIsNone(resp.data["case_id"])
        self.assertFalse(Case.objects.filter(fir_no="FIR-2026-9009").exists())
        log = IcjsImportLog.objects.get(pk=resp.data["import_log_id"])
        self.assertEqual(log.status, "failed")
        self.assertIsNone(log.case)  # log row survives for audit

    def test_unknown_external_case(self):
        c = self._client(self.sho)
        with mock.patch("apps.icjs.views.icjs_client.get_manifest",
                        side_effect=IcjsNotFound("not found")):
            resp = c.post("/api/cases/icjs-import/", {"external_case_id": "NOPE"})
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(Case.objects.count(), 0)

    def test_manifest_without_fir_rejected(self):
        c = self._client(self.sho)
        bad = dict(MANIFEST)
        bad.pop("fir_no")
        with mock.patch("apps.icjs.views.icjs_client.get_manifest", return_value=bad):
            resp = c.post("/api/cases/icjs-import/", {"external_case_id": "MH-2026-001"})
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(Case.objects.count(), 0)
