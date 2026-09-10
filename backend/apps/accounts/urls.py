from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    LoginView,
    MeView,
    RegisterView,
    TwoFactorDisableView,
    TwoFactorLoginView,
    TwoFactorSetupView,
    TwoFactorStatusView,
    TwoFactorVerifyView,
    UserListView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("login/2fa/", TwoFactorLoginView.as_view(), name="login-2fa"),
    path("2fa/setup/", TwoFactorSetupView.as_view(), name="2fa-setup"),
    path("2fa/verify/", TwoFactorVerifyView.as_view(), name="2fa-verify"),
    path("2fa/disable/", TwoFactorDisableView.as_view(), name="2fa-disable"),
    path("2fa/status/", TwoFactorStatusView.as_view(), name="2fa-status"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("register/", RegisterView.as_view(), name="register"),
    path("users/", UserListView.as_view(), name="users"),
]
