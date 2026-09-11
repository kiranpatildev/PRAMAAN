"""Evidence ingestion API (Phase 2): multipart upload -> MinIO -> Celery pipeline.

Flow: POST bytes -> sha256 -> MinIO put (inline, demo scale) -> Evidence row ->
ChainOfCustody(UPLOADED) -> process_evidence.delay (ingest verify, classify,
OCR). Pipeline stages degrade gracefully when the object store is down; POST
{c pk}/reprocess/ retries later.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_contribute_case, user_can_edit_case, user_can_view_case

from .models import ChainOfCustody, CustodyAction, Evidence
from .serializers import ChainOfCustodySerializer, EvidenceSerializer


def _client_ip(request):
    return request.META.get("REMOTE_ADDR")


class EvidenceViewSet(viewsets.ModelViewSet):
    serializer_class = EvidenceSerializer

    def get_case(self):
        return Case.objects.get(pk=self.kwargs.get("case_pk") or self.kwargs.get("pk"))

    def get_queryset(self):
        try:
            case = self.get_case()
        except Case.DoesNotExist:
            return Evidence.objects.none()
        if not user_can_view_case(self.request.user, case):
            return Evidence.objects.none()
        return Evidence.objects.filter(case=case).select_related("uploaded_by")

    def _case_or_error(self, request):
        try:
            case = self.get_case()
        except Case.DoesNotExist:
            return None, Response({"detail": "Case not found."}, status=404)
        return case, None

    def list(self, request, *args, **kwargs):
        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_view_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_view_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        response = super().retrieve(request, *args, **kwargs)
        ChainOfCustody.log(self.get_object(), request.user, CustodyAction.VIEWED, ip=_client_ip(request))
        return response

    def create(self, request, *args, **kwargs):
        from apps.evidence.services.ingest import create_evidence

        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_contribute_case(request.user, case):
            return Response({"detail": "Only investigators assigned to this case can upload evidence."}, status=403)
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "Provide multipart 'file'."}, status=400)
        try:
            ev = create_evidence(
                case,
                file_name=request.data.get("file_name", upload.name) or upload.name,
                data=upload.read(),
                content_type=upload.content_type or "",
                uploaded_by=request.user,
                file_type=request.data.get("file_type", "other"),
                ip=_client_ip(request),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(EvidenceSerializer(ev).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        from apps.evidence.services import storage

        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        ev = self.get_object()
        ChainOfCustody.log(ev, request.user, CustodyAction.DELETED,
                           {"file_name": ev.file_name, "sha256": ev.sha256}, ip=_client_ip(request))
        storage.delete_object(ev.storage_key)  # best-effort inside
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def custody(self, request, *args, **kwargs):
        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_view_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        entries = self.get_object().custody_entries.select_related("actor").all()
        return Response(ChainOfCustodySerializer(entries, many=True).data)

    @action(detail=True, methods=["get"])
    def download(self, request, *args, **kwargs):
        from apps.evidence.services import storage

        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_view_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        ev = self.get_object()
        try:
            url = storage.presigned_get_url(ev.storage_key)
        except Exception as exc:
            return Response({"detail": f"Object store unavailable: {exc}"[:300]}, status=503)
        ChainOfCustody.log(ev, request.user, CustodyAction.DOWNLOADED, ip=_client_ip(request))
        return Response({"url": url, "file_name": ev.file_name, "sha256": ev.sha256})

    @action(detail=True, methods=["post"])
    def reprocess(self, request, *args, **kwargs):
        from .tasks import process_evidence

        case, err = self._case_or_error(request)
        if err:
            return err
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        ev = self.get_object()
        ev.processing_error = ""
        ev.ocr_status = "pending"
        ev.save(update_fields=["processing_error", "ocr_status", "updated_at"])
        ChainOfCustody.log(ev, request.user, CustodyAction.REPROCESSED, ip=_client_ip(request))
        process_evidence.delay(ev.id)
        ev.refresh_from_db()
        return Response(EvidenceSerializer(ev).data)
