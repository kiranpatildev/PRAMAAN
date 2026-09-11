from datetime import timedelta

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .models import User
from .serializers import RegisterSerializer, UserSerializer
from .totp import new_secret, provisioning_uri, verify as verify_totp


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class RegisterView(APIView):
    """SHO/Admin creates investigators. Open registration is disabled in production;
    Phase 1 demo allows SHO-role callers (or any authed user in DEBUG seed flows)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not (request.user.is_sho() or request.user.is_superuser):
            return Response({"detail": "Only SHO/Admin can onboard users."}, status=status.HTTP_403_FORBIDDEN)
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user: User = s.save()
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class UserListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not request.user.is_sho():
            return Response({"detail": "Forbidden."}, status=403)
        users = User.objects.all().order_by("username")[:200]
        return Response(UserSerializer(users, many=True).data)


class LoginView(TokenObtainPairView):
    """Password step. 2FA-enabled users get a short-lived pre-token instead.

    Optional `expected_role` ("sho" | "investigator") enforces the login
    door the user walked through: a mismatch is rejected even when the
    password is correct, so accounts can never land in the wrong context.
    """

    def post(self, request, *args, **kwargs):
        resp = super().post(request, *args, **kwargs)
        if resp.status_code != 200:
            return resp
        try:
            user = User.objects.get(username=request.data.get("username"))
        except User.DoesNotExist:
            return resp
        expected = (request.data.get("expected_role") or "").strip().lower()
        if expected in ("sho", "investigator"):
            wants_sho = expected == "sho"
            actual = "Supervisor" if user.is_sho() else "Investigator"
            if user.is_sho() != wants_sho:
                return Response(
                    {"detail": f"This account is registered as {actual}. "
                               "Please go back and select the correct login type."},
                    status=403,
                )
        if user.totp_enabled and user.totp_secret:
            pre = AccessToken()
            pre.set_exp(lifetime=timedelta(minutes=5))
            pre["purpose"] = "2fa"
            pre["user_id"] = user.id
            return Response({"two_factor_required": True, "pre_token": str(pre)})
        return resp


class TwoFactorLoginView(APIView):
    """Second step: {pre_token, code} -> real token pair."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        try:
            pre = AccessToken(request.data.get("pre_token", ""))
            if pre.get("purpose") != "2fa":
                raise ValueError("not a 2fa token")
            user = User.objects.get(pk=pre["user_id"])
        except Exception:
            return Response({"detail": "Invalid or expired pre-token."}, status=401)
        if not (user.totp_enabled and user.totp_secret):
            return Response({"detail": "2FA is not enabled."}, status=400)
        if not verify_totp(user.totp_secret, request.data.get("code", "")):
            return Response({"detail": "Invalid code."}, status=401)
        refresh = RefreshToken.for_user(user)
        return Response({"refresh": str(refresh), "access": str(refresh.access_token)})


class TwoFactorSetupView(APIView):
    """Step 1: issue a secret (stored, not yet enabled)."""

    def post(self, request):
        user = request.user
        user.totp_secret = new_secret()
        user.totp_enabled = False
        user.save(update_fields=["totp_secret", "totp_enabled"])
        return Response({"secret": user.totp_secret,
                         "otpauth_url": provisioning_uri(user.username, user.totp_secret)})


class TwoFactorVerifyView(APIView):
    """Step 2: confirm a code to enable 2FA."""

    def post(self, request):
        user = request.user
        if not user.totp_secret or not verify_totp(user.totp_secret, request.data.get("code", "")):
            return Response({"detail": "Invalid code."}, status=400)
        user.totp_enabled = True
        user.save(update_fields=["totp_enabled"])
        return Response({"totp_enabled": True})


class TwoFactorDisableView(APIView):
    def post(self, request):
        user = request.user
        if user.totp_enabled and not user.check_password(request.data.get("password", "")):
            return Response({"detail": "Password confirmation required."}, status=400)
        user.totp_secret = ""
        user.totp_enabled = False
        user.save(update_fields=["totp_secret", "totp_enabled"])
        return Response({"totp_enabled": False})


class TwoFactorStatusView(APIView):
    def get(self, request):
        return Response({"totp_enabled": bool(request.user.totp_enabled)})


__all__ = ["MeView", "RegisterView", "UserListView", "LoginView", "TwoFactorLoginView",
           "TwoFactorSetupView", "TwoFactorVerifyView", "TwoFactorDisableView",
           "TwoFactorStatusView", "TokenRefreshView"]
