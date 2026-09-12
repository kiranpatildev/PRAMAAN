"""Role-door login tests: expected_role is enforced server-side."""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Role, User


class RoleDoorLoginTests(TestCase):
    def setUp(self):
        User.objects.create_user("sho1", password="pw123456", role=Role.SHO)
        User.objects.create_user("inv1", password="pw123456", role=Role.INVESTIGATOR)
        User.objects.create_user("adm1", password="pw123456", role=Role.ADMIN)

    def _login(self, username, **extra):
        anon = APIClient()
        return anon.post("/api/auth/login/",
                         {"username": username, "password": "pw123456", **extra})

    def test_matching_doors_open(self):
        r = self._login("sho1", expected_role="sho")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        r = self._login("inv1", expected_role="investigator")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        r = self._login("adm1", expected_role="admin")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)

    def test_mismatched_doors_reject(self):
        r = self._login("inv1", expected_role="sho")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("access", r.data)
        self.assertIn("Investigator", r.data["detail"])
        self.assertEqual(r.data["error"], "wrong_door")
        self.assertEqual(r.data["expected"], "investigator")
        r = self._login("sho1", expected_role="investigator")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("access", r.data)
        self.assertIn("Supervisor", r.data["detail"])
        self.assertEqual(r.data["error"], "wrong_door")
        self.assertEqual(r.data["expected"], "sho")

    def test_admin_door_is_strict(self):
        r = self._login("sho1", expected_role="admin")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["error"], "wrong_door")
        self.assertEqual(r.data["expected"], "sho")
        r = self._login("adm1", expected_role="sho")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["expected"], "admin")

    def test_no_expected_role_still_works(self):
        # Backward compatible: direct API clients omitting the field log in normally.
        r = self._login("sho1")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)

    def test_wrong_password_still_401(self):
        anon = APIClient()
        r = anon.post("/api/auth/login/",
                      {"username": "sho1", "password": "wrong", "expected_role": "sho"})
        self.assertEqual(r.status_code, 401)

    def test_login_brute_force_is_throttled(self):
        User.objects.create_user("brute1", password="pw123456", role=Role.INVESTIGATOR)
        anon = APIClient()
        codes = set()
        for _ in range(12):
            r = anon.post("/api/auth/login/", {"username": "brute1", "password": "wrong"})
            codes.add(r.status_code)
        self.assertIn(401, codes)
        self.assertIn(429, codes)
