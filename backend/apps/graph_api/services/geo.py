"""Geo helpers (Phase 7): gazetteer, haversine, hotspot grid.

Coordinates come from a built-in gazetteer of Indian cities (auto-attached at
extraction, `gazetteer`) or investigator correction (`manual`). Grid
hotspots are demo-grade on purpose; PostGIS is installed and ready when
case volumes outgrow Python-side math.
"""
from __future__ import annotations

import math

# normalized name -> (lat, lng)
GAZETTEER: dict[str, tuple[float, float]] = {
    "pune": (18.5204, 73.8567),
    "mumbai": (19.0760, 72.8777),
    "nagpur": (21.1458, 79.0882),
    "nashik": (19.9975, 73.7898),
    "thane": (19.2183, 72.9781),
    "sambhajinagar": (19.8762, 75.3433),
    "aurangabad": (19.8762, 75.3433),
    "solapur": (17.6599, 75.9064),
    "kolhapur": (16.7050, 74.2433),
    "surat": (21.1702, 72.8311),
    "ahmedabad": (23.0225, 72.5714),
    "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090),
    "jaipur": (26.9124, 75.7873),
    "lucknow": (26.8467, 80.9462),
    "bhopal": (23.2599, 77.4126),
    "patna": (25.5941, 85.1376),
    "hyderabad": (17.3850, 78.4867),
    "bengaluru": (12.9716, 80.5946),
    "bangalore": (12.9716, 80.5946),
    "chennai": (13.0827, 80.2707),
    "kolkata": (22.5726, 88.3639),
    "pune railway station": (18.5289, 73.8744),
    "mumbai central": (18.9690, 72.8194),
}


def geocode(normalized: str) -> tuple[float, float, str] | None:
    """Return (lat, lng, source) or None. City-prefix matches (e.g. 'pune ...')
    inherit the city with a weaker source tag."""
    norm = (normalized or "").strip().lower()
    if norm in GAZETTEER:
        lat, lng = GAZETTEER[norm]
        return lat, lng, "gazetteer"
    for city, (lat, lng) in GAZETTEER.items():
        if " " not in city and norm.startswith(city + " "):
            return lat, lng, "gazetteer-city"
    return None


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def hotspots(points: list[dict], cell: float = 0.5) -> list[dict]:
    """Grid-cluster points; cells with >=2 points become hotspots."""
    cells: dict[tuple[float, float], list[dict]] = {}
    for p in points:
        if p.get("lat") is None or p.get("lng") is None:
            continue
        cells.setdefault((round(p["lat"] / cell) * cell, round(p["lng"] / cell) * cell), []).append(p)
    out = []
    for (lat, lng), members in cells.items():
        if len(members) >= 2:
            out.append({"lat": lat, "lng": lng, "count": len(members),
                        "members": [m["label"] for m in members]})
    return sorted(out, key=lambda h: -h["count"])


def attach_gazetteer(entity) -> bool:
    """Auto-pin known places at extraction; returns True when attached.

    Lives here (not in a view module) so the extraction pipeline and the
    backfill command use it without importing HTTP code. The geo HTTP
    endpoints were cut (no map UI); auto-pinning stays as pipeline behavior.
    """
    if entity.node_type != "Location" or entity.latitude is not None:
        return False
    hit = geocode(entity.normalized)
    if hit is None:
        return False
    entity.latitude, entity.longitude, entity.geo_source = hit[0], hit[1], hit[2]
    entity.save(update_fields=["latitude", "longitude", "geo_source", "updated_at"])
    return True
