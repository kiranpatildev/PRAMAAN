"""RBAC: case creation is SHO-only; hands-on evidentiary work is investigator-only."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment
from apps.cases.permissions import user_can_contribute_case


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


class CaseCreateGateTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho_rbac", Role.SHO)
        self.inv = _mkuser("inv_rbac", Role.INVESTIGATOR)

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_sho_can_create(self):
        c = self._client(self.sho)
        r = c.post("/api/cases/", {"fir_no": "FIR-RBAC-1", "title": "T"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Case.objects.get(fir_no="FIR-RBAC-1").owner, self.sho)

    def test_investigator_cannot_create(self):
        c = self._client(self.inv)
        r = c.post("/api/cases/", {"fir_no": "FIR-RBAC-2", "title": "T"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Case.objects.filter(fir_no="FIR-RBAC-2").exists())


class ContributeHelperTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho_c", Role.SHO)
        self.inv = _mkuser("inv_c", Role.INVESTIGATOR)
        self.other = _mkuser("other_c", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-RBAC-3", title="T", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit",
                                      assigned_by=self.sho)

    def test_sho_excluded_despite_edit_rights(self):
        self.assertFalse(user_can_contribute_case(self.sho, self.case))

    def test_assigned_investigator_included(self):
        self.assertTrue(user_can_contribute_case(self.inv, self.case))

    def test_unassigned_investigator_excluded(self):
        self.assertFalse(user_can_contribute_case(self.other, self.case))
