"""Geo service tests: math + gazetteer (auto-pin stays) + map endpoint."""
import datetime

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.graph_api.services.geo import (
    attach_gazetteer,
    geocode,
    haversine_km,
    hotspots,
    parse_cdr_towers,
)


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

    def test_geocode_hyphenated_towers(self):
        # Additive: exact + space-prefix behavior unchanged (see test_geocode).
        self.assertEqual(geocode("Pune-Kothrud")[:2], (18.5204, 73.8567))
        self.assertEqual(geocode("Pune-Kothrud")[2], "gazetteer-city")
        self.assertEqual(geocode("Mumbai_Andheri")[2], "gazetteer-city")
        self.assertIsNone(geocode("Cell-9X"))

    def test_parse_cdr_towers(self):
        text = ("calling,called_party,date,duration_sec,tower\n"
                "9876543210,9123456780,2026-03-13,184,Pune-Kothrud\n"
                "9123456780,9811112233,garbage,42,Mumbai-Andheri\n"
                "9876543210,9811112233,2026-03-14,10,\n")
        rows = parse_cdr_towers(text)
        self.assertEqual(rows, [
            {"tower": "Pune-Kothrud", "date": "2026-03-13"},
            {"tower": "Mumbai-Andheri", "date": None},
        ])

    def test_parse_cdr_towers_no_tower_column(self):
        self.assertEqual(parse_cdr_towers("a,b\n1,2\n"), [])
        self.assertEqual(parse_cdr_towers(""), [])
        self.assertEqual(parse_cdr_towers("not csv at all"), [])

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


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class MapPointsTests(TestCase):
    def setUp(self):
        from apps.accounts.models import Role, User
        from apps.cases.models import Case, CaseAssignment
        from apps.evidence.models import Evidence

        self.sho = User.objects.create_user("map_sho", password="pw123456", role=Role.SHO)
        self.inv = User.objects.create_user("map_inv", password="pw123456",
                                            role=Role.INVESTIGATOR)
        self.inv2 = User.objects.create_user("map_inv2", password="pw123456",
                                             role=Role.INVESTIGATOR)
        self.out = User.objects.create_user("map_out", password="pw123456",
                                            role=Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-MAP-1", title="map", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit",
                                      assigned_by=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv2, permission="edit",
                                      assigned_by=self.sho)
        blob = b"map"
        self.stmt = Evidence.objects.create(
            case=self.case, file_name="stmt.txt", mime_type="text/plain", size_bytes=3,
            sha256=Evidence.hash_bytes(blob), storage_key="k-map-1", uploaded_by=self.inv,
            file_type="witness_statement", ocr_status="done")
        self.cdr = Evidence.objects.create(
            case=self.case, file_name="dump.csv", mime_type="text/csv", size_bytes=3,
            sha256=Evidence.hash_bytes(b"cdr"), storage_key="k-map-2", uploaded_by=self.inv,
            file_type="cdr", ocr_status="done")
        E = self.case.extracted_entities
        self.rahul = E.create(node_type="Person", value="Rahul Sharma",
                              normalized="rahul sharma", confidence=0.9, evidence=self.stmt)
        self.pune = E.create(node_type="Location", value="Pune", normalized="pune",
                             confidence=0.8, evidence=self.stmt,
                             latitude=18.52, longitude=73.85, geo_source="gazetteer")
        self.mumbai = E.create(node_type="Location", value="Mumbai", normalized="mumbai",
                               confidence=0.8, evidence=self.stmt,
                               latitude=19.07, longitude=72.87, geo_source="gazetteer")
        self.tower = E.create(node_type="Location", value="Pune-Kothrud tower",
                              normalized="pune-kothrud tower", confidence=0.7,
                              evidence=self.cdr, latitude=18.53, longitude=73.86,
                              geo_source="manual")
        self.nowhere = E.create(node_type="Location", value="Xanadu", normalized="xanadu",
                                confidence=0.5, evidence=self.stmt)
        R = self.case.extracted_relations
        R.create(src=self.rahul, dst=self.pune, edge_type="PRESENT_AT", confidence=0.6,
                 snippet="s0", evidence=self.stmt, valid_from=None)
        R.create(src=self.rahul, dst=self.mumbai, edge_type="PRESENT_AT", confidence=0.5,
                 snippet="s1", evidence=self.stmt, valid_from=datetime.date(2026, 3, 12))
        self.rej = E.create(node_type="Person", value="Ghost", normalized="ghost",
                            confidence=0.9, evidence=self.stmt, status="rejected")
        R.create(src=self.rej, dst=self.pune, edge_type="PRESENT_AT", confidence=0.9,
                 snippet="sx", evidence=self.stmt, valid_from=datetime.date(2026, 3, 13))

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_suspects_device_unlocated(self):
        r = self._client(self.inv).get(f"/api/cases/{self.case.id}/map/")
        self.assertEqual(r.status_code, 200)
        d = r.data
        # One suspect (rejected Ghost excluded); dated Mumbai presence
        # beats the undated Pune one.
        self.assertEqual(len(d["suspects"]), 1)
        s = d["suspects"][0]
        self.assertEqual(s["value"], "Rahul Sharma")
        self.assertEqual((s["lat"], s["lng"]), (19.07, 72.87))
        self.assertEqual(s["place"], "Mumbai")
        self.assertEqual(s["date"], "2026-03-12")
        # One device ping: the CDR-sourced tower (statement-sourced Pune excluded).
        self.assertEqual(len(d["device_pings"]), 1)
        self.assertEqual(d["device_pings"][0]["value"], "Pune-Kothrud tower")
        self.assertEqual(d["device_pings"][0]["evidence_file"], "dump.csv")
        # One unlocated place.
        self.assertEqual([u["value"] for u in d["unlocated"]], ["Xanadu"])
        self.assertEqual(d["counts"], {"suspects": 1, "device_pings": 1,
                                       "towers": 0, "unlocated": 1})

    def test_outsider_forbidden(self):
        r = self._client(self.out).get(f"/api/cases/{self.case.id}/map/")
        self.assertEqual(r.status_code, 403)

    def test_movements_trail_oldest_first(self):
        r = self._client(self.inv).get(
            f"/api/cases/{self.case.id}/map/movements/?entity_id={self.rahul.id}")
        self.assertEqual(r.status_code, 200)
        t = r.data["trail"]
        # Undated Pune presence excluded (no timeline position); dated only.
        self.assertEqual([(p["location"], p["date"]) for p in t], [("Mumbai", "2026-03-12")])
        self.assertEqual((t[0]["lat"], t[0]["lng"]), (19.07, 72.87))
        self.assertEqual(r.data["value"], "Rahul Sharma")

    def test_movements_ordering(self):
        # (case, src, dst, edge) is unique, so the extra dated row uses the
        # tower place; the per-(place, date) best-confidence rule stays as
        # defensive code for merged-import futures.
        R = self.case.extracted_relations
        R.create(src=self.rahul, dst=self.tower, edge_type="PRESENT_AT", confidence=0.9,
                 snippet="s2", evidence=self.stmt, valid_from=datetime.date(2026, 3, 10))
        r = self._client(self.inv).get(
            f"/api/cases/{self.case.id}/map/movements/?entity_id={self.rahul.id}")
        trail = [(p["location"], p["date"], p["confidence"]) for p in r.data["trail"]]
        self.assertEqual(trail, [("Pune-Kothrud tower", "2026-03-10", 0.9),
                                 ("Mumbai", "2026-03-12", 0.5)])

    def test_movements_rejected_and_unlocated_excluded(self):
        R = self.case.extracted_relations
        R.create(src=self.rahul, dst=self.nowhere, edge_type="PRESENT_AT", confidence=0.9,
                 snippet="sx", evidence=self.stmt, valid_from=datetime.date(2026, 3, 11))
        ghost_rel = R.create(src=self.rahul, dst=self.tower, edge_type="PRESENT_AT",
                             confidence=0.9, snippet="sy", evidence=self.stmt,
                             valid_from=datetime.date(2026, 3, 11))
        ghost_rel.status = "rejected"
        ghost_rel.save(update_fields=["status"])
        r = self._client(self.inv).get(
            f"/api/cases/{self.case.id}/map/movements/?entity_id={self.rahul.id}")
        self.assertEqual([(p["location"], p["date"]) for p in r.data["trail"]],
                         [("Mumbai", "2026-03-12")])

    def test_movements_guards(self):
        c = self._client(self.inv)
        self.assertEqual(c.get(f"/api/cases/{self.case.id}/map/movements/").status_code, 400)
        self.assertEqual(c.get(
            f"/api/cases/{self.case.id}/map/movements/?entity_id=999999").status_code, 404)
        self.assertEqual(c.get(
            f"/api/cases/{self.case.id}/map/movements/?entity_id={self.pune.id}").status_code, 400)
        self.assertEqual(self._client(self.out).get(
            f"/api/cases/{self.case.id}/map/movements/?entity_id={self.rahul.id}").status_code, 403)

    def test_nearby_hits_sorted_windowed(self):
        base = f"/api/cases/{self.case.id}/map/nearby/?lat=18.53&lng=73.86&radius_km=5"
        c = self._client(self.inv)
        r = c.get(base)
        self.assertEqual(r.status_code, 200)
        hits = r.data["hits"]
        # Undated Pune presence only (Mumbai is 120 km out; Ghost rejected).
        self.assertEqual(len(hits), 1)
        h = hits[0]
        self.assertEqual(h["person"], "Rahul Sharma")
        self.assertEqual(h["location"], "Pune")
        self.assertIsNone(h["date"])
        self.assertEqual(h["entity_id"], self.rahul.id)
        self.assertIn("key", h)
        dists = [x["dist_km"] for x in hits]
        self.assertEqual(dists, sorted(dists))
        # A dated May sighting at the tower is excluded by a June window;
        # the undated row still passes.
        R = self.case.extracted_relations
        R.create(src=self.rahul, dst=self.tower, edge_type="PRESENT_AT", confidence=0.9,
                 snippet="s9", evidence=self.stmt, valid_from=datetime.date(2026, 5, 1))
        june = c.get(base + "&date_from=2026-06-01").data["hits"]
        self.assertEqual([(x["location"], x["date"]) for x in june], [("Pune", None)])

    def test_nearby_undated_passes(self):
        r = self._client(self.inv).get(
            f"/api/cases/{self.case.id}/map/nearby/?lat=18.52&lng=73.85"
            f"&radius_km=1&date_from=2026-01-01&date_to=2026-01-31")
        hits = [(h["person"], h["date"]) for h in r.data["hits"]]
        # Undated Pune presence passes the January window; dated Mumbai does not.
        self.assertIn(("Rahul Sharma", None), hits)
        self.assertNotIn("Mumbai", [h["location"] for h in r.data["hits"]])
        # Rejected Ghost's pending Pune edge never accuses.
        self.assertNotIn("Ghost", [h["person"] for h in r.data["hits"]])

    def test_nearby_guards(self):
        c = self._client(self.inv)
        self.assertEqual(c.get(f"/api/cases/{self.case.id}/map/nearby/").status_code, 400)
        self.assertEqual(c.get(
            f"/api/cases/{self.case.id}/map/nearby/?lat=nope&lng=73.86").status_code, 400)
        self.assertEqual(self._client(self.out).get(
            f"/api/cases/{self.case.id}/map/nearby/?lat=18.53&lng=73.86").status_code, 403)

    def test_nearby_non_person_subjects_excluded(self):
        R = self.case.extracted_relations
        org = self.case.extracted_entities.create(
            node_type="Organization", value="Sharma Transports",
            normalized="sharma transports", confidence=0.8, evidence=self.stmt)
        R.create(src=org, dst=self.pune, edge_type="PRESENT_AT", confidence=0.9,
                 snippet="so", evidence=self.stmt, valid_from=datetime.date(2026, 3, 12))
        r = self._client(self.inv).get(
            f"/api/cases/{self.case.id}/map/nearby/?lat=18.52&lng=73.85&radius_km=5")
        self.assertNotIn("Sharma Transports", [h["person"] for h in r.data["hits"]])

    def test_locate_happy_path_sets_manual(self):
        # Response shape reuses the original entity_locate contract verbatim
        # (note "lng", not "longitude").
        c = self._client(self.inv2)
        r = c.patch(f"/api/cases/{self.case.id}/entities/{self.nowhere.id}/locate/",
                    {"latitude": 19.0, "longitude": 73.0}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, {"id": self.nowhere.id, "latitude": 19.0,
                                 "lng": 73.0, "geo_source": "manual"})
        self.nowhere.refresh_from_db()
        self.assertEqual((self.nowhere.latitude, self.nowhere.longitude,
                          self.nowhere.geo_source), (19.0, 73.0, "manual"))
        # Newly pinned place leaves the unlocated list.
        mp = c.get(f"/api/cases/{self.case.id}/map/").data
        self.assertNotIn("Xanadu", [u["value"] for u in mp["unlocated"]])

    def test_locate_permissions(self):
        out_c = self._client(self.out)
        self.assertEqual(out_c.patch(
            f"/api/cases/{self.case.id}/entities/{self.nowhere.id}/locate/",
            {"latitude": 1, "longitude": 1}, format="json").status_code, 403)
        sho_c = self._client(self.sho)
        self.assertEqual(sho_c.patch(
            f"/api/cases/{self.case.id}/entities/{self.nowhere.id}/locate/",
            {"latitude": 1, "longitude": 1}, format="json").status_code, 200)

    def test_locate_validation(self):
        c = self._client(self.inv2)
        base = f"/api/cases/{self.case.id}/entities/"
        self.assertEqual(c.patch(base + f"{self.rahul.id}/locate/",
                                 {"latitude": 1, "longitude": 1},
                                 format="json").status_code, 400)  # Person
        self.assertEqual(c.patch(base + f"{self.nowhere.id}/locate/",
                                 {"latitude": 999, "longitude": 0},
                                 format="json").status_code, 400)  # range
        self.assertEqual(c.patch(base + f"{self.nowhere.id}/locate/",
                                 {"latitude": 1}, format="json").status_code, 400)  # missing
        self.assertEqual(c.patch(base + f"{self.nowhere.id}/locate/",
                                 {"latitude": "x", "longitude": 1},
                                 format="json").status_code, 400)  # non-numeric
        self.assertEqual(c.patch(base + "999999/locate/",
                                 {"latitude": 1, "longitude": 1},
                                 format="json").status_code, 404)

    def test_locate_cross_case_is_404(self):
        from apps.cases.models import Case, CaseAssignment
        other = Case.objects.create(fir_no="FIR-MAP-X", title="x", owner=self.sho)
        CaseAssignment.objects.create(case=other, user=self.inv2, permission="edit",
                                      assigned_by=self.sho)
        # self.nowhere belongs to self.case, not other: 404, not 403 (no leak
        # either way — and a true outsider still gets 403, covered above).
        r = self._client(self.inv2).patch(
            f"/api/cases/{other.id}/entities/{self.nowhere.id}/locate/",
            {"latitude": 1, "longitude": 1}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_empty_case(self):
        from apps.cases.models import Case
        empty = Case.objects.create(fir_no="FIR-MAP-2", title="empty", owner=self.sho)
        r = self._client(self.sho).get(f"/api/cases/{empty.id}/map/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["counts"], {"suspects": 0, "device_pings": 0,
                                            "towers": 0, "unlocated": 0})

    def test_towers_from_cdr_columns(self):
        from apps.evidence.models import Evidence
        blob = ("calling,called_party,date,duration_sec,tower\n"
                "9876543210,9123456780,2026-03-13,184,Pune-Kothrud\n"
                "9123456780,9811112233,2026-03-13,42,Pune-Kothrud\n"
                "9876543210,9811112233,not-a-date,305,Mumbai-Andheri\n"
                "9876543210,9811112233,2026-03-14,10,\n").encode()
        Evidence.objects.create(
            case=self.case, file_name="towers.csv", mime_type="text/csv",
            size_bytes=len(blob), sha256=Evidence.hash_bytes(blob),
            storage_key="k-map-tw", uploaded_by=self.inv2, file_type="cdr",
            ocr_status="done", ocr_text=blob.decode())
        r = self._client(self.inv2).get(f"/api/cases/{self.case.id}/map/")
        towers = {t["tower"]: t for t in r.data["towers"]}
        # Grouped per (tower, date); hyphenated names inherit the city.
        self.assertEqual(towers["Pune-Kothrud"]["count"], 2)
        self.assertEqual(towers["Pune-Kothrud"]["date"], "2026-03-13")
        self.assertEqual((towers["Pune-Kothrud"]["lat"], towers["Pune-Kothrud"]["lng"]),
                         (18.5204, 73.8567))
        self.assertEqual(towers["Pune-Kothrud"]["source"], "gazetteer-city")
        # Bad date degrades to undated, empty tower cell skipped.
        self.assertEqual(towers["Mumbai-Andheri"]["date"], None)
        self.assertEqual(r.data["counts"]["towers"], 2)

    def test_towers_require_cdr_evidence(self):
        # Same CSV under a non-CDR file_type contributes no tower pins.
        from apps.evidence.models import Evidence
        blob = "calling,called_party,date,tower\n1,2,2026-03-13,Pune-Kothrud\n".encode()
        Evidence.objects.create(
            case=self.case, file_name="notes.txt", mime_type="text/plain",
            size_bytes=len(blob), sha256=Evidence.hash_bytes(blob),
            storage_key="k-map-nt", uploaded_by=self.inv2, file_type="witness_statement",
            ocr_status="done", ocr_text=blob.decode())
        r = self._client(self.inv2).get(f"/api/cases/{self.case.id}/map/")
        self.assertEqual(r.data["counts"]["towers"], 0)
