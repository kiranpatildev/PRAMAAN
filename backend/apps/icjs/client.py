"""HTTP client for the external ICJS case-bundle API (mock in this build).

Stdlib urllib only — no new dependencies. All failures surface as
IcjsServiceError (404s as IcjsNotFound) so the import view can degrade
gracefully instead of crashing. The base URL comes from settings, never
hardcoded: swapping the mock for a real ICJS endpoint is a config change.
"""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


class IcjsServiceError(Exception):
    """Mock ICJS unreachable or misbehaving."""


class IcjsNotFound(IcjsServiceError):
    """Unknown external case id or filename (HTTP 404)."""


def _base() -> str:
    return settings.ICJS_MOCK_BASE_URL.rstrip("/")


def _get_json(path: str, timeout: int = 10):
    try:
        req = Request(_base() + path, headers={"Accept": "application/json"})
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            raise IcjsNotFound(f"not found: {path}")
        raise IcjsServiceError(f"ICJS error {exc.code} on {path}")
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise IcjsServiceError(f"ICJS unreachable ({exc})")


def list_cases() -> list:
    return _get_json("/icjs/cases").get("cases", [])


def get_manifest(case_id: str) -> dict:
    return _get_json(f"/icjs/cases/{case_id}")


def list_files(case_id: str) -> list:
    return _get_json(f"/icjs/cases/{case_id}/files").get("files", [])


def download_file(case_id: str, filename: str, timeout: int = 30) -> tuple[bytes, str]:
    """Return (raw bytes, content type). Raises IcjsServiceError on any failure."""
    from urllib.parse import quote
    url = f"{_base()}/icjs/cases/{case_id}/files/{quote(filename, safe='')}"
    try:
        with urlopen(url, timeout=timeout) as resp:
            return resp.read(), resp.headers.get_content_type()
    except HTTPError as exc:
        if exc.code == 404:
            raise IcjsNotFound(f"file not found: {filename}")
        raise IcjsServiceError(f"ICJS error {exc.code} downloading {filename}")
    except (URLError, TimeoutError, OSError) as exc:
        raise IcjsServiceError(f"ICJS unreachable downloading {filename} ({exc})")
