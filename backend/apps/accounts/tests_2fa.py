"""Phase 8 2FA tests: TOTP vectors, setup/verify/login/disable flow."""
import time

from django.test import TestCase

from apps.accounts.models import User
from apps.accounts.totp import new_secret, verify


class TotpUnitTests(TestCase):
    def test_rfc_vector(self):
        # RFC 6238-adjacent: fixed secret/time must verify, neighbors skew ok.
        secret = "JBSWY3DPEHPK3PXP"
        now = time.time()
        import apps.accounts.totp as T
        code = T._code(secret, int(now // 30))
        self.assertTrue(verify(secret, code, at=now))
        self.assertFalse(verify(secret, "000000", at=now))
        self.assertFalse(verify(secret, code, at=now + 120))  # outside ±1 window
        self.assertTrue(verify(secret, code, at=now + 30))  # +1 skew ok

    def test_malformed(self):
        self.assertFalse(verify("", "123456"))
        self.assertFalse(verify("JBSWY3DPEHPK3PXP", "abcdef"))
        self.assertFalse(verify("JBSWY3DPEHPK3PXP", "12345"))
        self.assertTrue(len(new_secret()) >= 32)


class TwoFactorFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("tfa", password="pw123456")

    def _code(self):
        import apps.accounts.totp as T
        return T._code(self.user.totp_secret, int(time.time() // 30))

    def test_full_flow(self):
        from rest_framework.test import APIClient
        anon = APIClient()
        # plain login works before enabling
        r = anon.post("/api/auth/login/", {"username": "tfa", "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("two_factor_required", r.data)

        # setup + verify
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": "tfa", "password": "pw123456"})
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        s = c.post("/api/auth/2fa/setup/").data
        self.assertIn("secret", s)
        self.assertIn("otpauth_url", s)
        self.user.refresh_from_db()
        self.assertFalse(self.user.totp_enabled)
        bad = c.post("/api/auth/2fa/verify/", {"code": "000000"})
        self.assertEqual(bad.status_code, 400)
        ok = c.post("/api/auth/2fa/verify/", {"code": self._code()})
        self.assertEqual(ok.status_code, 200)

        # password step now returns a pre-token, not a session
        anon2 = APIClient()
        r2 = anon2.post("/api/auth/login/", {"username": "tfa", "password": "pw123456"})
        self.assertTrue(r2.data.get("two_factor_required"))
        pre = r2.data["pre_token"]
        denied = anon2.post("/api/auth/login/2fa/", {"pre_token": pre, "code": "000000"})
        self.assertEqual(denied.status_code, 401)
        done = anon2.post("/api/auth/login/2fa/", {"pre_token": pre, "code": self._code()})
        self.assertEqual(done.status_code, 200)
        self.assertIn("access", done.data)

        # disable requires password
        no = c.post("/api/auth/2fa/disable/", {"password": "wrong"})
        self.assertEqual(no.status_code, 400)
        yes = c.post("/api/auth/2fa/disable/", {"password": "pw123456"})
        self.assertEqual(yes.status_code, 200)
        r3 = anon2.post("/api/auth/login/", {"username": "tfa", "password": "pw123456"})
        self.assertNotIn("two_factor_required", r3.data)
