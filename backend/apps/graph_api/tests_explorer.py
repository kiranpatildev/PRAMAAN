"""Phase 4 tests: temporal extraction, filtered reads, expand, snapshots, timeline."""
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment

from .models import ExtractedEntity, ExtractedRelation, GraphSnapshot, ReviewStatus
from .services import extract as X


class ParseDatesTests(TestCase):
    def test_formats(self):
        self.assertEqual(X.parse_dates("On 12 March 2026, FIR filed."), ["2026-03-12"])
        self.assertEqual(X.parse_dates("dated 2026-03-13 and 12/03/2026"), ["2026-03-12", "2026-03-13"])
        self.assertEqual(X.parse_dates("Report 5 Jan 26."), [])

    def test_invalid_dropped(self):
        self.assertEqual(X.parse_dates("on 32/13/2026 and 99 March 2026"), [])
        self.assertEqual(X.parse_dates("no dates here"), [])

    def test_relation_carries_sentence_date(self):
        text = "On 12 March 2026, Rahul Sharma met Vikram Patil. Later they talked."
        ents = X.extract_entities(text, 1)
        rels = X.extract_relations(text, ents, 1)
        dated = [r for r in rels if r["valid_from"] == "2026-03-12"]
        self.assertTrue(dated, "first-sentence relations must carry the sentence date")
        self.assertTrue(all(r["valid_from"] is None for r in rels if r not in dated))


class FilteredGraphTests(TestCase):
    def _svc(self):
        from .services.graph_service import GraphService
        return GraphService(uri="bolt://localhost:1", password="x")

    def _driver(self, runs):
        session = mock.MagicMock()
        session.run.side_effect = runs
        driver = mock.MagicMock()
        driver.session.return_value.__enter__.return_value = session
        return driver, session

    def test_filters_reach_cypher(self):
        driver, session = self._driver([[], []])
        with mock.patch.object(type(self._svc()), "_driver", return_value=driver):
            self._svc().get_case_graph(1, node_types=["Person"], min_confidence=0.6,
                                       date_from="2026-03-01", date_to="2026-03-31")
        node_q, edge_q = (c.args[0] for c in session.run.call_args_list)
        self.assertIn("n.node_type IN $types", node_q)
        self.assertIn("r.valid_from >=", edge_q)
        params = session.run.call_args_list[1].kwargs
        self.assertEqual(params["types"], ["Person"])
        self.assertEqual(params["minconf"], 0.6)

    def test_unknown_type_rejected(self):
        with self.assertRaises(ValueError):
            self._svc().get_case_graph(1, node_types=[" Martian "])

    def test_expand_depth_clamped_and_centered(self):
        center = {"key": "1:Person:a", "value": "A", "node_type": "Person",
                  "confidence_score": 0.9, "source_evidence_id": 1}
        nbr = {"key": "1:Person:b", "value": "B", "node_type": "Person",
               "confidence_score": 0.8, "source_evidence_id": 1}
        single = mock.MagicMock()
        single.single.return_value = {"s": center}
        driver, session = self._driver([[{"x": nbr}], [], single])
        with mock.patch.object(type(self._svc()), "_driver", return_value=driver):
            out = self._svc().expand_node(1, "1:Person:a", depth=99)
        depth_q = session.run.call_args_list[0].args[0]
        self.assertIn("*1..3", depth_q)  # clamped, and int-interpolated (no injection)
        self.assertEqual(out["depth"], 3)
        self.assertEqual({n["id"] for n in out["nodes"]}, {"1:Person:a", "1:Person:b"})

    def test_timeline_sorted_events(self):
        rows = [
            {"src": "A", "dst": "B", "type": "CALLED", "valid_from": "2026-03-13",
             "snippet": "s2", "ev": 2, "conf": 0.6},
            {"src": "A", "dst": "C", "type": "MET_AT", "valid_from": "2026-03-12",
             "snippet": "s1", "ev": 1, "conf": 0.5},
        ]
        driver, session = self._driver([rows])
        with mock.patch.object(type(self._svc()), "_driver", return_value=driver):
            out = self._svc().timeline(1)
        # service passes ORDER BY to neo4j; mapping must preserve all fields
        self.assertEqual(out["events"][0]["valid_from"], "2026-03-13")
        self.assertIn("snippet", out["events"][1])
        self.assertIn("source_evidence_id", out["events"][1])


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class SnapshotApiTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho5", Role.SHO)
        self.inv = _mkuser("inv5", Role.INVESTIGATOR)
        self.outsider = _mkuser("out5", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P4-1", title="p4", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        self.a = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="A",
                                                normalized="a", confidence=0.9, status=ReviewStatus.CONFIRMED)
        self.b = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="B",
                                                normalized="b", confidence=0.9, status=ReviewStatus.CONFIRMED)
        ExtractedRelation.objects.create(case=self.case, src=self.a, dst=self.b,
                                         edge_type="CALLED", confidence=0.6, status=ReviewStatus.CONFIRMED)

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def _live(self, nodes, edges):
        return {"nodes": nodes, "edges": edges}

    def test_save_list_diff_delete(self):
        c = self._client(self.inv)
        g1 = self._live([{"id": "k1", "label": "A", "type": "Person"}],
                        [{"id": "k1->CALLED->k2", "source": "k1", "target": "k2", "label": "CALLED"}])
        g2 = self._live([{"id": "k1", "label": "A", "type": "Person"},
                         {"id": "k3", "label": "C", "type": "PhoneNumber"}],
                        [{"id": "k1->CALLED->k3", "source": "k1", "target": "k3", "label": "CALLED"}])
        with mock.patch("apps.graph_api.views_snapshots.GraphService") as GS:
            GS.return_value.get_case_graph.side_effect = [g1, g2]
            s1 = c.post(f"/api/cases/{self.case.id}/graph/snapshots/", {"label": "v1"}).data
            s2 = c.post(f"/api/cases/{self.case.id}/graph/snapshots/",
                        {"label": "phones only", "node_types": ["PhoneNumber"],
                         "min_confidence": 0.5}).data
        self.assertEqual((s1["node_count"], s1["edge_count"]), (1, 1))
        self.assertEqual(s2["filters"]["node_types"], ["PhoneNumber"])
        lst = c.get(f"/api/cases/{self.case.id}/graph/snapshots/").data
        self.assertEqual(len(lst), 2)
        diff = c.get(f"/api/cases/{self.case.id}/graph/snapshots/diff/?a={s1['id']}&b={s2['id']}").data
        self.assertEqual([n["id"] for n in diff["nodes"]["added"]], ["k3"])
        self.assertEqual([e["id"] for e in diff["edges"]["removed"]], ["k1->CALLED->k2"])
        detail = c.get(f"/api/cases/{self.case.id}/graph/snapshots/{s1['id']}/").data
        self.assertIn("data", detail)
        self.assertEqual(c.delete(f"/api/cases/{self.case.id}/graph/snapshots/{s1['id']}/").status_code, 204)
        self.assertFalse(GraphSnapshot.objects.filter(pk=s1["id"]).exists())

    def test_outsider_cannot_snapshot(self):
        c = self._client(self.outsider)
        self.assertEqual(c.get(f"/api/cases/{self.case.id}/graph/snapshots/").status_code, 403)
        self.assertEqual(c.post(f"/api/cases/{self.case.id}/graph/snapshots/",
                                {"label": "x"}).status_code, 403)

    def test_graph_filters_end_to_end(self):
        c = self._client(self.inv)
        with mock.patch("apps.graph_api.views.GraphService") as GS:
            GS.return_value.get_case_graph.return_value = {"nodes": [], "edges": []}
            r = c.get(f"/api/cases/{self.case.id}/graph/?types=Person,Vehicle&min_confidence=0.6"
                      f"&date_from=2026-03-01&date_to=2026-03-31")
        self.assertEqual(r.status_code, 200)
        _, kwargs = GS.return_value.get_case_graph.call_args
        self.assertEqual(kwargs["node_types"], ["Person", "Vehicle"])
        self.assertEqual(kwargs["min_confidence"], 0.6)
        self.assertEqual(kwargs["date_from"], "2026-03-01")

    def test_expand_and_timeline_endpoints(self):
        c = self._client(self.inv)
        with mock.patch("apps.graph_api.views.GraphService") as GS:
            GS.return_value.expand_node.return_value = {"nodes": [], "edges": []}
            GS.return_value.timeline.return_value = {"case_id": self.case.id, "events": []}
            self.assertEqual(c.get(f"/api/cases/{self.case.id}/graph/expand/?node=k1&depth=2").status_code, 200)
            GS.return_value.expand_node.assert_called_with(self.case.id, "k1", 2)
            self.assertEqual(c.get(f"/api/cases/{self.case.id}/timeline/").status_code, 200)
            self.assertEqual(c.get(f"/api/cases/{self.case.id}/graph/expand/").status_code, 400)
