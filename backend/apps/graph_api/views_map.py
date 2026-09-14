"""Case map data (Map tab): suspects + device pings + movement trails + nearby.

Nothing faked: trails are dated PRESENT_AT edges to located places, oldest
first; undated presences have no timeline position and are excluded (the
suspect pin itself still shows them as "date unknown"). Nearby revives the
cut geo_nearby correlation with the same undated-passes-window rule the
rest of the codebase uses.

Layer derivation (no new stored category — computed from reviewed rows):
  suspects ......... Person rows (rejected excluded) with a PRESENT_AT edge
                     to a located Location; pin = the LATEST presence
                     (newest valid_from, undated counts as oldest).
  device_pings ..... located Location rows whose evidence is CDR-type
                     (file_type "cdr"): tower-observed positions. Today this
                     is the only device-adjacent source in the pipeline;
                     GPS-grade pings arrive with a device feed (follow-up).
  towers ........... CDR tower-column mentions (parse_cdr_towers) geocoded
                     through the gazetteer (hyphen-tolerant city fallback);
                     grouped per (tower, date) with row counts. Unlocatable
                     towers are skipped, never invented.
  unlocated ........ Location rows (rejected excluded) missing coordinates.

Density heatmaps render client-side from these same points (MapLibre
heatmap layer) so filters apply instantly — no separate backend math.

Scoped exactly like every other case endpoint: _case_or_403 first.
"""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_edit_case, user_can_view_case

from .models import ExtractedEntity, ExtractedRelation
from .services.geo import geocode, parse_cdr_towers


def _case_or_403(request, case_id):
    case = get_object_or_404(Case, pk=case_id)
    if not user_can_view_case(request.user, case):
        return None, Response({"detail": "Forbidden."}, status=403)
    return case, None


def _key(ent, case_id):
    return ent.graph_key or f"{case_id}:{ent.node_type}:{ent.normalized}"


def _latest_presence(person, located_by_id):
    """Newest non-rejected PRESENT_AT edge to a located place (or None)."""
    best = None
    for rel in (ExtractedRelation.objects
                .filter(case_id=person.case_id, edge_type="PRESENT_AT", src=person)
                .exclude(status="rejected")
                .select_related("dst", "evidence")):
        if rel.dst_id not in located_by_id:
            continue
        if best is None:
            best = rel
            continue
        a, b = rel.valid_from, best.valid_from
        if (a is not None and b is None) or (a is not None and b is not None and a > b):
            best = rel
    return best


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def map_points(request, case_pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    locs = list(ExtractedEntity.objects
                .filter(case=case, node_type="Location")
                .exclude(status="rejected")
                .select_related("evidence"))
    located = [e for e in locs if e.latitude is not None and e.longitude is not None]
    located_by_id = {e.id: e for e in located}

    suspects = []
    for person in (ExtractedEntity.objects
                   .filter(case=case, node_type="Person")
                   .exclude(status="rejected")
                   .select_related("evidence")
                   .order_by("-confidence")):
        rel = _latest_presence(person, located_by_id)
        if rel is None:
            continue
        place = located_by_id[rel.dst_id]
        suspects.append({
            "entity_id": person.id,
            "key": _key(person, case.id),
            "value": person.value,
            "confidence": person.confidence,
            "engine": person.engine,
            "status": person.status,
            "lat": place.latitude,
            "lng": place.longitude,
            "place_id": place.id,
            "place": place.value,
            "place_source": place.geo_source,
            "date": rel.valid_from.isoformat() if rel.valid_from else None,
            "evidence_id": rel.evidence_id,
            "evidence_file": rel.evidence.file_name if rel.evidence_id else "",
        })

    device_pings = [{
        "entity_id": e.id,
        "key": _key(e, case.id),
        "value": e.value,
        "confidence": e.confidence,
        "engine": e.engine,
        "status": e.status,
        "lat": e.latitude,
        "lng": e.longitude,
        "geo_source": e.geo_source,
        "evidence_id": e.evidence_id,
        "evidence_file": e.evidence.file_name if e.evidence_id else "",
    } for e in located if e.evidence_id and e.evidence.file_type == "cdr"]

    unlocated = [{"entity_id": e.id, "value": e.value, "confidence": e.confidence}
                 for e in locs if e.latitude is None or e.longitude is None]

    towers = _tower_points(case)

    return Response({
        "case_id": case.id,
        "suspects": suspects,
        "device_pings": device_pings,
        "towers": towers,
        "unlocated": unlocated,
        "counts": {"suspects": len(suspects), "device_pings": len(device_pings),
                   "towers": len(towers), "unlocated": len(unlocated)},
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def map_movements(request, case_pk):
    """Dated location trail for one suspect, oldest first.

    `?entity_id=` must be a Person of this case. Only non-rejected
    PRESENT_AT edges with a real date to a located place qualify — one
    entry per (place, date), best confidence wins. Anything else (wrong
    case, non-Person, missing id) is 404/400, never an empty-looking trail.
    """
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    try:
        entity_id = int(request.query_params.get("entity_id", ""))
    except (TypeError, ValueError):
        return Response({"detail": "entity_id query param is required."}, status=400)
    try:
        person = ExtractedEntity.objects.select_related("evidence").get(
            pk=entity_id, case=case)
    except ExtractedEntity.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    if person.node_type != "Person":
        return Response({"detail": "Trails play for Person entities."}, status=400)
    best: dict[tuple[int, str], dict] = {}
    for rel in (ExtractedRelation.objects
                .filter(case=case, edge_type="PRESENT_AT", src=person)
                .exclude(status="rejected")
                .exclude(valid_from__isnull=True)
                .select_related("dst", "evidence")
                .order_by("valid_from", "id")):
        dst = rel.dst
        if dst.latitude is None or dst.longitude is None:
            continue
        key = (dst.id, rel.valid_from.isoformat())
        if key not in best or rel.confidence > best[key]["confidence"]:
            best[key] = {
                "place_id": dst.id,
                "location": dst.value,
                "lat": dst.latitude,
                "lng": dst.longitude,
                "date": rel.valid_from.isoformat(),
                "confidence": rel.confidence,
                "evidence_file": rel.evidence.file_name if rel.evidence_id else "",
            }
    trail = [best[k] for k in sorted(best, key=lambda k: (k[1], k[0]))]
    return Response({"case_id": case.id, "entity_id": person.id,
                     "value": person.value, "trail": trail})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def map_locate(request, case_pk, eid):
    """Investigator correction: drag-a-pin writes coordinates + manual source.

    Validation reused verbatim from the cut entity_locate (Location-only,
    numeric lat/lng, range-checked, edit permission): the only delta is
    case-scoped binding — an entity of another case is 404, never 403
    (no existence leak across cases).
    """
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    try:
        ent = ExtractedEntity.objects.get(pk=eid, case=case)
    except ExtractedEntity.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    if not user_can_edit_case(request.user, case):
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
    return Response({"id": ent.id, "latitude": lat, "lng": lng, "geo_source": "manual"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def map_nearby(request, case_pk):
    """Geo-temporal correlation: who was near (lat, lng) in a date window.

    Revival of the cut geo_nearby logic: haversine over PRESENT_AT edges to
    located places, sorted by distance, capped at 100. Undated presences
    pass any window (same rule as the graph reads); dated ones must fall
    inside. Two hardening deltas vs the original, both documented: subjects
    are restricted to Person rows (the answer is literally keyed "person"),
    and each hit carries the entity id/key for the frontend drawer.
    """
    from .services.geo import haversine_km

    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    try:
        lat = float(request.query_params["lat"])
        lng = float(request.query_params["lng"])
        radius = float(request.query_params.get("radius_km", 5))
    except (KeyError, TypeError, ValueError):
        return Response({"detail": "lat, lng (and optional radius_km) required."},
                        status=400)
    date_from = request.query_params.get("date_from") or "0001-01-01"
    date_to = request.query_params.get("date_to") or "9999-12-31"
    hits = []
    for rel in (ExtractedRelation.objects
                .filter(case=case, edge_type="PRESENT_AT", src__node_type="Person")
                .exclude(status="rejected")
                .exclude(src__status="rejected")
                .exclude(dst__status="rejected")
                .select_related("src", "dst", "evidence")):
        dst = rel.dst
        if dst.latitude is None or dst.longitude is None:
            continue
        day = rel.valid_from.isoformat() if rel.valid_from else None
        if day is not None and not (date_from <= day <= date_to):
            continue
        dist = haversine_km(lat, lng, dst.latitude, dst.longitude)
        if dist <= radius:
            hits.append({
                "entity_id": rel.src_id,
                "key": _key(rel.src, case.id),
                "person": rel.src.value,
                "location": dst.value,
                "lat": dst.latitude,
                "lng": dst.longitude,
                "dist_km": round(dist, 2),
                "date": day,
                "evidence_file": rel.evidence.file_name if rel.evidence_id else "",
            })
    hits.sort(key=lambda h: h["dist_km"])
    return Response({"case_id": case.id, "lat": lat, "lng": lng,
                     "radius_km": radius, "hits": hits[:100]})


def _tower_points(case):
    """CDR tower-column mentions -> located pins, grouped per (tower, date)."""
    from apps.evidence.models import Evidence

    grouped: dict[tuple[str, str | None], dict] = {}
    order: list[tuple[str, str | None]] = []
    for ev in (Evidence.objects.filter(case=case, file_type="cdr")
               .order_by("id")[:50]):
        for hit in parse_cdr_towers(ev.ocr_text or ""):
            geo = geocode(hit["tower"])
            if geo is None:
                continue  # unlocatable tower: skipped, never invented
            key = (hit["tower"].strip().lower(), hit["date"])
            if key not in grouped:
                grouped[key] = {
                    "tower": hit["tower"].strip(),
                    "lat": geo[0], "lng": geo[1], "source": geo[2],
                    "date": hit["date"], "count": 0,
                    "evidence_id": ev.id, "evidence_file": ev.file_name,
                }
                order.append(key)
            grouped[key]["count"] += 1
    return [{**grouped[k],
             "key": f"{case.id}:tower:{k[0]}:{k[1] or 'undated'}"} for k in order]
