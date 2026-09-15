"""Phase 6 tests: chunking, intents, indexing, copilot QA, global search.

pg-specific paths (trigram/full-text/vector) run against Postgres; the suite
assumes DATABASE_URL points at the docker db (see README). Gemini is mocked.
"""
import sys
import types
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.cases.models import Case, CaseAssignment
from apps.evidence.models import DocumentChunk, Evidence
from apps.graph_api.models import ExtractedEntity, ReviewStatus

from .services import intents
from .services.chunking import chunk_text


def _mkuser(username, role):
    return User.objects.create_user(username, password="pw123456", role=role)


class ChunkingTests(TestCase):
    def test_empty(self):
        self.assertEqual(chunk_text(""), [])
        self.assertEqual(chunk_text("   "), [])

    def test_short_single(self):
        self.assertEqual(chunk_text("Hello world."), ["Hello world."])

    def test_long_splits_with_overlap(self):
        sents = [f"Sentence number {i} with some filler words here." for i in range(40)]
        chunks = chunk_text(" ".join(sents), chunk_chars=200, overlap_chars=30)
        self.assertGreater(len(chunks), 3)
        self.assertTrue(all(len(c) <= 260 for c in chunks))
        # overlap: tail of chunk[i] appears at head of chunk[i+1]
        self.assertIn(chunks[0][-30:], chunks[1][:60])


class IntentTests(TestCase):
    def test_path_forms(self):
        self.assertEqual(intents.classify("How is Rahul Sharma connected to Vikram Patil?"),
                         ("path", {"a": "Rahul Sharma", "b": "Vikram Patil"}))
        self.assertEqual(intents.classify("connection between A and B"),
                         ("path", {"a": "A", "b": "B"}))
        self.assertEqual(intents.classify("X -> Y"), ("path", {"a": "X", "b": "Y"}))

    def test_summary(self):
        for q in ("Summarize this case", "who are the key players?", "give me an overview"):
            self.assertEqual(intents.classify(q)[0], "summary")

    def test_generic(self):
        self.assertEqual(intents.classify("What vehicles were seen?")[0], "generic")
        self.assertEqual(intents.classify("")[0], "generic")


def _fake_genai(embed_vals=None, gen_text="Generated answer [1]."):
    """Install a fake `google.genai` module returning canned responses."""
    mod = types.ModuleType("google.genai")
    gen_mod = types.ModuleType("google")

    class _Emb:
        def __init__(self, values):
            self.values = values

    class _EmbResp:
        def __init__(self, vecs):
            self.embeddings = [_Emb(v) for v in vecs]

    class _GenResp:
        def __init__(self, text):
            self.text = text

    class _Models:
        def embed_content(self, model=None, contents=None):
            return _EmbResp(embed_vals if embed_vals is not None else [[0.1] * 768 for _ in contents])

        def generate_content(self, model=None, contents=None):
            return _GenResp(gen_text)

    class _Client:
        def __init__(self, api_key=None):
            self.models = _Models()

    mod.Client = _Client
    parent = types.ModuleType("google")
    parent.genai = mod
    return parent, mod


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, GEMINI_API_KEY="test-key")
class IndexTaskTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho7", Role.SHO)
        self.case = Case.objects.create(fir_no="FIR-P6-1", title="p6", owner=self.sho)
        self.ev = Evidence.objects.create(
            case=self.case, file_name="note.txt", mime_type="text/plain", size_bytes=10,
            sha256=Evidence.hash_bytes(b"x" * 10), storage_key="k", uploaded_by=self.sho,
            ocr_status="done", ocr_text="Rahul Sharma met Vikram Patil near Pune station. " * 30)

    def test_index_embeds_with_key(self):
        from apps.evidence.tasks import index_evidence
        fake_parent, fake_mod = _fake_genai()
        with mock.patch.dict(sys.modules, {"google": fake_parent, "google.genai": fake_mod}):
            res = index_evidence(self.ev.id)
        self.assertEqual(res["status"], "ok")
        self.assertGreater(res["chunks"], 1)
        self.assertEqual(res["embedded"], res["chunks"])
        chunk = DocumentChunk.objects.filter(evidence=self.ev).first()
        self.assertEqual(len(list(chunk.embedding)), 768)

    @override_settings(GEMINI_API_KEY="")
    def test_index_keyword_only_without_key(self):
        from apps.evidence.tasks import index_evidence
        res = index_evidence(self.ev.id)
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["embedded"], 0)
        self.assertTrue(DocumentChunk.objects.filter(evidence=self.ev, embedding__isnull=True).exists())

    def test_reindex_idempotent(self):
        from apps.evidence.tasks import index_evidence
        with mock.patch.dict(sys.modules, {"google": _fake_genai()[0], "google.genai": _fake_genai()[1]}):
            index_evidence(self.ev.id)
            res = index_evidence(self.ev.id)
        self.assertEqual(res["status"], "ok")
        self.assertEqual(DocumentChunk.objects.filter(evidence=self.ev).count(), res["chunks"])


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class CopilotApiTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho8", Role.SHO)
        self.inv = _mkuser("inv8", Role.INVESTIGATOR)
        self.outsider = _mkuser("out8", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P6-2", title="p6b", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        self.ev = Evidence.objects.create(
            case=self.case, file_name="fir-statement.txt", mime_type="text/plain", size_bytes=20,
            sha256=Evidence.hash_bytes(b"y" * 20), storage_key="k2", uploaded_by=self.inv,
            ocr_status="done", ocr_text="Rahul Sharma called Vikram Patil from 9876543210.")
        self.a = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="Rahul Sharma",
                                                normalized="rahul sharma", confidence=0.8,
                                                status=ReviewStatus.CONFIRMED, graph_key="9:Person:rahul sharma",
                                                evidence=self.ev)
        self.b = ExtractedEntity.objects.create(case=self.case, node_type="Person", value="Vikram Patil",
                                                normalized="vikram patil", confidence=0.8,
                                                status=ReviewStatus.CONFIRMED, graph_key="9:Person:vikram patil",
                                                evidence=self.ev)
        DocumentChunk.objects.create(evidence=self.ev, case=self.case, chunk_index=0,
                                     text="Rahul Sharma called Vikram Patil from 9876543210.")

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_path_question_no_llm_needed(self):
        c = self._client(self.inv)
        path = {"nodes": [{"value": "Rahul Sharma"}, {"value": "Vikram Patil"}],
                "rels": [{"type": "CALLED", "conf": 0.6, "snippet": "called", "ev": self.ev.id}]}
        with mock.patch("apps.copilot.views.GraphService") as GS:
            GS.return_value.path_between.return_value = path
            r = c.post("/api/copilot/query/", {"question": "How is Rahul Sharma connected to Vikram Patil?",
                                               "case_id": self.case.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["intent"], "path")
        self.assertFalse(r.data["generated"])
        self.assertIn("CALLED", r.data["answer"])
        self.assertTrue(any(ch["evidence_id"] == self.ev.id for ch in r.data["citations"]))

    def test_path_unknown_entity(self):
        c = self._client(self.inv)
        r = c.post("/api/copilot/query/", {"question": "How is Nobody Here connected to Vikram Patil?",
                                           "case_id": self.case.id})
        self.assertEqual(r.status_code, 200)
        self.assertIn("could not find", r.data["answer"])

    def test_generic_extractive_without_key(self):
        c = self._client(self.inv)
        r = c.post("/api/copilot/query/", {"question": "Which phone was used to call?",
                                           "case_id": self.case.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["intent"], "generic")
        self.assertFalse(r.data["generated"])
        self.assertTrue(r.data["citations"], "keyword retrieval must cite the chunk")

    @override_settings(GEMINI_API_KEY="test-key")
    def test_generic_generated_with_key(self):
        c = self._client(self.inv)
        fake_parent, fake_mod = _fake_genai(gen_text="Rahul called Vikram [1].")
        with mock.patch.dict(sys.modules, {"google": fake_parent, "google.genai": fake_mod}):
            r = c.post("/api/copilot/query/", {"question": "Who called whom?",
                                               "case_id": self.case.id})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["generated"])
        self.assertIn("Rahul called Vikram", r.data["answer"])

    def test_case_scoping_enforced(self):
        c = self._client(self.outsider)
        r = c.post("/api/copilot/query/", {"question": "Summarize this case", "case_id": self.case.id})
        self.assertEqual(r.status_code, 403)
        # without case scope the outsider sees nothing of this case
        r2 = c.post("/api/copilot/query/", {"question": "Vikram Patil"})
        self.assertEqual(r2.status_code, 200)
        firs = [ch.get("case_fir", "") for ch in r2.data["citations"]]
        self.assertNotIn("FIR-P6-2", firs)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class SearchApiTests(TestCase):
    def setUp(self):
        self.sho = _mkuser("sho9", Role.SHO)
        self.inv = _mkuser("inv9", Role.INVESTIGATOR)
        self.case = Case.objects.create(fir_no="FIR-P6-3", title="Vehicle theft ring", owner=self.sho)
        CaseAssignment.objects.create(case=self.case, user=self.inv, permission="edit", assigned_by=self.sho)
        self.ev = Evidence.objects.create(
            case=self.case, file_name="tower-dump-march.csv", mime_type="text/csv", size_bytes=30,
            sha256=Evidence.hash_bytes(b"z" * 30), storage_key="k3", uploaded_by=self.inv,
            ocr_status="done", ocr_text="calling 9876543210 tower dump march analysis")
        ExtractedEntity.objects.create(case=self.case, node_type="Person", value="Rahul Sharma",
                                       normalized="rahul sharma", confidence=0.8,
                                       status=ReviewStatus.CONFIRMED, evidence=self.ev)

    def _client(self, user):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": user.username, "password": "pw123456"})
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return c

    def test_grouped_results(self):
        c = self._client(self.inv)
        r = c.get("/api/search/?q=rahul")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any(h["value"] == "Rahul Sharma" for h in r.data["entities"]))
        r = c.get("/api/search/?q=tower dump")
        self.assertTrue(any(h["file_name"] == "tower-dump-march.csv" for h in r.data["evidence"]))
        r = c.get("/api/search/?q=FIR-P6-3")
        self.assertTrue(any(h["fir_no"] == "FIR-P6-3" for h in r.data["cases"]))

    def test_typo_tolerance(self):
        from django.db import connection
        if connection.vendor != "postgresql":
            self.skipTest("trigram needs postgres")
        c = self._client(self.inv)
        r = c.get("/api/search/?q=Rahul Sharna")  # typo: Sharma -> Sharna
        self.assertTrue(any(h["value"] == "Rahul Sharma" for h in r.data["entities"]))

    def test_scoping_and_filters(self):
        inv_c, out_c = self._client(self.inv), _mkuser("out9", Role.INVESTIGATOR)
        out_c = self._client(out_c)
        self.assertEqual(out_c.get("/api/search/?q=rahul").data["entities"], [])
        r = inv_c.get(f"/api/search/?q=rahul&case_id={self.case.id}&type=Person")
        self.assertTrue(all(h["node_type"] == "Person" for h in r.data["entities"]))
        self.assertEqual(inv_c.get("/api/search/?q=rahul&case_id=99999").status_code, 404)
        self.assertEqual(out_c.get(f"/api/search/?q=rahul&case_id={self.case.id}").status_code, 403)
        self.assertEqual(inv_c.get("/api/search/?q=x").status_code, 200)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, GEMINI_API_KEY="test-key")
class GeminiFallbackTests(TestCase):
    """Retired-model 404s must walk the fallback chain, not outage the copilot."""

    def _client_with(self, calls, fail_models):
        import types as pytypes

        class _GenResp:
            def __init__(self, text):
                self.text = text

        class _Models:
            def generate_content(self, model=None, contents=None, **kwargs):
                calls.append(model)
                if model in fail_models:
                    raise Exception(
                        "404 NOT_FOUND. {'error': {'code': 404, 'message': "
                        f"'This model models/{model} is no longer available.', "
                        "'status': 'NOT_FOUND'}}")
                return _GenResp("fallback answer")

        class _Client:
            def __init__(self, api_key=None):
                self.models = _Models()

        mod = pytypes.ModuleType("google.genai")
        mod.Client = _Client
        parent = pytypes.ModuleType("google")
        parent.genai = mod
        return mock.patch.dict(sys.modules, {"google": parent, "google.genai": mod})

    def test_retired_default_falls_back(self):
        from apps.copilot.services import gemini
        calls: list = []
        with self._client_with(calls, {gemini._candidate_models()[0]}):
            out = gemini.generate("hello")
        self.assertEqual(out, "fallback answer")
        self.assertGreaterEqual(len(calls), 2)
        # First attempt is the configured model, second is a fallback.
        self.assertNotEqual(calls[0], calls[1])

    def test_all_models_down_raises_unavailable(self):
        from apps.copilot.services import gemini
        from apps.copilot.services.gemini import GeminiUnavailable
        calls: list = []
        with self._client_with(calls, set(gemini._candidate_models())):
            with self.assertRaises(GeminiUnavailable):
                gemini.generate("hello")

    def test_non_retired_error_does_not_fallback(self):
        import types as pytypes
        from apps.copilot.services import gemini
        from apps.copilot.services.gemini import GeminiUnavailable

        class _Models:
            def generate_content(self, model=None, contents=None, **kwargs):
                raise Exception("500 Internal error")

        class _Client:
            def __init__(self, api_key=None):
                self.models = _Models()

        mod = pytypes.ModuleType("google.genai")
        mod.Client = _Client
        parent = pytypes.ModuleType("google")
        parent.genai = mod
        with mock.patch.dict(sys.modules, {"google": parent, "google.genai": mod}):
            with self.assertRaises(GeminiUnavailable):
                gemini.generate("hello")
