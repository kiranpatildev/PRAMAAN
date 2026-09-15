"""PRAMAAN settings — Phase 1 foundations.

Assumptions (documented per build prompt §10):
- Postgres is system-of-record; Neo4j writes go through graph_service only.
- AES-256 field encryption is software-level (Fernet w/ key from env); no TEE.
- 2FA/TOTP, pgvector embeddings, GDS analytics land in later phases behind stubs.
"""
import os
from datetime import timedelta
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-insecure-change-me")
if SECRET_KEY == "dev-insecure-change-me" and os.environ.get("DEBUG", "1") != "1":
    import logging
    logging.getLogger(__name__).warning(
        "Running with the default SECRET_KEY outside DEBUG — set SECRET_KEY in production.")
DEBUG = os.environ.get("DEBUG", "1") == "1"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "django.contrib.postgres",
    "drf_spectacular",
    "channels",
    "apps.accounts",
    "apps.cases",
    "apps.evidence",
    "apps.graph_api",
    "apps.analytics",
    "apps.copilot",
    "apps.search",
    "apps.system",
    "apps.alerts",
    "apps.reports",
    "apps.auditlog",
    "apps.icjs",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.auditlog.middleware.AuditLogMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": [
            "django.template.context_processors.debug",
            "django.template.context_processors.request",
            "django.contrib.auth.context_processors.auth",
            "django.contrib.messages.context_processors.messages",
        ]},
    }
]

DATABASES = {"default": dj_database_url.parse(
    os.environ.get("DATABASE_URL", "postgres://pramaan:pramaan@localhost:5432/pramaan"),
    conn_max_age=600,
)}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# DRF + JWT
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
        # NL-to-Cypher copilot: per-user LLM-cost guard (one model call per
        # question; throttle is defense in depth, mirroring LoginThrottle).
        "graph_query": "30/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
}

CORS_ALLOWED_ORIGINS = [o for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o]
CORS_ALLOW_CREDENTIALS = True

# Celery (each AI stage = separate task w/ typed contracts; see evidence/tasks.py, graph_api/tasks.py)
CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TASK_ALWAYS_EAGER = os.environ.get("CELERY_EAGER", "0") == "1"

# Neo4j (only touched via graph_api.services.graph_service)
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "pramaan-neo4j")

# MinIO / S3-compatible evidence store
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "pramaan")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "pramaan123")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "evidence")
MINIO_SECURE = os.environ.get("MINIO_SECURE", "0") == "1"

# Software-level AES-256 field encryption key (Fernet, base64). Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FIELD_ENCRYPTION_KEY = os.environ.get("FIELD_ENCRYPTION_KEY", "")

# Gemini LLM / embeddings (Phase 6, key-optional). Without GEMINI_API_KEY the
# copilot answers extractively over keyword retrieval (labeled, never faked).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "6"))

# External ICJS case-bundle API (mock in this build, real endpoint later).
# Pluggable by config: swapping the mock for a real ICJS system is a URL
# change, not a rewrite — apps/icjs only ever reads this setting.
ICJS_MOCK_BASE_URL = os.environ.get("ICJS_MOCK_BASE_URL", "http://mock-icjs:9090")

# Multilingual NER (Phase 3): HuggingFace checkpoint for the Indic path.
# Default ai4bharat/IndicNER is ACCESS-GATED (requires HF approval) — without
# access the loader raises IndicUnavailable and extraction records
# "unsupported_language" instead of guessing. Override with any public
# token-classification checkpoint (e.g. a per-language NER model) — the
# loader reads id2label dynamically and skips labels outside PER/LOC/ORG.
INDIC_NER_MODEL_ID = os.environ.get("INDIC_NER_MODEL_ID", "ai4bharat/IndicNER")

SPECTACULAR_SETTINGS = {"TITLE": "PRAMAAN API", "VERSION": "0.1.0 (Phase 1)"}

# Channels (Phase 7: redis-backed so worker <-> web fan-out crosses processes).
def _redis_channel_config():
    from urllib.parse import urlparse
    url = urlparse(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    return {"hosts": [(url.hostname or "localhost", url.port or 6379)]}


CHANNEL_LAYERS = {"default": {"BACKEND": "channels_redis.core.RedisChannelLayer",
                              "CONFIG": _redis_channel_config()}}
