from django.contrib import admin

from apps.accounts.models import User
from apps.alerts.models import Alert
from apps.auditlog.models import AuditLog
from apps.cases.models import Case, CaseAssignment
from apps.evidence.models import Evidence

for model in (User, Case, CaseAssignment, Evidence, Alert, AuditLog):
    try:
        admin.site.register(model)
    except admin.sites.AlreadyRegistered:
        pass
