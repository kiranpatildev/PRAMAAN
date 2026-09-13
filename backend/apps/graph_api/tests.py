"""Phase 3 tests: extraction, resolution, review queue, graph build.

spaCy-dependent assertions are skipped when en_core_web_sm is absent
(regex-only mode must still pass everything else).
"""
import unittest
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment

from .models import ExtractedEntity, ExtractedRelation, MergeStatus, MergeSuggestion, ReviewStatus
from .services import extract as X
from .services.resolve import SUGGEST_THRESHOLD, find_merge_candidates, match_score, person_score

SPACY = X.get_nlp() is not None
skip_no_spacy = unittest.skipIf(not SPACY, "en_core_web_sm absent (regex-only mode)")


class NormalizeTests(TestCase):
    def test_phone(self):
        self.assertEqual(X.normalize_value("PhoneNumber", "+91 98765 43210"), "9876543210")
        self.assertEqual(X.normalize_value("PhoneNumber", "9876543210"), "9876543210")

    def test_plate(self):
        self.assertEqual(X.normalize_value("Vehicle", "MH-12-AB-1234"), "MH12AB1234")

    def test_person_title(self):
        self.assertEqual(X.normalize_value("Person", "Shri Rahul Sharma"), "rahul sharma")


class RegexExtractTests(TestCase):
    def test_phones_and_plates(self):
        ents = X.extract_entities("Call 9876543210 about MH12AB1234.", 1)
        by_type = {(e["node_type"], e["normalized"]) for e in ents}
        self.assertIn(("PhoneNumber", "9876543210"), by_type)
        self.assertIn(("Vehicle", "MH12AB1234"), by_type)

    def test_every_edge_has_provenance(self):
        ents = X.extract_entities("Rahul Sharma called 9876543210.", 7)
        for e in ents:
            self.assertEqual(e["source_evidence_id"], 7)
            self.assertIn("confidence", e)
        rels = X.extract_relations("Rahul Sharma called 9876543210.", ents, 7)
        for r in rels:
            self.assertTrue(r["snippet"])
            self.assertEqual(r["source_evidence_id"], 7)

    @skip_no_spacy
    def test_name_fallback_and_alias_owns(self):
        text = "Vikram Patil also contacted Amit Verma on 9811112233. Amit owns MH01CD0001."
        ents = X.extract_entities(text, 1)
        names = {e["value"] for e in ents if e["node_type"] == "Person"}
        self.assertIn("Amit Verma", names)
        rels = X.extract_relations(text, ents, 1)
        owns = [r for r in rels if r["edge_type"] == "OWNS"]
        self.assertTrue(any(r["src_value"] == "Amit Verma" for r in owns))

    @skip_no_spacy
    def test_money_org_to_person_and_direction(self):
        text = "Sharma Transports paid Rs 50,000 to Vikram Patil. Rahul Sharma met Vikram Patil."
        ents = X.extract_entities(text, 1)
        rels = X.extract_relations(text, ents, 1)
        money = [r for r in rels if r["edge_type"] == "TRANSFERRED_MONEY_TO"]
        self.assertEqual(len(money), 1)
        self.assertEqual((money[0]["src_value"], money[0]["dst_value"]),
                         ("Sharma Transports", "Vikram Patil"))
        called_or_assoc = [r for r in rels if r["edge_type"] == "ASSOCIATED_WITH"]
        self.assertTrue(all(r["src_value"] == "Rahul Sharma" for r in called_or_assoc))


class ResolveUnitTests(TestCase):
    def test_person_scores(self):
        self.assertEqual(person_score("rahul sharma", "rahul sharma"), (0.95, "exact-name"))
        self.assertEqual(person_score("r. sharma", "rahul sharma"), (0.80, "initial-surname"))
        self.assertEqual(person_score("rahul sharma", "vikram patil"), (0.0, ""))
        self.assertEqual(person_score("rahul sharma", "rahul verma"), (0.0, ""))

    def test_type_scores(self):
        self.assertEqual(match_score("PhoneNumber", "9876543210", "9876543210")[0], 1.0)
        self.assertEqual(match_score("PhoneNumber", "9876543210", "9123456780")[0], 0.0)
        self.assertEqual(match_score("Vehicle", "mh12ab1234", "mh12ab1234")[0], 1.0)
        self.assertEqual(match_score("Event", "2026-03-12", "2026-03-13")[0], 0.0)

    def test_blocking_finds_initial_variant(self):
        ents = [
            SimpleNamespace(id=1, node_type="Person", normalized="rahul sharma", value="Rahul Sharma"),
            SimpleNamespace(id=2, node_type="Person", normalized="r. sharma", value="R. Sharma"),
            SimpleNamespace(id=3, node_type="Person", normalized="vikram patil", value="Vikram Patil"),
        ]
        sug = find_merge_candidates(ents)
        self.assertEqual(len(sug), 1)
        self.assertGreaterEqual(sug[0]["score"], SUGGEST_THRESHOLD)
        self.assertEqual(sug[0]["reason"], "initial-surname")


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class PipelineTaskTests(TestCase):
    def setUp(self):
        from apps.evidence.models import Evidence
        self.sho = _mkuser("sho3", Role.SHO)
        self.case = Case.objects.create(fir_no="FIR-P3-1", title="p3", owner=self.sho)
        blob = b"x"
        self.ev = Evidence.objects.create(
            case=self.case, file_name="note.txt", mime_type="text/plain", size_bytes=1,
            sha256=Evidence.hash_bytes(blob), storage_key="k", uploaded_by=self.sho,
            ocr_status="done", ocr_engine="raw-text",
            ocr_text="Rahul Sharma called Vikram Patil from 9876543210 about MH12AB1234.")

    def test_extract_idempotent(self):
        from .tasks import extract_entities, extract_relations, resolve_entities
        r1 = extract_entities(self.ev.id)
        self.assertEqual(r1["status"], "ok")
        self.assertGreaterEqual(r1["entities"], 3)
        n_before = ExtractedEntity.objects.filter(case=self.case).count()
        extract_entities(self.ev.id)  # re-run: no dup rows, mention_count grows
        self.assertEqual(ExtractedEntity.objects.filter(case=self.case).count(), n_before)
        r2 = extract_relations(self.ev.id)
        self.assertEqual(r2["status"], "ok")
        self.assertGreaterEqual(r2["relations"], 1)
        r3 = resolve_entities(self.case.id)
        self.assertEqual(r3["status"], "ok")

    def test_build_writes_only_confirmed(self):
        from .tasks import build_temporal_graph, extract_entities
        extract_entities(self.ev.id)
        with mock.patch("apps.graph_api.services.graph_service.GraphService") as GS:
            out = build_temporal_graph(self.case.id)
        self.assertEqual(out["nodes_written"], 0)  # nothing confirmed yet
        GS.return_value.upsert_entity.assert_not_called()
        ExtractedEntity.objects.filter(case=self.case).update(status=ReviewStatus.CONFIRMED)
        with mock.patch("apps.graph_api.services.graph_service.GraphService") as GS:
            out = build_temporal_graph(self.case.id)
        self.assertGreater(out["nodes_written"], 0)
        # every node write carries the temporal-evidence contract
        for call in GS.return_value.upsert_entity.call_args_list:
            props = call.args[2]
            for field in ("confidence_score", "source_evidence_id", "extracted_by"):
                self.assertIn(field, props)

    def test_graph_service_cypher_shape(self):
        from apps.graph_api.services.graph_service import GraphService
        svc = GraphService(uri="bolt://localhost:1", password="x")
        session = mock.MagicMock()
        driver = mock.MagicMock()
        driver.session.return_value.__enter__.return_value = session
        with mock.patch("neo4j.GraphDatabase.driver", return_value=driver):
            with mock.patch.object(GraphService, "_driver", return_value=driver):
                svc.upsert_entity(1, "Person", {"value": "Rahul Sharma", "normalized": "rahul sharma",
                                                "confidence_score": 0.75, "source_evidence_id": 9,
                                                "extracted_by": "review-confirm:spacy"})
        cypher = session.run.call_args.args[0]
        self.assertIn("MERGE", cypher)
        self.assertIn(":Person", cypher)
        params = session.run.call_args.kwargs
        self.assertEqual(params["key"], "1:Person:rahul sharma")

    def test_unreachable_neo4j_raises_unavailable(self):
        from apps.graph_api.services.graph_service import GraphService, GraphUnavailable
        svc = GraphService(uri="bolt://localhost:1", password="x")
        with self.assertRaises(GraphUnavailable):
            svc.get_case_graph(1)

    def test_merge_nodes_sets_scalar_identity(self):
        from apps.graph_api.services.graph_service import GraphService
        svc = GraphService(uri="bolt://localhost:1", password="x")
        session = mock.MagicMock()
        driver = mock.MagicMock()
        driver.session.return_value.__enter__.return_value = session
        with mock.patch.object(GraphService, "_driver", return_value=driver):
            svc.merge_nodes("1:Person:rahul sharma", "1:Person:r. sharma",
                            {"node_type": "Person", "value": "Rahul Sharma"})
        cypher = session.run.call_args.args[0]
        self.assertIn("apoc.refactor.mergeNodes", cypher)
        self.assertIn("SET node.key = $surv", cypher)  # no list-valued keys after combine

    def test_read_tolerates_list_props(self):
        from apps.graph_api.services.graph_service import GraphService
        svc = GraphService(uri="bolt://localhost:1", password="x")
        node = {"key": ["1:Person:a", "1:Person:b"], "value": "A",
                "node_type": "Person", "confidence_score": [0.8, 0.7],
                "source_evidence_id": 3}
        session = mock.MagicMock()
        session.run.side_effect = [[{"n": node}], []]
        driver = mock.MagicMock()
        driver.session.return_value.__enter__.return_value = session
        with mock.patch.object(GraphService, "_driver", return_value=driver):
            out = svc.get_case_graph(1)
        self.assertEqual(out["nodes"][0]["id"], "1:Person:a")
        self.assertEqual(out["nodes"][0]["confidence"], 0.8)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class ReviewApiTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho4", Role.SHO)
        self.inv = _mkuser("inv4", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P3-2", title="p3b", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        self.a = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="Rahul Sharma",
                                                normalized="rahul sharma", confidence=0.75, engine="spacy")
        self.b = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="R. Sharma",
                                                normalized="r. sharma", confidence=0.75, engine="spacy")
        self.rel = ExtractedRelation.objects.create(case=self.case, src=self.a, dst=self.b,
                                                    edge_type="ASSOCIATED_WITH", confidence=0.55, snippet="s")
        self.ms = MergeSuggestion.objects.create(case=self.case, entity_a=self.a, entity_b=self.b,
                                                 score=0.8, reason="initial-surname")

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_review_queue_and_confirm_triggers_build(self):
        c = self._client(self.inv)
        lst = c.get(f"/api/entities/review/entities/?case_id={self.case.id}&status=pending")
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.data["results"]), 2)
        with mock.patch("apps.graph_api.services.graph_service.GraphService") as GS:
            ok = c.post(f"/api/cases/{self.case.id}/entities/{self.a.id}/confirm/")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["status"], "confirmed")
        GS.return_value.upsert_entity.assert_called()  # rebuild enqueued via eager celery

    def test_merge_approve_sho_only_and_repoints(self):
        inv_c, sho_c = self._client(self.inv), self._client(self.sho)
        self.assertEqual(inv_c.post(f"/api/entities/review/merges/{self.ms.id}/",
                                    {"decision": "approve"}).status_code, 403)
        # relation a->b becomes self-loop and must be dropped on merge
        with mock.patch("apps.graph_api.services.graph_service.GraphService"):
            resp = sho_c.post(f"/api/entities/review/merges/{self.ms.id}/", {"decision": "approve"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "approved")
        self.b.refresh_from_db()
        self.assertEqual(self.b.status, ReviewStatus.MERGED)
        self.assertEqual(self.b.merged_into_id, self.a.id)
        self.assertFalse(ExtractedRelation.objects.filter(pk=self.rel.pk).exists())
        dup = sho_c.post(f"/api/entities/review/merges/{self.ms.id}/", {"decision": "approve"})
        self.assertEqual(dup.status_code, 409)

    def test_entity_search_scoped(self):
        c = self._client(self.inv)
        r = c.get("/api/entities/?q=rahul")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("Rahul" in hit["value"] for hit in r.data["results"]))
        d = c.get(f"/api/entities/{self.a.id}/")
        self.assertEqual(d.status_code, 200)
        self.assertIn("evidence_trail", d.data)
