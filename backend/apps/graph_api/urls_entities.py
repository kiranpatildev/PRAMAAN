from django.urls import path

from . import views_entities, views_geo, views_review

urlpatterns = [
    path("", views_entities.entity_search, name="entity-search"),
    path("review/queue/", views_review.review_queue, name="review-queue"),
    path("review/entities/", views_review.review_entities, name="review-entities"),
    path("review/entities/<int:pk>/", views_review.review_entity_decide, name="review-entity-decide"),
    path("review/entities/<int:pk>/locate/", views_geo.entity_locate, name="review-entity-locate"),
    path("review/relations/", views_review.review_relations, name="review-relations"),
    path("review/relations/<int:pk>/", views_review.review_relation_decide, name="review-relation-decide"),
    path("review/merges/", views_review.merge_list, name="merge-list"),
    path("review/merges/<int:pk>/", views_review.merge_decide, name="merge-decide"),
    path("<str:pk>/", views_entities.entity_detail, name="entity-detail"),
]
