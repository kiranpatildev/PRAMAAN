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
    """Generate the court-ready evidence package PDF (stored in MinIO + row)."""
    import uuid

    from apps.evidence.models import Evidence
    from apps.evidence.services import storage

    from .services.package import build_evidence_package

    case = get_object_or_404(Case, pk=request.data.get("case_id"))
    if not user_can_view_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    try:
        pdf = build_evidence_package(case, generated_by=str(request.user))
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
