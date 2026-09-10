"""Phase 7 geo tests: math, gazetteer, endpoints, locate perms."""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment
from apps.graph_api.models import ExtractedEntity, ExtractedRelation, ReviewStatus
from apps.graph_api.services.geo import geocode, haversine_km, hotspots


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


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


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class GeoApiTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho11", Role.SHO)
        self.inv = _mkuser("inv11", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P7-3", title="p7geo", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        self.pune = ExtractedEntity.objects.create(case=self.case, node_type="Location", value="Pune",
                                                   normalized="pune", confidence=0.8, latitude=18.52,
                                                   longitude=73.85, geo_source="gazetteer")
        self.nowhere = ExtractedEntity.objects.create(case=self.case, node_type="Location", value="Xanadu",
                                                      normalized="xanadu", confidence=0.5)
        self.person = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="Rahul Sharma",
                                                     normalized="rahul sharma", confidence=0.8)
        import datetime
        self.rel = ExtractedRelation.objects.create(
            case=self.case, src=self.person, dst=self.pune, edge_type="PRESENT_AT",
            confidence=0.6, snippet="met in Pune", valid_from=datetime.date(2026, 3, 12))

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_points_and_unlocated(self):
        c = self._client(self.inv)
        r = c.get(f"/api/cases/{self.case.id}/geo/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["points"]), 1)
        self.assertEqual(r.data["points"][0]["label"], "Pune")
        self.assertEqual(len(r.data["unlocated"]), 1)

    def test_movements(self):
        c = self._client(self.inv)
        key = f"{self.case.id}:Person:rahul sharma"
        r = c.get(f"/api/cases/{self.case.id}/geo/movements/?person={key}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["trail"]), 1)
        self.assertEqual(r.data["trail"][0]["date"], "2026-03-12")
        self.assertEqual(c.get(f"/api/cases/{self.case.id}/geo/movements/").status_code, 400)

    def test_nearby_window(self):
        c = self._client(self.inv)
        base = f"/api/cases/{self.case.id}/geo/nearby/?lat=18.53&lng=73.86&radius_km=5"
        self.assertEqual(len(c.get(base).data["hits"]), 1)
        self.assertEqual(len(c.get(base + "&date_from=2026-04-01").data["hits"]), 0)  # window excludes
        self.assertEqual(len(c.get(base + "&radius_km=0.01").data["hits"]), 0)  # too tight
        self.assertEqual(c.get(f"/api/cases/{self.case.id}/geo/nearby/").status_code, 400)

    def test_locate(self):
        inv_c, out_c = self._client(self.inv), self._client(_mkuser("out11", Role.INVESTIGATOR))
        self.assertEqual(out_c.patch(f"/api/entities/review/entities/{self.nowhere.id}/locate/",
                                     {"latitude": 1, "longitude": 1}, format="json").status_code, 403)
        r = inv_c.patch(f"/api/entities/review/entities/{self.nowhere.id}/locate/",
                        {"latitude": 19.0, "longitude": 73.0}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["geo_source"], "manual")
        bad = inv_c.patch(f"/api/entities/review/entities/{self.nowhere.id}/locate/",
                          {"latitude": 999, "longitude": 0}, format="json")
        self.assertEqual(bad.status_code, 400)
        notloc = inv_c.patch(f"/api/entities/review/entities/{self.person.id}/locate/",
                             {"latitude": 19.0, "longitude": 73.0}, format="json")
        self.assertEqual(notloc.status_code, 400)
