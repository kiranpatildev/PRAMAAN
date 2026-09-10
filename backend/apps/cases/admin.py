from django.contrib import admin

from .models import Case, CaseAssignment, CaseComment, CaseLink, CaseTask

admin.site.register(Case)
admin.site.register(CaseAssignment)
admin.site.register(CaseTask)
admin.site.register(CaseComment)
admin.site.register(CaseLink)
