from django.contrib import admin

from .models import ExtractedEntity, ExtractedRelation, GraphSnapshot, MergeSuggestion

admin.site.register(ExtractedEntity)
admin.site.register(ExtractedRelation)
admin.site.register(MergeSuggestion)
admin.site.register(GraphSnapshot)
