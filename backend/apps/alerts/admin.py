from django.contrib import admin

from .models import Alert, AlertRule, Notification

admin.site.register(Alert)
admin.site.register(AlertRule)
admin.site.register(Notification)
