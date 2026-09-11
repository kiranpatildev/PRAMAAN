"""Investigator-only enforcement on hands-on evidentiary endpoints."""
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment
from apps.graph_api.models import ExtractedEntity, ExtractedRelation


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class HandsOnWorkTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho_h", Role.SHO)
        self.inv = _mkuser("inv_h", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-RBAC-4", title="T", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit",
                                      assigned_by=self.sho)
        self.a = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="A",
                                                normalized="a", confidence=0.7)
        self.b = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="B",
                                                normalized="b", confidence=0.7)
        self.rel = ExtractedRelation.objects.create(case=self.case, src=self.a, dst=self.b,
                                                    edge_type="CALLED", confidence=0.6, snippet="s")

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_sho_cannot_upload(self):
        c = self._client(self.sho)
        f = SimpleUploadedFile("x.txt", b"hello", content_type="text/plain")
        r = c.post(f"/api/cases/{self.case.id}/evidence/", {"file": f}, format="multipart")
        self.assertEqual(r.status_code, 403)

    def test_sho_cannot_verify(self):
        c = self._client(self.sho)
        r = c.post(f"/api/entities/review/entities/{self.a.id}/", {"decision": "confirm"})
        self.assertEqual(r.status_code, 403)
        r = c.post(f"/api/entities/review/relations/{self.rel.id}/", {"decision": "confirm"})
        self.assertEqual(r.status_code, 403)

    def test_investigator_can_still_work(self):
        from unittest import mock
        c = self._client(self.inv)
        with mock.patch("apps.evidence.services.storage.upload_bytes", return_value="k"), \
             mock.patch("apps.evidence.services.storage.object_exists", return_value=True), \
             mock.patch("apps.evidence.services.storage.download_bytes", return_value=b"hello 9876543210"):
            f = SimpleUploadedFile("x.txt", b"hello 9876543210", content_type="text/plain")
            r = c.post(f"/api/cases/{self.case.id}/evidence/", {"file": f}, format="multipart")
        self.assertEqual(r.status_code, 201)
        r = c.post(f"/api/entities/review/entities/{self.a.id}/", {"decision": "confirm"})
        self.assertEqual(r.status_code, 200)
