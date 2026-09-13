"""Geo service tests: math + gazetteer (HTTP endpoints cut; auto-pin stays)."""
from django.test import TestCase

from apps.graph_api.services.geo import attach_gazetteer, geocode, haversine_km, hotspots


class GeoMathTests(TestCase):
    def test_haversine_pune_mumbai(self):
        d = haversine_km(18.5204, 73.8567, 19.0760, 72.8777)
        self.assertTrue(100 < d < 150, d)  # ~120 km

    def test_geocode(self):
        self.assertEqual(geocode("pune")[:2], (18.5204, 73.8567))
        self.assertEqual(geocode("Pune Railway Station")[2], "gazetteer")  # exact gazetteer key
        self.assertEqual(geocode("Pune Camp Area")[2], "gazetteer-city")  # city-prefix fallback
        self.assertIsNone(geocode("atlantis"))

    def test_hotspots(self):
        pts = [{"label": "a", "lat": 18.5, "lng": 73.8},
               {"label": "b", "lat": 18.6, "lng": 73.9},
               {"label": "far", "lat": 28.6, "lng": 77.2}]
        hs = hotspots(pts)
        self.assertEqual(len(hs), 1)
        self.assertEqual(hs[0]["count"], 2)

    def test_attach_gazetteer_pins_known_places(self):
        from apps.accounts.models import User
        from apps.cases.models import Case

        owner = User.objects.create_user("geo_owner", password="pw123456")
        case = Case.objects.create(fir_no="FIR-GEO-1", title="geo-pin", owner=owner)
        loc = case.extracted_entities.create(node_type="Location", value="Pune",
                                             normalized="pune", confidence=0.8)
        self.assertTrue(attach_gazetteer(loc))
        self.assertEqual((loc.latitude, loc.longitude), (18.5204, 73.8567))
        self.assertEqual(loc.geo_source, "gazetteer")
