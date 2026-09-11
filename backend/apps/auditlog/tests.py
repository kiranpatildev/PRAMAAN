"""Audit visibility: SHO sees all, investigators see only their own actions."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.auditlog.models import AuditLog
from apps.cases.models import Case, CaseAssignment


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


class AuditScopeTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho_a", Role.SHO)
        self.inv = _mkuser("inv_a", Role.INVESTIGATOR)
        self.other = _mkuser("other_a", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-RBAC-5", title="T", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit",
                                      assigned_by=self.sho)
        AuditLog.objects.create(actor=self.sho, action="create", object_type="/api/cases/")
        AuditLog.objects.create(actor=self.inv, action="create",
                                object_type=f"/api/cases/{self.case.id}/evidence/")

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def _rows(self, client, needle=None):
        # The login POSTs themselves are also audited; filter to case paths.
        rows = client.get("/api/audit/").data["results"]
        if needle:
            rows = [r for r in rows if needle in r["object_type"]]
        return rows

    def test_sho_sees_all(self):
        rows = self._rows(self._client(self.sho), needle="/cases/")
        self.assertEqual(len(rows), 2)

    def test_investigator_sees_own_only(self):
        rows = self._rows(self._client(self.inv), needle="/cases/")
        self.assertEqual(len(rows), 1)
        self.assertIn(str(self.case.id), rows[0]["object_type"])

    def test_other_investigator_sees_none(self):
        rows = self._rows(self._client(self.other), needle="/cases/")
        self.assertEqual(rows, [])
