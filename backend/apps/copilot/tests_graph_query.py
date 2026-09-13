"""Slice 1 tests: parser gate, scope injection, scoped executor, endpoint.

No LLM anywhere in this file — hand-written Cypher only. The verifier is
pinned by both accept and reject batteries; scope injection is asserted on
the exact predicate text and params (never just "200 OK").
"""
import datetime as _dt
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.auditlog.models import AuditLog
from apps.cases.models import Case, CaseAssignment

from .services import nl_to_cypher as N
from .services.cypher_parse import CypherInvalid, parse


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


def _client(user):
    c = APIClient()
    r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
    assert r.status_code == 200, r.content[:200]
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
    return c


VALID_QUERIES = [
    # entity lookup / relationship traversal / temporal filter / multi-hop
    "MATCH (p:Case:Person) RETURN p",
    "MATCH (p:Case:Person {value: 'Rahul'}) RETURN p.value AS name",
    ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:PhoneNumber) "
     "WHERE r.confidence_score > 0.5 RETURN a, b ORDER BY r.confidence_score DESC LIMIT 10"),
    "MATCH (a:Case:Person)-->(b:Case:Location) RETURN a.value, b.value",
    ("MATCH (a:Case:Person)-[r]->(b:Case:Person) "
     "WHERE a.value = 'X' OR b.value = 'Y' RETURN count(*)"),
    "MATCH (a:Case:Person), (b:Case:Vehicle) RETURN a, b LIMIT 5",
    # banned WORDS inside string literals must not trip the tripwire
    "MATCH (a:Case:Person) WHERE a.value = 'DELETE me' RETURN a",
    # bare re-mention of a :Case-bound alias (comma join) is legal
    ("MATCH (a:Case:Person)-[r1:OWNS]->(v:Case:Vehicle), "
     "(a)-[r2:CALLED]->(p:Case:PhoneNumber) RETURN a, p"),
]

REJECT_QUERIES = [
    ("MATCH (p:Person) RETURN p", "missing-case-label"),
    ("MATCH (p) RETURN p", "missing-case-label"),
    ("MATCH (:Case:Person) RETURN count(*)", "anonymous-node"),
    ("MATCH (p:Case:Bogus) RETURN p", "unknown-label"),
    ("MATCH (a:Case:Person)-[r:HACKED]->(b:Case:Person) RETURN a", "unknown-relationship"),
    ("MATCH (a:Case:Person) WHERE a.evil = 1 RETURN a", "unknown-property"),
    ("MATCH (a:Case:Person) RETURN a.bogus", "unknown-property"),
    ("MATCH (a:Case:Person) RETURN nosuchfn(a)", "banned-function"),
    ("CREATE (n:Case) RETURN n", "banned-clause"),
    ("MATCH (a:Case:Person) DELETE a", "banned-clause"),
    ("MATCH (a:Case:Person) SET a.x = 1 RETURN a", "banned-clause"),
    ("MATCH (a:Case:Person) CALL db.labels() RETURN a", "banned-clause"),
    ("MATCH (a:Case:Person) OPTIONAL MATCH (b:Case) RETURN a", "banned-clause"),
    ("MATCH (a:Case:Person) WITH a RETURN a", "banned-clause"),
    ("MATCH (a:Case:Person) RETURN a SKIP 5", "banned-clause"),
    ("MATCH (a:Case:Person)-[*1..3]-(b:Case:Person) RETURN a", "syntax"),
    ("MATCH (a:Case:Person) RETURN a; MATCH (b:Case) RETURN b", "banned-clause"),
    ("MATCH (a:Case:Person) WHERE zzz.value = 1 RETURN a", "unknown-alias"),
    ("MATCH (a:Case:Person RETURN a", "syntax"),
    ("", "empty-query"),
]

# Parser-level rejects: grammar violations the parser itself must catch.
# (Schema rules like :Case labels, and the function allowlist, live one
# layer up in the verifier — e.g. nosuchfn() parses fine but is rejected
# there as banned-function.)
PARSER_REJECTS = [
    "MATCH (a:Case:Person)-[*1..3]-(b:Case:Person) RETURN a",
    "MATCH (a:Case:Person RETURN a",
]


class EvalFixtureValidityTests(SimpleTestCase):
    """Every eval gold query must pass the gate (no DB, no Neo4j, no LLM).

    A gate-fail here means the ACCEPTANCE harness itself is broken — it
    fails before any live run matters. Expected sets stay small by
    construction (truncation decision: full sets, counts < MAX_LIMIT).
    """

    def test_all_gold_queries_verify(self):
        from .services import eval_cases
        from .services.nl_to_cypher import MAX_LIMIT
        self.assertEqual(len(eval_cases.CASES), 30)
        for item in eval_cases.CASES:
            gold = item["gold"]
            if item.get("expect_relative"):
                gold = ("MATCH (a:Case:Person)-[r]->(b:Case) "
                        "WHERE r.valid_from >= $date_from RETURN a, r, b")
            scoped, params = N.verify_and_scope(gold, [999])
            self.assertIn("$case_ids", scoped, item["id"])
            self.assertEqual(params["case_ids"], [999])

    def test_expected_sets_small_and_wellformed(self):
        from .services import eval_cases
        from .services.nl_to_cypher import MAX_LIMIT
        for item in eval_cases.CASES:
            if item.get("expect_relative"):
                continue  # expectation computed at runtime (see _expected)
            entries = item.get("expect", [])
            self.assertLess(len(entries), MAX_LIMIT, item["id"])
            self.assertGreater(len(entries), 0, item["id"])
            for node_type, normalized in entries:
                self.assertTrue(node_type and normalized, item["id"])

    def test_fixture_values_unique(self):
        from .services import eval_cases
        values = [v for _t, v, _n, _c in eval_cases.EVAL_ENTITIES]
        self.assertEqual(len(values), len(set(values)))


class ParserGateTests(TestCase):
    def test_valid_shapes_parse(self):
        for q in VALID_QUERIES:
            parsed = parse(q)
            self.assertTrue(parsed.node_aliases, q)

    def test_grammar_violations_rejected(self):
        for q in PARSER_REJECTS:
            if not q:
                continue
            with self.assertRaises(CypherInvalid, msg=q):
                parse(q)

    def test_unbalanced_rejected(self):
        with self.assertRaises(CypherInvalid):
            parse("MATCH (a:Case:Person RETURN a")


class VerifierGateTests(TestCase):
    def test_valid_accepted_with_scope(self):
        for q in VALID_QUERIES:
            scoped, params = N.verify_and_scope(q, [3, 7])
            self.assertIn("$case_ids", scoped, q)
            self.assertEqual(params, {"case_ids": [3, 7]})
            self.assertTrue(scoped.rstrip().endswith("LIMIT 100"), scoped)

    def test_reject_reasons(self):
        for q, reason in REJECT_QUERIES:
            with self.assertRaises(N.CypherRejected, msg=q) as ctx:
                N.verify_and_scope(q, [1])
            self.assertEqual(ctx.exception.reason, reason, q)

    def test_where_parenthesized(self):
        scoped, _ = N.verify_and_scope(
            "MATCH (a:Case:Person)-[r]->(b:Case:Person) "
            "WHERE a.value = 'X' OR b.value = 'Y' RETURN a", [9])
        self.assertIn("WHERE (a.value = 'X' OR b.value = 'Y') AND "
                      "a.case_id IN $case_ids AND b.case_id IN $case_ids", scoped)

    def test_limit_clamp_overrides_model(self):
        scoped, _ = N.verify_and_scope("MATCH (a:Case:Person) RETURN a LIMIT 5000", [1])
        self.assertTrue(scoped.rstrip().endswith("LIMIT 100"))
        self.assertNotIn("5000", scoped)

    def test_limit_param_rewritten(self):
        scoped, _ = N.verify_and_scope("MATCH (a:Case:Person) RETURN a LIMIT $n", [1])
        self.assertTrue(scoped.rstrip().endswith("LIMIT 100"))
        self.assertNotIn("$n", scoped)

    def test_bare_remention_scoped_once(self):
        scoped, _ = N.verify_and_scope(
            "MATCH (a:Case:Person)-[r1:OWNS]->(v:Case:Vehicle), "
            "(a)-[r2:CALLED]->(p:Case:PhoneNumber) RETURN a, p", [1])
        self.assertEqual(scoped.count("a.case_id IN $case_ids"), 1)
        self.assertIn("v.case_id IN $case_ids", scoped)
        self.assertIn("p.case_id IN $case_ids", scoped)

    def test_unbound_bare_alias_rejected(self):
        with self.assertRaises(N.CypherRejected) as ctx:
            N.verify_and_scope(
                "MATCH (a)-[r:CALLED]->(b:Case:Person) RETURN a, b", [1])
        self.assertEqual(ctx.exception.reason, "missing-case-label")

    def test_string_containing_limit_clause_survives(self):
        scoped, _ = N.verify_and_scope(
            "MATCH (a:Case:Person) WHERE a.value = 'LIMIT 5' RETURN a", [1])
        self.assertIn("'LIMIT 5'", scoped)
        self.assertTrue(scoped.rstrip().endswith("LIMIT 100"))

    def test_case_ids_param_cannot_be_widened(self):
        scoped, params = N.verify_and_scope("MATCH (a:Case:Person) RETURN a", [4])
        self.assertEqual(params, {"case_ids": [4]})
        self.assertIn("a.case_id IN $case_ids", scoped)

    def test_empty_scope_rejected(self):
        with self.assertRaises(N.CypherRejected) as ctx:
            N.verify_and_scope("MATCH (a:Case:Person) RETURN a", [])
        self.assertEqual(ctx.exception.reason, "no-visible-cases")

    def test_none_scope_rejected(self):
        with self.assertRaises(N.CypherRejected) as ctx:
            N.verify_and_scope("MATCH (a:Case:Person) RETURN a", None)
        self.assertEqual(ctx.exception.reason, "unscoped")

    def test_schema_text_tracks_constants(self):
        from apps.graph_api.services.graph_service import EDGE_TYPES, NODE_PROPS, NODE_TYPES
        text = N.graph_schema_text()
        for lab in list(NODE_TYPES) + list(EDGE_TYPES) + list(NODE_PROPS):
            self.assertIn(lab, text)


class ExecutorShapeTests(TestCase):
    def _records(self):
        node = SimpleNamespace(
            labels={"Case", "Person"},
            items=lambda: {"key": "1:Person:rahul", "value": "Rahul",
                           "node_type": "Person", "case_id": 1}.items())
        rel = SimpleNamespace(
            type="CALLED",
            start_node=SimpleNamespace(items=lambda: {"key": "1:Person:rahul"}.items()),
            end_node=SimpleNamespace(items=lambda: {"key": "1:PhoneNumber:9"}.items()),
            items=lambda: {"confidence_score": 0.8}.items())
        return [{"p": node, "r": rel, "n": 2}]

    def test_shape_extracts_isolate_ids(self):
        node_ids, edge_ids, rows = N.shape_records(self._records())
        self.assertEqual(node_ids, ["1:Person:rahul"])
        self.assertEqual(edge_ids, ["1:Person:rahul->CALLED->1:PhoneNumber:9"])
        self.assertEqual(rows[0]["n"], 2)
        self.assertEqual(rows[0]["p"]["value"], "Rahul")

    def test_run_readonly_passes_timeout(self):
        from apps.graph_api.services.graph_service import GraphService
        seen = {}

        class FakeResult(list):
            pass

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, cypher, parameters=None, timeout=None):
                seen.update(cypher=cypher, parameters=parameters, timeout=timeout)
                return FakeResult()

        class FakeDriver:
            def session(self):
                return FakeSession()

            def close(self):
                pass

        with mock.patch.object(GraphService, "_driver", return_value=FakeDriver()):
            out = GraphService().run_readonly("MATCH (a) RETURN a", {"case_ids": [1]}, timeout_s=7)
        self.assertEqual(out, [])
        self.assertEqual(seen["timeout"], 7.0)
        self.assertEqual(seen["parameters"], {"case_ids": [1]})

    def test_run_graph_query_composes(self):
        recs = self._records()
        with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                        return_value=recs) as m:
            out = N.run_graph_query("MATCH (p:Case:Person) RETURN p", [1])
        sent_cypher = m.call_args[0][0]
        self.assertIn("p.case_id IN $case_ids", sent_cypher)
        self.assertEqual(m.call_args[0][1], {"case_ids": [1]})
        self.assertEqual(out["node_ids"], ["1:Person:rahul"])
        self.assertEqual(out["counts"]["nodes"], 1)

    def test_extra_params_merge_under_scope(self):
        with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                        return_value=[]) as m:
            N.run_graph_query("MATCH (p:Case:Person {value: $name}) RETURN p", [5],
                              extra_params={"name": "Rahul", "case_ids": [999]})
        self.assertEqual(m.call_args[0][1], {"name": "Rahul", "case_ids": [5]})

    def test_extra_params_validated(self):
        with self.assertRaises(N.CypherRejected):
            N.run_graph_query("MATCH (p:Case:Person) RETURN p", [1],
                              extra_params={"ok": {"nested": "dict"}})


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class GraphQueryViewTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("gq_sho", Role.SHO)
        self.inv = _mkuser("gq_inv", Role.INVESTIGATOR)
        self.out = _mkuser("gq_out", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-GQ-1", title="gq", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv,
                                      permission="edit", assigned_by=self.sho)
        self.hidden = Case.objects.create(fir_no="FIR-GQ-2", title="hidden", owner=self.sho)

    def _recs(self):
        node = SimpleNamespace(
            labels={"Case", "Person"},
            items=lambda: {"key": f"{self.case.id}:Person:rahul", "value": "Rahul",
                           "node_type": "Person", "case_id": self.case.id}.items())
        return [{"p": node}]

    def test_accept_scopes_to_visible_cases(self):
        c = _client(self.inv)
        seen = {}
        real = N.run_graph_query

        def spy(cypher, case_ids, **kw):
            seen["case_ids"] = list(case_ids)
            return real(cypher, case_ids, **kw)

        with mock.patch("apps.copilot.views.run_graph_query", side_effect=spy):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=self._recs()):
                r = c.post("/api/copilot/graph-query/",
                           {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["unanswerable"])
        # Investigator sees ONLY their case — the hidden case id is absent.
        self.assertEqual(seen["case_ids"], [self.case.id])
        self.assertEqual(r.data["node_ids"], [f"{self.case.id}:Person:rahul"])
        self.assertIn(f"p.case_id IN $case_ids", r.data["cypher_shown"])
        self.assertEqual(r.data["confidence"], 1.0)

    def test_outsider_gets_no_scope(self):
        c = _client(self.out)
        with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                        return_value=[]):
            r = c.post("/api/copilot/graph-query/",
                       {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
        self.assertEqual(r.status_code, 200)
        # No visible cases -> verifier refuses rather than querying.
        self.assertTrue(r.data["unanswerable"])

    def test_reject_returns_unanswerable(self):
        c = _client(self.inv)
        r = c.post("/api/copilot/graph-query/",
                   {"cypher": "MATCH (n) DELETE n"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("can't express", r.data["answer_text"])
        self.assertEqual(r.data["confidence"], 0.0)

    @override_settings(GEMINI_API_KEY="")
    def test_question_without_key_is_not_available(self):
        c = _client(self.inv)
        with mock.patch("apps.copilot.services.gemini.generate",
                        side_effect=AssertionError("no LLM without a key")):
            r = c.post("/api/copilot/graph-query/",
                       {"question": "who called whom?"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("not available", r.data["answer_text"])
        self.assertEqual(r.data["confidence"], 0.0)

    def test_empty_body_400(self):
        c = _client(self.inv)
        r = c.post("/api/copilot/graph-query/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_graph_unavailable_degrades(self):
        from apps.graph_api.services.graph_service import GraphUnavailable
        c = _client(self.inv)
        with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                        side_effect=GraphUnavailable("down")):
            r = c.post("/api/copilot/graph-query/",
                       {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("unavailable", r.data["answer_text"])
        self.assertEqual(r.data["node_ids"], [])

    def test_audit_rows_for_accept_and_reject(self):
        c = _client(self.inv)
        with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                        return_value=self._recs()):
            c.post("/api/copilot/graph-query/",
                   {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
        c.post("/api/copilot/graph-query/",
               {"cypher": "MATCH (n) DELETE n"}, format="json")
        # Explicit read-sensitive rows only (the middleware also logs each
        # POST with action "create" — same model, separate rows).
        rows = list(AuditLog.objects.filter(object_type="/api/copilot/graph-query/",
                                            action="read-sensitive")
                    .order_by("id").values("action", "after"))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["action"], "read-sensitive")
        self.assertTrue(rows[0]["after"]["accepted"])
        self.assertIn("MATCH", rows[0]["after"]["cypher"])
        self.assertEqual(rows[0]["after"]["cases"], [self.case.id])
        self.assertFalse(rows[1]["after"]["accepted"])
        self.assertEqual(rows[1]["after"]["reason"], "banned-clause")

    def test_no_llm_on_handwritten_path(self):
        c = _client(self.inv)
        with mock.patch("apps.copilot.services.gemini.generate",
                        side_effect=AssertionError("LLM must not run")):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=self._recs()):
                r = c.post("/api/copilot/graph-query/",
                           {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["unanswerable"])

def _model_json(cypher, params=None, explanation="Test explanation.",
                confidence=0.9, unanswerable=False):
    import json
    return json.dumps({"cypher": cypher, "params": params or {},
                       "explanation": explanation, "confidence": confidence,
                       "unanswerable": unanswerable})


class PromptContractTests(TestCase):
    def test_prompt_injects_live_schema(self):
        from apps.graph_api.services.graph_service import EDGE_TYPES, NODE_PROPS, NODE_TYPES
        prompt = N.build_prompt("Who called whom?")
        for token in list(NODE_TYPES) + list(EDGE_TYPES) + ["confidence_score", "valid_from"]:
            self.assertIn(token, prompt)
        self.assertIn("unanswerable", prompt)
        self.assertIn(":Case", prompt)
        self.assertIn("MATCH (p:Case:Person", prompt)  # few-shot present

    def test_parse_model_json_valid(self):
        d = N._parse_model_json(_model_json("MATCH (p:Case:Person) RETURN p",
                                            {"name": "X"}, "Why.", 0.7, False))
        self.assertEqual(d["cypher"], "MATCH (p:Case:Person) RETURN p")
        self.assertEqual(d["params"], {"name": "X"})
        self.assertEqual(d["confidence"], 0.7)

    def test_parse_model_json_strips_fences(self):
        d = N._parse_model_json("```json\n" + _model_json("MATCH (p:Case:Person) RETURN p") + "\n```")
        self.assertEqual(d["cypher"], "MATCH (p:Case:Person) RETURN p")

    def test_parse_model_json_clamps_confidence(self):
        self.assertEqual(N._parse_model_json(_model_json("MATCH (p:Case:Person) RETURN p",
                                                         confidence=1.7))["confidence"], 1.0)
        self.assertEqual(N._parse_model_json(_model_json("MATCH (p:Case:Person) RETURN p",
                                                         confidence=-0.2))["confidence"], 0.0)

    def test_parse_model_json_rejects_garbage(self):
        for bad in ("not json at all", "[1,2]", '{"cypher": 42}',
                    _model_json("", unanswerable=False)):
            with self.assertRaises(N.GenerationUnavailable, msg=bad):
                N._parse_model_json(bad)

    def test_parse_model_json_unanswerable_needs_no_cypher(self):
        d = N._parse_model_json(_model_json("", unanswerable=True))
        self.assertTrue(d["unanswerable"])

    def test_generate_cypher_needs_key(self):
        with override_settings(GEMINI_API_KEY=""):
            with self.assertRaises(N.GenerationUnavailable):
                N.generate_cypher("who called whom?")


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, GEMINI_API_KEY="test-key")
class GenerationViewTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("gq2_sho", Role.SHO)
        self.inv = _mkuser("gq2_inv", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-GQ2-1", title="gq2", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv,
                                      permission="edit", assigned_by=self.sho)

    def _recs(self):
        node = SimpleNamespace(
            labels={"Case", "Person"},
            items=lambda: {"key": f"{self.case.id}:Person:rahul", "value": "Rahul",
                           "node_type": "Person", "case_id": self.case.id}.items())
        return [{"p": node}]

    def _gen(self, text):
        return mock.patch("apps.copilot.services.gemini.generate", return_value=text)

    def test_question_executes_behind_gate(self):
        c = _client(self.inv)
        with self._gen(_model_json("MATCH (p:Case:Person) RETURN p")) as gen:
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=self._recs()) as run:
                r = c.post("/api/copilot/graph-query/",
                           {"question": "find all people"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["unanswerable"])
        self.assertTrue(r.data["generated"])
        self.assertEqual(r.data["confidence"], 0.9)
        self.assertEqual(r.data["explanation"], "Test explanation.")
        self.assertIn("p.case_id IN $case_ids", r.data["cypher_shown"])
        self.assertEqual(r.data["node_ids"], [f"{self.case.id}:Person:rahul"])
        # One LLM call, deterministic temperature.
        self.assertEqual(gen.call_count, 1)
        self.assertEqual(gen.call_args[1].get("temperature"), 0.0)
        sent_params = run.call_args[0][1]
        self.assertEqual(sent_params, {"case_ids": [self.case.id]})

    def test_model_params_merge_with_scope_winning(self):
        c = _client(self.inv)
        payload = _model_json("MATCH (p:Case:Person {value: $name}) RETURN p",
                              {"name": "Rahul", "case_ids": [999]})
        with self._gen(payload):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=[]) as run:
                r = c.post("/api/copilot/graph-query/",
                           {"question": "find Rahul"}, format="json")
        self.assertFalse(r.data["unanswerable"])
        self.assertEqual(run.call_args[0][1], {"name": "Rahul", "case_ids": [self.case.id]})

    def test_hostile_model_output_never_executes(self):
        c = _client(self.inv)
        payload = _model_json("MATCH (n) DETACH DELETE n")
        with self._gen(payload):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            side_effect=AssertionError("must not execute")) as run:
                r = c.post("/api/copilot/graph-query/",
                           {"question": "delete everything"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("can't express", r.data["answer_text"])
        run.assert_not_called()
        row = AuditLog.objects.filter(object_type="/api/copilot/graph-query/",
                                      action="read-sensitive").order_by("-id").first()
        self.assertFalse(row.after["accepted"])
        self.assertTrue(row.after["reason"].startswith("verifier-rejected"))

    def test_model_unanswerable_executes_nothing(self):
        c = _client(self.inv)
        with self._gen(_model_json("", unanswerable=True,
                                   explanation="Too vague to query.")):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            side_effect=AssertionError("must not execute")) as run:
                r = c.post("/api/copilot/graph-query/",
                           {"question": "show me everything suspicious"}, format="json")
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("Too vague", r.data["answer_text"])
        run.assert_not_called()

    def test_model_garbage_is_unavailable(self):
        c = _client(self.inv)
        with self._gen("definitely not json {{{"):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            side_effect=AssertionError("must not execute")):
                r = c.post("/api/copilot/graph-query/",
                           {"question": "who called whom?"}, format="json")
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("not available", r.data["answer_text"])

    def test_generation_failure_is_unavailable(self):
        from apps.copilot.services.gemini import GeminiUnavailable
        c = _client(self.inv)
        with mock.patch("apps.copilot.services.gemini.generate",
                        side_effect=GeminiUnavailable("boom")):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            side_effect=AssertionError("must not execute")):
                r = c.post("/api/copilot/graph-query/",
                           {"question": "who called whom?"}, format="json")
        self.assertTrue(r.data["unanswerable"])
        self.assertIn("not available", r.data["answer_text"])

class GraphQueryThrottleTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("gq4_sho", Role.SHO)
        self.inv = _mkuser("gq4_inv", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-GQ4-1", title="gq4", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv,
                                      permission="edit", assigned_by=self.sho)

    def _recs(self):
        node = SimpleNamespace(
            labels={"Case", "Person"},
            items=lambda: {"key": f"{self.case.id}:Person:rahul", "value": "Rahul",
                           "node_type": "Person", "case_id": self.case.id}.items())
        return [{"p": node}]

    def test_throttle_kicks_in(self):
        # DRF binds THROTTLE_RATES at import, so override_settings on
        # REST_FRAMEWORK cannot move the rate — patch the class rate instead
        # (this tests OUR throttle wiring, not DRF internals).
        from django.core.cache import cache

        from apps.copilot.views import GraphQueryThrottle
        cache.clear()
        c = _client(self.inv)
        with mock.patch.object(GraphQueryThrottle, "rate", "1/min", create=True):
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=self._recs()):
                r1 = c.post("/api/copilot/graph-query/",
                            {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
                r2 = c.post("/api/copilot/graph-query/",
                            {"cypher": "MATCH (p:Case:Person) RETURN p"}, format="json")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 429)


class TemporalResolutionTests(TestCase):
    SUN = _dt.date(2026, 9, 13)  # a Sunday (pin; do not use today())
    TUE = _dt.date(2026, 9, 8)  # the Tuesday before it

    def _ranges(self, q, today=None):
        return N.resolve_temporal(q, today=today or self.SUN)

    def test_last_tuesday(self):
        r = self._ranges("calls last Tuesday")
        self.assertTrue(r["has_relative"])
        self.assertEqual((r["ranges"][0]["from"], r["ranges"][0]["to"]),
                         ("2026-09-08", "2026-09-08"))

    def test_bare_weekday_is_most_recent(self):
        r = self._ranges("seen on Tuesday")
        self.assertEqual(r["ranges"][0]["from"], "2026-09-08")

    def test_tuesday_today_edge(self):
        # Bare "Tuesday" on a Tuesday means today; "last Tuesday" means -7.
        self.assertEqual(self._ranges("seen Tuesday", today=self.TUE)["ranges"][0]["from"],
                         "2026-09-08")
        self.assertEqual(self._ranges("seen last Tuesday", today=self.TUE)["ranges"][0]["from"],
                         "2026-09-01")

    def test_day_words(self):
        self.assertEqual(self._ranges("today")["ranges"][0]["from"], "2026-09-13")
        self.assertEqual(self._ranges("yesterday")["ranges"][0]["from"], "2026-09-12")
        self.assertEqual(self._ranges("last night")["ranges"][0]["from"], "2026-09-12")

    def test_weeks(self):
        self.assertEqual((self._ranges("this week")["ranges"][0]["from"],
                          self._ranges("this week")["ranges"][0]["to"]),
                         ("2026-09-07", "2026-09-13"))
        self.assertEqual((self._ranges("last week")["ranges"][0]["from"],
                          self._ranges("last week")["ranges"][0]["to"]),
                         ("2026-08-31", "2026-09-06"))
        self.assertEqual((self._ranges("past 7 days")["ranges"][0]["from"],
                          self._ranges("past 7 days")["ranges"][0]["to"]),
                         ("2026-09-06", "2026-09-13"))

    def test_months_years(self):
        self.assertEqual((self._ranges("this month")["ranges"][0]["from"],
                          self._ranges("this month")["ranges"][0]["to"]),
                         ("2026-09-01", "2026-09-13"))
        self.assertEqual((self._ranges("last month")["ranges"][0]["from"],
                          self._ranges("last month")["ranges"][0]["to"]),
                         ("2026-08-01", "2026-08-31"))
        self.assertEqual(self._ranges("March 2026")["ranges"][0]["from"], "2026-03-01")
        self.assertEqual(self._ranges("March 2026")["ranges"][0]["to"], "2026-03-31")
        self.assertEqual(self._ranges("last year")["ranges"][0]["from"], "2025-01-01")

    def test_merge_spans(self):
        r = self._ranges("calls last Tuesday and yesterday")
        self.assertEqual((r["ranges"][0]["from"], r["ranges"][0]["to"]),
                         ("2026-09-08", "2026-09-12"))

    def test_no_phrases(self):
        r = self._ranges("who called 9876543210?")
        self.assertEqual((r["ranges"], r["has_relative"]), ([], False))


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class MentionDisambiguationTests(TestCase):
    def setUp(self):
        from apps.graph_api.models import ExtractedEntity
        self.sho = _mkuser("gq3_sho", Role.SHO)
        self.inv = _mkuser("gq3_inv", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-GQ3-1", title="gq3", owner=self.sho)
        self.other = Case.objects.create(fir_no="FIR-GQ3-2", title="gq3b", owner=self.sho)
        for c in (self.case, self.other):
            CaseAssignment.objects.create(case=c, user=self.inv,
                                          permission="edit", assigned_by=self.sho)
        self.a = ExtractedEntity.objects.create(
            case=self.case, node_type="Person", value="Ravi Kumar", normalized="ravi kumar",
            confidence=0.9, status="confirmed", graph_key=f"{self.case.id}:Person:ravi kumar")
        self.b = ExtractedEntity.objects.create(
            case=self.other, node_type="Person", value="Ravi Kumar", normalized="ravi kumar",
            confidence=0.8, status="confirmed", graph_key=f"{self.other.id}:Person:ravi kumar")
        # Pending lookalike: icontains-matches the mention but must be excluded.
        # (A same-normalized pending twin is impossible — uniq_entity_per_case.)
        self.pend = ExtractedEntity.objects.create(
            case=self.case, node_type="Person", value="Ravi Kumar Singh",
            normalized="ravi kumar singh", confidence=0.5, status="pending")

    def test_quoted_ambiguity_lists_both_confirmed(self):
        mentions = N.find_mentions('Who called "Ravi Kumar"?', [self.case.id, self.other.id])
        self.assertEqual(len(mentions), 1)
        cands = mentions[0]["candidates"]
        self.assertEqual(len(cands), 2)  # pending twin excluded
        self.assertEqual({c["case_id"] for c in cands}, {self.case.id, self.other.id})

    def test_single_hit_is_hint_not_ambiguity(self):
        mentions = N.find_mentions('Who called "Ravi Kumar"?', [self.case.id])
        self.assertEqual(len(mentions[0]["candidates"]), 1)
        context, forced, amb = N.build_question_context('Who called "Ravi Kumar"?',
                                                        [self.case.id])
        self.assertEqual(amb, [])
        self.assertEqual(forced, {})
        self.assertIn(f"{self.case.id}:Person:ravi kumar", context)

    def test_unquoted_multitoken_scan(self):
        mentions = N.find_mentions("Where was Ravi Kumar seen?", [self.case.id])
        self.assertEqual(len(mentions), 1)
        self.assertEqual(mentions[0]["candidates"][0]["value"], "Ravi Kumar")

    def test_devanagari_quoted_ambiguity(self):
        from apps.graph_api.models import ExtractedEntity
        for c in (self.case, self.other):
            ExtractedEntity.objects.create(
                case=c, node_type="Person", value="प्रिया देशमुख",
                normalized="प्रिया देशमुख", confidence=0.9, status="confirmed",
                graph_key=f"{c.id}:Person:प्रिया देशमुख")
        mentions = N.find_mentions('“प्रिया देशमुख” ने किसे फोन किया?',
                                   [self.case.id, self.other.id])
        self.assertEqual(len(mentions[0]["candidates"]), 2)

    def test_view_asks_before_llm_on_ambiguity(self):
        c = _client(self.inv)
        with mock.patch("apps.copilot.services.gemini.generate",
                        side_effect=AssertionError("no LLM before disambiguation")):
            r = c.post("/api/copilot/graph-query/",
                       {"question": 'Who called "Ravi Kumar"?'}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["unanswerable"])
        self.assertFalse(r.data["generated"])
        self.assertIn("FIR-GQ3-1", r.data["answer_text"])
        self.assertIn("FIR-GQ3-2", r.data["answer_text"])
        row = AuditLog.objects.filter(object_type="/api/copilot/graph-query/",
                                      action="read-sensitive").order_by("-id").first()
        self.assertEqual(row.after["reason"], "disambiguation")

    @override_settings(GEMINI_API_KEY="test-key")
    def test_server_dates_win_over_model_params(self):
        c = _client(self.inv)
        payload = _model_json(
            "MATCH (a:Case:Person)-[r:CALLED]->(b:Case:Person) "
            "WHERE r.valid_from >= $date_from RETURN a",
            {"date_from": "2000-01-01", "date_to": "2000-01-02"})
        with mock.patch("apps.copilot.services.gemini.generate", return_value=payload) as gen:
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=[]) as run:
                r = c.post("/api/copilot/graph-query/",
                           {"question": "calls last Tuesday"}, format="json")
        self.assertFalse(r.data["unanswerable"])
        sent = run.call_args[0][1]
        expected = N.resolve_temporal("calls last Tuesday")["ranges"][0]
        self.assertEqual(sent["date_from"], expected["from"])
        self.assertEqual(sent["date_to"], expected["to"])
        self.assertNotIn("2000-01-01", (sent["date_from"], sent["date_to"]))
        prompt = gen.call_args[0][0]
        self.assertIn(expected["from"], prompt)
        self.assertIn("$date_from", prompt)

    @override_settings(GEMINI_API_KEY="test-key")
    def test_single_hit_hint_reaches_prompt(self):
        c = _client(self.inv)
        with mock.patch("apps.copilot.services.gemini.generate",
                        return_value=_model_json("MATCH (p:Case:Person) RETURN p")) as gen:
            with mock.patch("apps.graph_api.services.graph_service.GraphService.run_readonly",
                            return_value=[]):
                c.post("/api/copilot/graph-query/",
                       {"question": 'Who called "Ravi Kumar"?', "case_id": self.case.id},
                       format="json")
        prompt = gen.call_args[0][0]
        self.assertIn(f"{self.case.id}:Person:ravi kumar", prompt)
