"""Geo-spatial intelligence (Phase 7): points, movements, nearby, hotspots."""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_edit_case, user_can_view_case

from .models import ExtractedEntity, ExtractedRelation
from .services.geo import geocode, haversine_km, hotspots


def _case_or_403(request, case_id):
    case = get_object_or_404(Case, pk=case_id)
    if not user_can_view_case(request.user, case):
        return None, Response({"detail": "Forbidden."}, status=403)
    return case, None


def _point(ent):
    return {
        "key": ent.graph_key or f"{ent.case_id}:{ent.node_type}:{ent.normalized}",
        "label": ent.value, "type": ent.node_type, "confidence": ent.confidence,
        "lat": ent.latitude, "lng": ent.longitude, "geo_source": ent.geo_source,
        "evidence_id": ent.evidence_id,
        "evidence_file": ent.evidence.file_name if ent.evidence_id else "",
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def geo_points(request, case_pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    locs = (ExtractedEntity.objects.filter(case=case, node_type="Location")
            .exclude(status="rejected").select_related("evidence"))
    points = [_point(e) for e in locs if e.latitude is not None and e.longitude is not None]
    unlocated = [{"key": _point(e)["key"], "label": e.value, "confidence": e.confidence} for e in locs
                 if e.latitude is None or e.longitude is None]
    return Response({"case_id": case.id, "points": points, "unlocated": unlocated,
                     "hotspots": hotspots(points)})


def _present_at(case):
    return (ExtractedRelation.objects.filter(case=case, edge_type="PRESENT_AT")
            .exclude(status="rejected")
            .select_related("src", "dst", "evidence"))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def geo_movements(request, case_pk):
    """Dated location trail for one person (PRESENT_AT edges, oldest first)."""
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    person_key = request.query_params.get("person")
    if not person_key:
        return Response({"detail": "person query param (node key) is required."}, status=400)
    trail = []
    for rel in _present_at(case):
        src_key = rel.src.graph_key or f"{case.id}:{rel.src.node_type}:{rel.src.normalized}"
        if src_key != person_key:
            continue
        dst = rel.dst
        if dst.latitude is None:
            continue
        trail.append({
            "location": dst.value, "lat": dst.latitude, "lng": dst.longitude,
            "date": rel.valid_from.isoformat() if rel.valid_from else None,
            "snippet": rel.snippet, "evidence_id": rel.evidence_id,
            "evidence_file": rel.evidence.file_name if rel.evidence_id else "",
        })
    trail.sort(key=lambda t: (t["date"] is None, t["date"] or ""))
    return Response({"case_id": case.id, "person": person_key, "trail": trail})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def geo_nearby(request, case_pk):
    """Geo-temporal correlation: who was near (lat,lng) inside a date window."""
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    try:
        lat = float(request.query_params["lat"])
        lng = float(request.query_params["lng"])
        radius = float(request.query_params.get("radius_km", 5))
    except (KeyError, TypeError, ValueError):
        return Response({"detail": "lat, lng (and optional radius_km) required."}, status=400)
    date_from = request.query_params.get("date_from") or "0001-01-01"
    date_to = request.query_params.get("date_to") or "9999-12-31"
    hits = []
    for rel in _present_at(case):
        dst = rel.dst
        if dst.latitude is None:
            continue
        day = rel.valid_from.isoformat() if rel.valid_from else None
        if day is not None and not (date_from <= day <= date_to):
            continue
        dist = haversine_km(lat, lng, dst.latitude, dst.longitude)
        if dist <= radius:
            hits.append({
                "person": rel.src.value, "person_key": rel.src.graph_key,
                "location": dst.value, "dist_km": round(dist, 2), "date": day,
                "snippet": rel.snippet, "evidence_id": rel.evidence_id,
            })
    hits.sort(key=lambda h: h["dist_km"])
    return Response({"case_id": case.id, "lat": lat, "lng": lng, "radius_km": radius,
                     "hits": hits[:100]})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def entity_locate(request, pk):
    """Investigator correction: pin coordinates on a Location entity."""
    try:
        ent = ExtractedEntity.objects.select_related("case").get(pk=pk)
    except ExtractedEntity.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    if not user_can_edit_case(request.user, ent.case):
        return Response({"detail": "Forbidden."}, status=403)
    if ent.node_type != "Location":
        return Response({"detail": "Only Location entities take coordinates."}, status=400)
    try:
        lat = float(request.data["latitude"])
        lng = float(request.data["longitude"])
    except (KeyError, TypeError, ValueError):
        return Response({"detail": "latitude/longitude numbers required."}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return Response({"detail": "coordinates out of range."}, status=400)
    ent.latitude, ent.longitude, ent.geo_source = lat, lng, "manual"
    ent.save(update_fields=["latitude", "longitude", "geo_source", "updated_at"])
    return Response({"id": ent.id, "latitude": lat, "longitude": lng, "geo_source": "manual"})


def attach_gazetteer(entity) -> bool:
    """Auto-pin known places at extraction; returns True when attached."""
    if entity.node_type != "Location" or entity.latitude is not None:
        return False
    hit = geocode(entity.normalized)
    if hit is None:
        return False
    entity.latitude, entity.longitude, entity.geo_source = hit[0], hit[1], hit[2]
    entity.save(update_fields=["latitude", "longitude", "geo_source", "updated_at"])
    return True
