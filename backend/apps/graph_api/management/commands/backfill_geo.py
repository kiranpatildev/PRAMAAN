"""Backfill gazetteer coordinates onto Location rows extracted pre-Phase-7."""
from django.core.management.base import BaseCommand

from apps.graph_api.models import ExtractedEntity
from apps.graph_api.views_geo import attach_gazetteer


class Command(BaseCommand):
    help = "Pin known-place coordinates on Location entities missing them."

    def handle(self, *args, **opts):
        n = 0
        qs = ExtractedEntity.objects.filter(node_type="Location", latitude__isnull=True)
        for ent in qs.iterator():
            if attach_gazetteer(ent):
                n += 1
        self.stdout.write(self.style.SUCCESS(f"Pinned {n} location(s)."))
