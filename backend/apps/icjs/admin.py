from django.contrib import admin

from .models import IcjsImportLog


@admin.register(IcjsImportLog)
class IcjsImportLogAdmin(admin.ModelAdmin):
    list_display = ("id", "external_case_id", "case", "status",
                    "files_imported", "files_failed", "requested_by", "started_at")
    list_filter = ("status",)
    readonly_fields = ("started_at", "completed_at")
