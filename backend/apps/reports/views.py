import io

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_edit_case, user_can_view_case

from .models import Report


class ReportSerializer(serializers.ModelSerializer):
    created_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Report
        fields = ("id", "case", "kind", "storage_key", "sha256", "size_bytes",
                  "created_by", "created_at")
        read_only_fields = fields


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def report_list(request):
    from apps.cases.permissions import visible_case_ids
    allowed = visible_case_ids(request.user)
    qs = Report.objects.select_related("case", "created_by").all()
    if allowed is not None:
        qs = qs.filter(case_id__in=allowed)
    case_id = request.query_params.get("case_id")
    if case_id:
        qs = qs.filter(case_id=case_id)
    return Response(ReportSerializer(qs[:50], many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def case_package(request):
    """Generate the court-ready evidence package PDF (stored in MinIO + row).

    JSON `{case_id}` keeps the exhibit-free behavior byte-comparable.
    Multipart adds an optional `exhibit` image (PNG/JPEG, ≤5 MB) + label:
    stored as photo evidence first (custody trail intact), then embedded in
    the PDF with a matching SHA-256 caption — map snapshots included.
    """
    import uuid
    from datetime import datetime, timezone

    from apps.evidence.models import Evidence
    from apps.evidence.services import storage

    from .services.package import MAX_EXHIBIT_BYTES, EXHIBIT_MIMES, build_evidence_package

    case = get_object_or_404(Case, pk=request.data.get("case_id"))
    if not user_can_view_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    exhibits = []
    upload = request.FILES.get("exhibit")
    if upload is not None:
        if upload.content_type not in EXHIBIT_MIMES:
            return Response({"detail": "exhibit must be PNG or JPEG."}, status=400)
        if upload.size > MAX_EXHIBIT_BYTES:
            return Response({"detail": "exhibit exceeds 5 MB."}, status=400)
        from apps.evidence.services.ingest import create_evidence
        blob = upload.read()
        try:
            ev = create_evidence(
                case, file_name=upload.name or "map-exhibit.png", data=blob,
                content_type=upload.content_type, uploaded_by=request.user,
                file_type="photo", ip=request.META.get("REMOTE_ADDR"))
        except ValueError as exc:
            return Response({"detail": str(exc)[:200]}, status=400)
        exhibits = [{"label": (request.data.get("exhibit_label") or "Map view")[:120],
                     "png_bytes": blob, "sha256": ev.sha256,
                     "captured_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}]
    try:
        pdf = build_evidence_package(case, generated_by=str(request.user),
                                     exhibits=exhibits or None)
    except Exception as exc:
        return Response({"detail": f"Report build failed: {exc}"[:300]}, status=500)
    key = f"reports/case_{case.id}/{uuid.uuid4().hex}_evidence-package.pdf"
    try:
        storage.upload_bytes(key, pdf, "application/pdf")
        url = storage.presigned_get_url(key, expires=7 * 24 * 3600)
    except Exception as exc:
        return Response({"detail": f"Object store unavailable: {exc}"[:200]}, status=503)
    rep = Report.objects.create(
        case=case, kind="evidence_package", storage_key=key,
        sha256=Evidence.hash_bytes(pdf), size_bytes=len(pdf), created_by=request.user)
    data = ReportSerializer(rep).data
    data["download_url"] = url
    return Response(data, status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def report_download(request, pk):
    from apps.evidence.services import storage

    try:
        rep = Report.objects.select_related("case").get(pk=pk)
    except Report.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    if not user_can_view_case(request.user, rep.case):
        return Response({"detail": "Forbidden."}, status=403)
    try:
        raw = storage.download_bytes(rep.storage_key)
    except Exception as exc:
        return Response({"detail": f"Object store unavailable: {exc}"[:200]}, status=503)
    return FileResponse(io.BytesIO(raw), as_attachment=True,
                        filename=f"{rep.case.fir_no}-evidence-package.pdf",
                        content_type="application/pdf")
