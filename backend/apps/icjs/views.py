"""ICJS import bridge: pull an external case bundle through the ONE ingestion path.

Importing from ICJS is how a new case gets created — an SHO-only action,
like manual case creation. The flow: fetch manifest.json -> create the Case
-> import each file through apps.evidence.services.ingest.create_evidence
(the same function manual uploads use) -> process_evidence Celery chain.

Failure policy (documented choice): the import loop keeps successes and
marks the log partial/failed, but if NOTHING imported the newly created
case is deleted again so no empty case is left behind. The log row itself
is created first and always survives, so every attempt stays auditable.

Case matching rule: no auto-matching — the manifest populates the new
Case (title, fir_no, station, district, state) and external_case_id is
stored on the log for traceability.

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
from apps.cases.permissions import IsSHO
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
@permission_classes([IsSHO])
def available_cases(request):
    try:
        return Response({"cases": icjs_client.list_cases()})
    except IcjsServiceError as exc:
        return Response({"detail": str(exc)[:300]}, status=502)


@api_view(["POST"])
@permission_classes([IsSHO])
def import_case(request):
    """Import an ICJS bundle as a brand-new case. SHO-only (like case creation)."""
    external_case_id = (request.data.get("external_case_id") or "").strip()
    if not external_case_id:
        return Response({"detail": "external_case_id is required."}, status=400)

    try:
        manifest = icjs_client.get_manifest(external_case_id)
    except IcjsNotFound as exc:
        return Response({"detail": str(exc)[:300]}, status=404)
    except IcjsServiceError as exc:
        return Response({"detail": str(exc)[:300]}, status=502)

    fir_no = (manifest.get("fir_no") or "").strip()
    if not fir_no:
        return Response({"detail": "ICJS manifest has no fir_no; cannot create case."}, status=422)
    if Case.objects.filter(fir_no=fir_no).exists():
        return Response({"detail": f"A case with FIR {fir_no} already exists."}, status=409)

    case = Case.objects.create(
        fir_no=fir_no,
        title=(manifest.get("title") or external_case_id)[:255],
        description=f"Imported from ICJS ({external_case_id}).",
        station=(manifest.get("station") or "")[:128],
        district=(manifest.get("district") or "")[:128],
        state=(manifest.get("state") or "")[:128],
        owner=request.user,
    )
    log = IcjsImportLog.objects.create(
        case=case, external_case_id=external_case_id, requested_by=request.user)
    user_id = request.user.id

    try:
        files = icjs_client.list_files(external_case_id)
    except IcjsServiceError as exc:
        case.delete()
        log.status = "failed"
        log.error_detail = str(exc)[:1000]
        log.completed_at = timezone.now()
        log.save(update_fields=["status", "error_detail", "completed_at"])
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

    if imported == 0:
        # Total failure: remove the empty case again; the log row survives
        # (case FK is nullable precisely so audit outlives the cleanup).
        case_id = case.id
        case.delete()
        log.case = None
        log.status = "failed"
        log.files_imported = 0
        log.files_failed = failed
        log.error_detail = ("No files could be imported; empty case "
                            f"{case_id} removed. " + "; ".join(errors))[:1000]
        log.completed_at = timezone.now()
        log.save(update_fields=["files_imported", "files_failed", "status",
                                "error_detail", "completed_at"])
        _progress(user_id, None, external_case_id, log.id,
                  phase="complete", status=log.status,
                  message="Import failed — no case created")
        return Response({
            "external_case_id": external_case_id,
            "case_id": None,
            "files_imported": 0,
            "files_failed": failed,
            "status": log.status,
            "import_log_id": log.id,
        })

    log.files_imported = imported
    log.files_failed = failed
    log.status = "success" if failed == 0 else "partial"
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
        "fir_no": case.fir_no,
        "files_imported": imported,
        "files_failed": failed,
        "status": log.status,
        "import_log_id": log.id,
    })
