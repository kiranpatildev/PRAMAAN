"""Phase 2 tests: classifier, OCR service, upload pipeline, chain-of-custody."""
from unittest import mock

from django.test import TestCase, override_settings
from django.test.client import MULTIPART_CONTENT
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment

from .models import ChainOfCustody, Evidence
from .services.classifier import classify
from .services.ocr import extract_text, sample_text


def make_pdf(line: bytes) -> bytes:
    """Minimal valid single-page PDF with an embedded text layer."""
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    ]
    stream = b"BT /F1 12 Tf 10 200 Td (" + line + b") Tj ET"
    objs.append(b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"\nendstream")
    objs.append(b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")
    out = [b"%PDF-1.4"]
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(sum(len(x) + 1 for x in out))
        out.append(str(i).encode() + b" 0 obj" + body + b"endobj")
    xref_pos = sum(len(x) + 1 for x in out)
    out.append(("xref\n0 %d\n" % (len(objs) + 1)).encode() + b"0000000000 65535 f \n"
               + b"".join(b"%010d 00000 n \n" % o for o in offsets))
    out.append(b"trailer<</Size " + str(len(objs) + 1).encode() + b" /Root 1 0 R>>")
    out.append(b"startxref\n" + str(xref_pos).encode() + b"\n%%EOF")
    return b"\n".join(out)


CDR_CSV = b"calling,called party,msisdn,imei,call type\n98765,91234,9198765,356000,OUT\n"


class ClassifierTests(TestCase):
    def test_fir_filename(self):
        r = classify("FIR-2026-1001.pdf", "application/pdf")
        self.assertEqual(r["label"], "fir")

    def test_cdr_content_beats_filename(self):
        r = classify("report.csv", "text/csv", CDR_CSV.decode())
        self.assertEqual(r["label"], "cdr")
        self.assertGreaterEqual(r["confidence"], 0.85)

    def test_bank_content(self):
        sample = "account no narration debit credit ifsc branch available balance"
        self.assertEqual(classify("stmt.pdf", "application/pdf", sample)["label"], "bank_statement")

    def test_photo_extension(self):
        self.assertEqual(classify("scene.jpg", "image/jpeg")["label"], "photo")

    def test_fallback(self):
        r = classify("mystery.xyz", "application/octet-stream")
        self.assertEqual(r["label"], "other")


class OcrServiceTests(TestCase):
    def test_raw_text(self):
        r = extract_text(b"hello transcript", "text/plain", "note.txt")
        self.assertEqual((r["status"], r["engine"], r["text"]), ("done", "raw-text", "hello transcript"))

    def test_pdf_text_layer(self):
        pdf = make_pdf(b"First Information Report FIR-2026-1001 complainant police station")
        r = extract_text(pdf, "application/pdf", "fir.pdf")
        self.assertEqual(r["status"], "done")
        self.assertEqual(r["engine"], "pypdf-text")
        self.assertIn("FIR-2026-1001", r["text"])

    def test_pdf_sample_feeds_classifier(self):
        pdf = make_pdf(b"First Information Report FIR-2026-1001 complainant police station")
        sample = sample_text(pdf, "application/pdf", "scan.pdf")
        self.assertEqual(classify("scan.pdf", "application/pdf", sample)["label"], "fir")

    def test_image_without_paddle_is_unavailable(self):
        with mock.patch.dict("sys.modules", {"paddleocr": None}):
            # paddleocr not installed in base image -> honest 'unavailable', never fake text
            import sys
            sys.modules.pop("paddleocr", None)
            r = extract_text(b"\x89PNG fakepng", "image/png", "scene.png")
        self.assertEqual(r["status"], "unavailable")
        self.assertEqual(r["text"], "")

    def test_unsupported_skipped(self):
        r = extract_text(b"\x00\x01\x02", "audio/mpeg", "call.mp3")
        self.assertEqual(r["status"], "skipped")


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class EvidenceApiTests(TestCase):
    def setUp(self):
        self.sho = User.objects.create_user("sho", password="pw123456", role=Role.SHO)
        self.inv = User.objects.create_user("inv", password="pw123456", role=Role.INVESTIGATOR)
        self.outsider = User.objects.create_user("out", password="pw123456", role=Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-2026-9001", title="Pipeline case", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)

    def _client(self, user):
        c = APIClient()
        resp = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(resp.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + resp.data["access"])
        return c

    def _upload(self, client, name="tower-dump.csv", content=CDR_CSV, mime="text/csv"):
        from django.core.files.uploadedfile import SimpleUploadedFile
        f = SimpleUploadedFile(name, content, content_type=mime)
        return client.post(f"/api/cases/{self.case.id}/evidence/", {"file": f},
                           format="multipart", CONTENT_TYPE=MULTIPART_CONTENT)

    def test_full_pipeline_and_custody(self):
        c = self._client(self.inv)
        with mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k") as up, \
             mock.patch("apps.evidence.services.storage.object_exists", return_value=True), \
             mock.patch("apps.evidence.services.storage.download_bytes", return_value=CDR_CSV):
            resp = self._upload(c)
        self.assertEqual(resp.status_code, 201, resp.content[:500])
        up.assert_called_once()
        ev = Evidence.objects.get(pk=resp.data["id"])
        self.assertEqual(ev.sha256, Evidence.hash_bytes(CDR_CSV))
        self.assertEqual(ev.classification, "cdr")  # content markers win
        self.assertEqual(ev.ocr_status, "done")
        self.assertEqual(ev.ocr_engine, "raw-text")
        actions = list(ChainOfCustody.objects.filter(evidence=ev).values_list("action", flat=True))
        self.assertIn("uploaded", actions)
        self.assertIn("classified", actions)
        self.assertIn("ocr_completed", actions)

    def test_custody_download_reprocess_endpoints(self):
        c = self._client(self.inv)
        with mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k"), \
             mock.patch("apps.evidence.services.storage.object_exists", return_value=True), \
             mock.patch("apps.evidence.services.storage.download_bytes", return_value=CDR_CSV):
            ev_id = self._upload(c).data["id"]
        with mock.patch("apps.evidence.services.storage.presigned_get_url", return_value="http://minio/x") as pre:
            dl = c.get(f"/api/cases/{self.case.id}/evidence/{ev_id}/download/")
        self.assertEqual(dl.status_code, 200)
        pre.assert_called_once()
        self.assertIn("sha256", dl.data)
        cust = c.get(f"/api/cases/{self.case.id}/evidence/{ev_id}/custody/")
        self.assertEqual(cust.status_code, 200)
        kinds = {e["action"] for e in cust.data}
        self.assertTrue({"uploaded", "classified", "ocr_completed", "downloaded"} <= kinds)
        with mock.patch("apps.evidence.services.storage.object_exists", return_value=True), \
             mock.patch("apps.evidence.services.storage.download_bytes", return_value=CDR_CSV):
            rep = c.post(f"/api/cases/{self.case.id}/evidence/{ev_id}/reprocess/")
        self.assertEqual(rep.status_code, 200)
        self.assertTrue(ChainOfCustody.objects.filter(evidence_id=ev_id, action="reprocessed").exists())

    def test_storage_outage_degrades_gracefully(self):
        c = self._client(self.inv)
        with mock.patch("apps.evidence.services.storage.upload_bytes", side_effect=RuntimeError("minio down")), \
             mock.patch("apps.evidence.services.storage.object_exists", return_value=False), \
             mock.patch("apps.evidence.services.storage.download_bytes", side_effect=RuntimeError("minio down")):
            resp = self._upload(c, name="notes.txt", content=b"plain note", mime="text/plain")
        self.assertEqual(resp.status_code, 201, resp.content[:500])
        ev = Evidence.objects.get(pk=resp.data["id"])
        self.assertTrue(ev.processing_error)  # outage recorded, not raised
        self.assertEqual(ev.classification, "document")  # filename-only path still works

    def test_outsider_forbidden(self):
        c = self._client(self.outsider)
        self.assertEqual(c.get(f"/api/cases/{self.case.id}/evidence/").status_code, 403)
        with mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k"):
            self.assertEqual(self._upload(c).status_code, 403)
