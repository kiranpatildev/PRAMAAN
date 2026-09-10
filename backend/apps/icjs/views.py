"""ICJS import bridge: pull an external case bundle through the ONE ingestion path.

Every file goes through apps.evidence.services.ingest.create_evidence —
the same function manual uploads use — so hashing, MinIO, Evidence rows,
custody and the process_evidence Celery chain are identical. The only
per-source difference is the custody action (ICJS_IMPORT) and detail.

Case matching rule: import into whatever case_pk the URL names; store
external_case_id on the log for traceability. No auto-create/auto-match.

Progress: transient WS frames on the caller's user_{id} group
(kind="icjs_import_progress") — same socket the alerts bell uses. These
are NOT persistent alerts, so the bell ignores them (see alerts-bell.tsx).
"""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.alerts.services import broadcast
from apps.cases.models import Case
from apps.cases.permissions import user_can_edit_case
from apps.evidence.models import CustodyAction
from apps.evidence.services.ingest import create_evidence

from . import client as icjs_client
from .client import IcjsNotFound, IcjsServiceError
from .models import IcjsImportLog


def _progress(user_id, case_id, external_case_id, import_log_id, **extra):
    broadcast(user_id, {
        "kind": "icjs_import_progress",
        "severity": "info",
        "case_id": case_id,
        "external_case_id": external_case_id,
        "import_log_id": import_log_id,
        **extra,
    })


def _client_ip(request):
    return request.META.get("REMOTE_ADDR")


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def available_cases(request):
    try:
        return Response({"cases": icjs_client.list_cases()})
    except IcjsServiceError as exc:
        return Response({"detail": str(exc)[:300]}, status=502)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def import_case(request, case_pk):
    case = get_object_or_404(Case, pk=case_pk)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    external_case_id = (request.data.get("external_case_id") or "").strip()
    if not external_case_id:
        return Response({"detail": "external_case_id is required."}, status=400)

    log = IcjsImportLog.objects.create(
        case=case, external_case_id=external_case_id, requested_by=request.user)
    user_id = request.user.id

    def fail(reason):
        log.status = "failed"
        log.error_detail = reason[:1000]
        log.completed_at = timezone.now()
        log.save(update_fields=["status", "error_detail", "completed_at"])
        return log

    try:
        files = icjs_client.list_files(external_case_id)
    except IcjsNotFound as exc:
        fail(str(exc))
        return Response({"detail": str(exc)[:300], "import_log_id": log.id}, status=404)
    except IcjsServiceError as exc:
        fail(str(exc))
        return Response({"detail": str(exc)[:300], "import_log_id": log.id}, status=502)

    _progress(user_id, case.id, external_case_id, log.id,
              phase="connected", message="Connected to ICJS")
    _progress(user_id, case.id, external_case_id, log.id,
              phase="case_found", message=f"Case {external_case_id} found",
              file_count=len(files))

    imported = failed = 0
    errors = []
    for entry in files:
        name = entry.get("name", "")
        _progress(user_id, case.id, external_case_id, log.id,
                  phase="fetching", filename=name, message=f"Fetching {name}...")
        try:
            data, content_type = icjs_client.download_file(external_case_id, name)
            ev = create_evidence(
                case,
                file_name=name,
                data=data,
                content_type=content_type or entry.get("content_type", ""),
                uploaded_by=request.user,
                custody_action=CustodyAction.ICJS_IMPORT,
                custody_details={"external_case_id": external_case_id,
                                 "source": "ICJS mock",
                                 "download_url": entry.get("download_url", "")},
                ip=_client_ip(request),
            )
            imported += 1
            _progress(user_id, case.id, external_case_id, log.id,
                      phase="received", filename=name, evidence_id=ev.id,
                      message=f"{name} received")
        except Exception as exc:  # per-file failure must not abort the bundle
            failed += 1
            errors.append(f"{name}: {exc}"[:300])
            _progress(user_id, case.id, external_case_id, log.id,
                      phase="failed", filename=name, error=str(exc)[:300],
                      message=f"{name} failed")

    log.files_imported = imported
    log.files_failed = failed
    log.status = "success" if failed == 0 else ("partial" if imported else "failed")
    log.error_detail = "; ".join(errors)[:1000]
    log.completed_at = timezone.now()
    log.save(update_fields=["files_imported", "files_failed", "status",
                            "error_detail", "completed_at"])
    _progress(user_id, case.id, external_case_id, log.id,
              phase="complete", status=log.status,
              message=f"{imported} files imported — pipeline processing started")
    return Response({
        "external_case_id": external_case_id,
        "case_id": case.id,
        "files_imported": imported,
        "files_failed": failed,
        "status": log.status,
        "import_log_id": log.id,
    })
