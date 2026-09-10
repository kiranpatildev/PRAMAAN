"""(Re)build the RAG index for evidence with extracted text.

Usage:
  python manage.py reindex --all
  python manage.py reindex --fir FIR-2026-1000
"""
from django.core.management.base import BaseCommand

from apps.cases.models import Case
from apps.evidence.models import Evidence
from apps.evidence.tasks import index_evidence


class Command(BaseCommand):
    help = "Chunk + embed evidence ocr_text into DocumentChunk rows."

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument("--all", action="store_true")
        group.add_argument("--fir", type=str, default="")

    def handle(self, *args, **opts):
        qs = Evidence.objects.exclude(ocr_text="").select_related("case")
        if opts["fir"]:
            try:
                case = Case.objects.get(fir_no=opts["fir"])
            except Case.DoesNotExist:
                self.stderr.write(f"unknown FIR {opts['fir']}")
                return
            qs = qs.filter(case=case)
        total_chunks = total_embedded = n = 0
        for ev in qs.iterator():
            res = index_evidence(ev.id)
            if res.get("status") == "ok":
                n += 1
                total_chunks += res.get("chunks", 0)
                total_embedded += res.get("embedded", 0)
        self.stdout.write(self.style.SUCCESS(
            f"Indexed {n} evidence file(s): {total_chunks} chunks, {total_embedded} embedded."))
