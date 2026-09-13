"""Phase 5 tests: GDS workup (mocked driver), risk math, anomalies, cross-case, API."""
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment
from apps.graph_api.models import ExtractedEntity, ReviewStatus

from .models import RiskReport
from .services import anomalies as AN
from .services import risk as RK


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


class RiskMathTests(TestCase):
    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(RK.WEIGHTS.values()), 1.0)

    def test_hub_outranks_leaf_with_breakdown(self):
        nodes = {
            "k:hub": {"label": "Hub", "type": "Person", "confidence": 0.9,
                      "pagerank": 0.5, "betweenness": 1.0, "degree": 6},
            "k:leaf": {"label": "Leaf", "type": "Person", "confidence": 0.9,
                       "pagerank": 0.1, "betweenness": 0.0, "degree": 1},
        }
        scores = RK.score_nodes(nodes, {"k:hub": 3, "k:leaf": 1})
        self.assertEqual([s["key"] for s in scores], ["k:hub", "k:leaf"])
        hub = scores[0]
        self.assertEqual(hub["level"], "high")
        self.assertAlmostEqual(sum(f["contribution"] for f in hub["factors"]), hub["score"])
        self.assertEqual(len(hub["factors"]), 5)  # every factor explained
        cross = next(f for f in hub["factors"] if f["name"] == "cross_case")
        self.assertEqual(cross["value"], round(min(3 - 1, 3) / 3.0, 4))

    def test_empty_graph_scores_zero(self):
        self.assertEqual(RK.score_nodes({}), [])
        one = RK.score_nodes({"k:a": {}})
        self.assertEqual(len(one), 1)
        self.assertEqual((one[0]["score"], one[0]["level"]), (0.0, "low"))


class AnomalyTests(TestCase):
    def test_hub_outlier(self):
        nodes = {f"k:{i}": {"label": f"N{i}", "degree": 1} for i in range(6)}
        nodes["k:hub"] = {"label": "Hub", "degree": 12}
        found = AN.detect(nodes, [])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["kind"], "hub_outlier")
        self.assertIn("z=", found[0]["explanation"])

    def test_burst(self):
        nodes = {"k:a": {"label": "A"}}
        edges = [{"id": f"e{i}", "source": "k:a", "target": f"k:{i}",
                  "valid_from": "2026-03-15", "snippet": "s", "confidence": 0.8} for i in range(3)]
        found = AN.detect(nodes, edges)
        kinds = [a["kind"] for a in found]
        self.assertIn("contact_burst", kinds)
        burst = next(a for a in found if a["kind"] == "contact_burst")
        self.assertEqual(burst["severity"], "high")
        self.assertEqual(len(burst["evidence"]["edge_ids"]), 3)

    def test_weak_community(self):
        edges = [{"id": "e1", "source": "k:a", "target": "k:b", "confidence": 0.4, "snippet": ""},
                 {"id": "e2", "source": "k:b", "target": "k:c", "confidence": 0.3, "snippet": ""}]
        comms = [{"id": "louvain-1", "members": ["k:a", "k:b", "k:c"]}]
        found = AN.detect({}, edges, comms)
        self.assertEqual([a["kind"] for a in found], ["weak_evidence_community"])

    def test_quiet_graph_no_anomalies(self):
        nodes = {f"k:{i}": {"label": f"N{i}", "degree": 1} for i in range(3)}
        self.assertEqual(AN.detect(nodes, []), [])


class GdsServiceTests(TestCase):
    def _session(self, streams):
        session = mock.MagicMock()

        def _run(query, **kw):
            if "gds.graph.project" in query or "gds.graph.drop" in query:
                return mock.MagicMock()  # .consume() only
            return streams.get(_kind_of(query), [])

        session.run.side_effect = _run
        return session

    def test_mapping_and_bridge_derivation(self):
        from .services import gds as G

        nodes = [
            {"id": "1:Person:a", "label": "A", "type": "Person", "confidence": 0.9,
             "source_evidence_id": 1},
            {"id": "1:Person:b", "label": "B", "type": "Person", "confidence": 0.8,
             "source_evidence_id": 1},
            {"id": "1:Person:c", "label": "C", "type": "Person", "confidence": 0.8,
             "source_evidence_id": 1},
        ]
        streams = {
            "degree": [{"nodeId": 0, "score": 2.0}, {"nodeId": 1, "score": 1.0}, {"nodeId": 2, "score": 1.0}],
            "pagerank": [{"nodeId": 0, "score": 0.5}, {"nodeId": 1, "score": 0.3}, {"nodeId": 2, "score": 0.2}],
            "betweenness": [{"nodeId": 0, "score": 2.0}],
            "wcc": [{"nodeId": 0, "componentId": 0}, {"nodeId": 1, "componentId": 0}, {"nodeId": 2, "componentId": 0}],
            "louvain": [{"nodeId": 0, "communityId": 7}, {"nodeId": 1, "communityId": 7}, {"nodeId": 2, "communityId": 8}],
            "resolve": [{"i": 0, "k": "1:Person:a"}, {"i": 1, "k": "1:Person:b"}, {"i": 2, "k": "1:Person:c"}],
        }
        session = self._session(streams)
        driver = mock.MagicMock()
        driver.session.return_value.__enter__.return_value = session
        driver.execute_query.return_value = [[{"v": "2.9.0"}]]
        with mock.patch("apps.graph_api.services.graph_service.GraphService") as GS:
            GS.return_value.get_case_graph.return_value = {
                "nodes": nodes,
                "edges": [{"source": "1:Person:a", "target": "1:Person:b"},
                          {"source": "1:Person:a", "target": "1:Person:c"}]}
            GS.return_value._driver.return_value = driver
            out = G.case_metrics(1)
        self.assertEqual(out["engine"], "gds-2.9.0")
        self.assertEqual(out["nodes"]["1:Person:a"]["betweenness"], 2.0)
        # A touches communities 7 and 8 -> bridge
        self.assertEqual(len(out["bridges"]), 1)
        self.assertIn("links 2 communities", out["bridges"][0]["kinds"][0])
        drop_calls = [c for c in session.run.call_args_list if "gds.graph.drop" in c.args[0]]
        self.assertTrue(drop_calls, "projection must always be dropped")

    def test_failed_algo_omitted_with_note(self):
        from .services import gds as G

        def boom(q, **kw):
            if "gds.graph.project" in q or "gds.graph.drop" in q:
                return mock.MagicMock()
            if "betweenness" in q:
                raise RuntimeError("nope")
            return []
        session = mock.MagicMock()
        session.run.side_effect = boom
        driver = mock.MagicMock()
        driver.session.return_value.__enter__.return_value = session
        driver.execute_query.return_value = [[{"v": "2.9.0"}]]
        with mock.patch("apps.graph_api.services.graph_service.GraphService") as GS:
            GS.return_value.get_case_graph.return_value = {
                "nodes": [{"id": "1:Person:a", "label": "A", "type": "Person",
                           "confidence": 0.9, "source_evidence_id": 1}],
                "edges": [{"source": "1:Person:a", "target": "1:Person:a"}]}
            GS.return_value._driver.return_value = driver
            out = G.case_metrics(1)
        self.assertTrue(any("betweenness omitted" in n for n in out["notes"]))
        self.assertEqual(out["nodes"]["1:Person:a"]["betweenness"], 0.0)


def _kind_of(query: str) -> str:
    for k in ("degree", "pageRank", "betweenness", "wcc", "louvain"):
        if k in query:
            return {"pageRank": "pagerank"}.get(k, k)
    if "id(n) IN" in query:
        return "resolve"
    return "other"


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class AnalyticsApiTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho6", Role.SHO)
        self.inv = _mkuser("inv6", Role.INVESTIGATOR)
        self.outsider = _mkuser("out6", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P5-1", title="p5", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        self.other = Case.objects.create(fir_no="FIR-P5-2", title="p5b", owner=self.sho)
        # shared entity across both cases (cross-case fixture)
        for case in (self.case, self.other):
            ExtractedEntity.objects.create(case=case, node_type="PhoneNumber", value="999",
                                           normalized="999", confidence=0.9,
                                           status=ReviewStatus.CONFIRMED)

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def _metrics(self):
        return {"case_id": self.case.id, "engine": "gds-x",
                "nodes": {"1:Person:a": {"key": "1:Person:a", "label": "A", "type": "Person",
                                         "confidence": 0.9, "source_evidence_id": 1,
                                         "degree": 2, "pagerank": 0.5, "betweenness": 1.0,
                                         "wcc": 0, "louvain": 3}},
                "bridges": [], "communities": [], "counts": {}, "notes": []}

    def test_overview_risk_anomalies(self):
        c = self._client(self.inv)
        with mock.patch("apps.analytics.services.gds.case_metrics") as CM:
            CM.return_value = self._metrics()
            ov = c.get(f"/api/analytics/case/{self.case.id}/overview/")
            self.assertEqual(ov.status_code, 200)
            self.assertEqual(ov.data["engine"], "gds-x")
            rk = c.get(f"/api/analytics/case/{self.case.id}/risk/")
            self.assertEqual(rk.status_code, 200)
            self.assertEqual(rk.data["scores"][0]["key"], "1:Person:a")
            self.assertIn("factors", rk.data["scores"][0])
            self.assertTrue(RiskReport.objects.filter(case=self.case).exists())  # auto-persisted
            hist = c.get(f"/api/analytics/case/{self.case.id}/risk/history/")
            self.assertEqual(len(hist.data), 1)
        with mock.patch("apps.analytics.services.gds.case_metrics") as CM, \
             mock.patch("apps.analytics.views.GraphService") as GSvc:
            CM.return_value = self._metrics()
            GSvc.return_value.get_case_graph.return_value = {"nodes": [], "edges": []}
            an = c.get(f"/api/analytics/case/{self.case.id}/anomalies/")
            self.assertEqual(an.status_code, 200)
            self.assertIn("anomalies", an.data)

    def test_cross_case_strict_scoping(self):
        sho_c, out_c = self._client(self.sho), self._client(self.outsider)
        sho_hits = sho_c.get("/api/analytics/cross-case/").data["results"]
        self.assertTrue(any(h["normalized"] == "999" and h["case_count"] == 2 for h in sho_hits))
        # outsider sees zero visible cases shared -> hidden cases never leak
        out_hits = out_c.get("/api/analytics/cross-case/").data["results"]
        self.assertFalse(any(h["normalized"] == "999" for h in out_hits))

    def test_forbidden_case(self):
        c = self._client(self.outsider)
        self.assertEqual(c.get(f"/api/analytics/case/{self.case.id}/overview/").status_code, 403)
        self.assertEqual(c.get(f"/api/analytics/case/{self.case.id}/risk/").status_code, 403)


