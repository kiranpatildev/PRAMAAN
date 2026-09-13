"""Multilingual extraction tests: detection routing, Indic path, degradation.

Fixtures are short witness-statement-style Hindi/Marathi sentences. Pure
service tests use SimpleTestCase (no DB); pipeline/queue shape tests use
TestCase. The Indic model is NEVER loaded here — loader seams are
monkeypatched with canned logits, so these run in the base image. Real-model
numbers (l3cube-pune/marathi-ner, Monolingual-Hindi-NER) live in the
verification report, not in CI assertions.
"""
import sys
import types
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings

from .services import extract as X
from .services import indic_extract as IX
from .services.language import (
    INDIC_SUPPORTED,
    MIN_CHARS_FOR_DETECTION,
    detect_language,
    language_name,
    route_for,
)

# -- fixtures ---------------------------------------------------------------
HINDI_1 = (
    "गवाह राहुल शर्मा ने बताया कि उसने विक्रम पाटिल को 12 मार्च 2026 को "
    "पुणे रेलवे स्टेशन के पास देखा। विक्रम ने 9876543210 नंबर से फोन किया था।"
)
HINDI_2 = (
    "शर्मा ट्रांसपोर्ट ने विकास वर्मा को 50,000 रुपये का भुगतान किया। "
    "रिपोर्ट मुंबई पुलिस स्टेशन में दर्ज की गई।"
)
MARATHI_1 = (
    "साक्षीदार प्रिया देशमुख हिने सांगितले की तिने अमित पवार यांना "
    "12 मार्च 2026 रोजी पुणे रेल्वे स्टेशनजवळ पाहिले। अमितने 9811112233 या "
    "क्रमांकावरून फोन केला होता।"
)
MARATHI_2 = (
    "राहुल शिंदे हे शर्मा ट्रान्सपोर्टमध्ये काम करतात। त्यांनी नाशिक येथे "
    "MH12AB1234 क्रमांकाची गाडी पाहिली।"
)
ENGLISH_1 = (
    "Rahul Sharma called Vikram Patil from 9876543210 about MH12AB1234. "
    "They met near Pune railway station on 12 March 2026."
)

# Naamapadam-like tag set (+ MISC to prove skipping).
ID2LABEL = {0: "O", 1: "B-PER", 2: "I-PER", 3: "B-LOC",
            4: "I-LOC", 5: "B-ORG", 6: "I-ORG", 7: "B-MISC"}


def _canned_logits(n_tokens, placements):
    """Logit rows: weak background (correct=O @1.2) with strong/weak entity peaks.

    placements: {token_index: (label_id, strength)} where strength scales the
    correct-class logit — different strengths => non-constant confidences.
    """
    rows = []
    for i in range(n_tokens):
        row = [0.1] * len(ID2LABEL)
        row[0] = 1.2
        if i in placements:
            lid, strength = placements[i]
            row = [0.05] * len(ID2LABEL)
            row[lid] = strength
        rows.append(row)
    return rows


def _ws_tokens(text):
    toks, offs = [], []
    i = 0
    for word in text.split():
        a = text.index(word, i)
        toks.append(word)
        offs.append((a, a + len(word)))
        i = a + len(word)
    return toks, offs


class DetectionTests(SimpleTestCase):
    def test_hindi_detected(self):
        det = detect_language(HINDI_1)
        self.assertEqual(det["code"], "hi")
        self.assertTrue(det["trusted"])
        self.assertGreaterEqual(det["confidence"], 0.60)

    def test_hindi_2_detected(self):
        det = detect_language(HINDI_2)
        self.assertEqual(det["code"], "hi")
        self.assertTrue(det["trusted"])

    def test_marathi_detected(self):
        for text in (MARATHI_1, MARATHI_2):
            det = detect_language(text)
            self.assertEqual(det["code"], "mr")
            self.assertTrue(det["trusted"])

    def test_english_detected(self):
        det = detect_language(ENGLISH_1)
        self.assertEqual(det["code"], "en")
        self.assertTrue(det["trusted"])

    def test_short_text_never_trusted(self):
        # Measured: 2-word strings misdetect with HIGH pseudo-confidence
        # ("Rahul Sharma" -> so, Devanagari name -> ne). Length floor wins.
        for text in ("Rahul Sharma", "राहुल शर्मा", "पुणे", "9876543210 MH12AB1234"):
            det = detect_language(text)
            self.assertFalse(det["trusted"], text)
            self.assertEqual(det["code"], "")

    def test_empty_text(self):
        det = detect_language("")
        self.assertEqual((det["code"], det["confidence"], det["trusted"]), ("", 0.0, False))

    def test_romanized_hindi_not_indic_routed(self):
        # Measured: Latin-script Hindi detects as Indonesian — must NOT take
        # the Indic path (transliteration only normalizes *within* it).
        det = detect_language("Rahul Sharma ne bataya ki usne Vikram Patil ko Pune station ke paas dekha tha.")
        self.assertNotIn(det["code"], INDIC_SUPPORTED)
        self.assertEqual(route_for(det), "english")

    def test_language_names(self):
        self.assertEqual(language_name("hi"), "Hindi")
        self.assertEqual(language_name("mr"), "Marathi")
        self.assertEqual(language_name("xx"), "xx")
        self.assertEqual(language_name(""), "Unknown")

    def test_min_chars_documented(self):
        self.assertEqual(MIN_CHARS_FOR_DETECTION, 40)


class RoutingTests(SimpleTestCase):
    def test_trusted_indic_routes_indic(self):
        for code in ("hi", "mr", "bn", "ta"):
            self.assertEqual(route_for({"code": code, "trusted": True}), "indic")

    def test_english_routes_english(self):
        self.assertEqual(route_for({"code": "en", "confidence": 1.0, "trusted": True}), "english")

    def test_untrusted_routes_english(self):
        self.assertEqual(route_for({"code": "hi", "confidence": 0.4, "trusted": False}), "english")
        self.assertEqual(route_for({"code": "", "confidence": 0.0, "trusted": False}), "english")

    def test_trusted_non_indic_latin_routes_english(self):
        det = {"code": "id", "confidence": 0.71, "trusted": True}
        self.assertEqual(route_for(det, "Rahul Sharma ne bataya ki usne Vikram Patil ko dekha tha."), "english")

    def test_trusted_non_latin_without_model_is_unsupported(self):
        det = {"code": "ur", "confidence": 0.9, "trusted": True}
        self.assertEqual(route_for(det, "گواہ نے بیان دیا کہ ملزم موقع پر موجود تھا اور اس نے فون کیا تھا۔"), "unsupported")

    def test_trusted_unsupported_extracts_nothing(self):
        ents, status, _det = X.extract_for_evidence(
            "گواہ نے بیان دیا کہ ملزم موقع پر موجود تھا اور اس نے فون کیا تھا۔ "
            "یہ بیان قلمبند کر لیا گیا ہے اور تفتیش جاری ہے۔",
            {"code": "ur", "confidence": 0.95, "trusted": True}, 7)
        self.assertEqual((ents, status), ([], "unsupported_language"))

    def test_unsupported_never_touches_spacy(self):
        text = ("گواہ نے بیان دیا کہ ملزم موقع پر موجود تھا اور اس نے فون کیا تھا۔ "
                "یہ بیان قلمبند کر لیا گیا ہے اور تفتیش جاری ہے۔")
        with mock.patch.object(X, "extract_entities") as m:
            m.side_effect = AssertionError("spaCy path must not run")
            X.extract_for_evidence(text, {"code": "ur", "confidence": 0.9, "trusted": True}, 1)
            m.assert_not_called()

    def test_english_path_is_plain_extract_entities(self):
        with mock.patch.object(X, "extract_entities", wraps=X.extract_entities) as m:
            ents, status, _det = X.extract_for_evidence(ENGLISH_1, None, 3)
            self.assertEqual(status, "ok")
            m.assert_called_once()
            for e in ents:
                self.assertNotIn("native_snippet", e)


class SoftmaxDecodeTests(SimpleTestCase):
    def test_softmax_sums_to_one_and_peaks(self):
        probs = IX.softmax([5.0, 1.0, 0.1])
        self.assertAlmostEqual(sum(probs), 1.0, places=6)
        self.assertGreater(probs[0], 0.9)

    def test_bio_decode_person(self):
        text = "राहुल शर्मा ने बताया"
        toks, offs = _ws_tokens(text)
        logits = _canned_logits(len(toks), {0: (1, 5.0), 1: (2, 5.0)})
        spans, skipped = IX.decode_predictions(toks, offs, logits, ID2LABEL, text)
        self.assertEqual(skipped, [])
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0]["raw_label"], "PER")
        self.assertEqual(spans[0]["surface"], "राहुल शर्मा")
        self.assertGreater(spans[0]["confidence"], 0.9)

    def test_confidences_are_model_derived_not_constant(self):
        text = "राहुल शर्मा विक्रम पाटिल पुणे"
        toks, offs = _ws_tokens(text)
        logits = _canned_logits(len(toks), {0: (1, 6.0), 1: (2, 6.0), 2: (1, 2.0), 3: (2, 2.0), 4: (3, 4.0)})
        spans, _sk = IX.decode_predictions(toks, offs, logits, ID2LABEL, text)
        confs = sorted(s["confidence"] for s in spans)
        self.assertEqual(len(spans), 3)
        self.assertGreater(len(set(confs)), 1)  # strong != weak
        self.assertTrue(all(0.0 < c < 1.0 for c in confs))

    def test_misc_skipped_loudly(self):
        text = "राहुल शर्मा दिवाळी"
        toks, offs = _ws_tokens(text)
        logits = _canned_logits(len(toks), {0: (1, 5.0), 1: (2, 5.0), 2: (7, 5.0)})
        spans, skipped = IX.decode_predictions(toks, offs, logits, ID2LABEL, text)
        self.assertEqual(len(spans), 1)
        self.assertEqual(skipped, ["MISC"])

    def test_o_and_specials_close_spans(self):
        text = "राहुल शर्मा पुणे"
        toks = ["[CLS]", "राहुल", "शर्मा", "पुणे", "[SEP]"]
        offs = [(0, 0), (0, 5), (6, 11), (12, 16), (0, 0)]
        logits = _canned_logits(5, {1: (1, 5.0), 2: (2, 5.0), 3: (3, 5.0)})
        spans, _sk = IX.decode_predictions(toks, offs, logits, ID2LABEL, text)
        self.assertEqual([(s["raw_label"], s["surface"]) for s in spans],
                         [("PER", "राहुल शर्मा"), ("LOC", "पुणे")])

    def test_type_switch_starts_new_span(self):
        text = "राहुल पुणे"
        toks, offs = _ws_tokens(text)
        logits = _canned_logits(2, {0: (1, 5.0), 1: (4, 5.0)})  # B-PER then I-LOC
        spans, _sk = IX.decode_predictions(toks, offs, logits, ID2LABEL, text)
        self.assertEqual([s["raw_label"] for s in spans], ["PER", "LOC"])


class FakeTokenizer:
    """Whitespace tokenizer with real char offsets (mirrors fast-tokenizer shape)."""

    def __call__(self, text, **kwargs):
        toks, offs = _ws_tokens(text)
        return {"input_ids": list(range(len(toks))), "offset_mapping": offs,
                "tokens": toks, "offsets": offs}

    def convert_ids_to_tokens(self, ids):
        return [f"tok{i}" for i in ids]


def _fake_logits_for(placements_by_sentence):
    def _fake(model, tokenizer, text):
        toks, offs = _ws_tokens(text)
        key = " ".join(toks[:4])
        placements = placements_by_sentence.get(key, {})
        rows = []
        for i in range(len(toks)):
            row = [0.1] * len(ID2LABEL)
            row[0] = 1.2
            if i in placements:
                lid, strength = placements[i]
                row = [0.05] * len(ID2LABEL)
                row[lid] = strength
            rows.append(row)
        return toks, offs, rows
    return _fake


class IndicExtractTests(SimpleTestCase):
    def test_entities_match_contract_with_native_snippets(self):
        text = "राहुल शर्मा पुणे"
        with mock.patch.object(IX, "_get_components", return_value=(FakeTokenizer(), object(), ID2LABEL)), \
             mock.patch.object(IX, "_logits_for", side_effect=_fake_logits_for(
                 {"राहुल शर्मा पुणे": {0: (1, 5.0), 1: (2, 5.0), 2: (3, 4.0)}})), \
             mock.patch.object(IX, "normalize_roman", side_effect=lambda s, lang: (s, False)):
            found = IX.extract_indic_entities(text, "hi", 9)
        by_type = {(e["node_type"], e["value"]) for e in found}
        self.assertIn(("Person", "राहुल शर्मा"), by_type)
        self.assertIn(("Location", "पुणे"), by_type)
        for e in found:
            for key in ("node_type", "value", "confidence", "span", "engine",
                        "native_snippet", "source_evidence_id"):
                self.assertIn(key, e)
            self.assertEqual(e["engine"], "indic-ner")
            self.assertEqual(e["source_evidence_id"], 9)
            self.assertTrue(e["native_snippet"])
            self.assertIn("confidence", e)
        confs = {e["confidence"] for e in found}
        self.assertGreater(len(confs), 1)

    def test_normalize_roman_skips_native_without_import(self):
        self.assertNotIn("ai4bharat", sys.modules)
        out, applied = IX.normalize_roman("राहुल शर्मा ने बताया", "hi")
        self.assertEqual((out, applied), ("राहुल शर्मा ने बताया", False))
        self.assertNotIn("ai4bharat", sys.modules)

    def test_normalize_roman_uses_engine_when_latin_present(self):
        fake = types.SimpleNamespace(translit_sentence=lambda t, lang: "राहुल शर्मा")
        with mock.patch.dict(IX._XLIT_ENGINES, {}, clear=False):
            IX._XLIT_ENGINES["hi"] = fake
            try:
                out, applied = IX.normalize_roman("Rahul Sharma", "hi")
                self.assertEqual((out, applied), ("राहुल शर्मा", True))
            finally:
                IX._XLIT_ENGINES.pop("hi", None)

    def test_normalize_roman_missing_package_passes_through(self):
        with mock.patch.dict(sys.modules, {"ai4bharat": None, "ai4bharat.transliteration": None}):
            with mock.patch.dict(IX._XLIT_ENGINES, {}, clear=True):
                out, applied = IX.normalize_roman("Rahul Sharma", "hi")
                self.assertEqual((out, applied), ("Rahul Sharma", False))

    def test_loader_failure_raises_indic_unavailable(self):
        with mock.patch.object(IX, "_get_components",
                               side_effect=IX.IndicUnavailable("load-failed", "gated")):
            with self.assertRaises(IX.IndicUnavailable):
                IX.extract_indic_entities(HINDI_1, "hi", 1)

    def test_alias_fragment_folds_into_full_name(self):
        text = "विक्रम पाटिल विक्रम"
        with mock.patch.object(IX, "_get_components", return_value=(FakeTokenizer(), object(), ID2LABEL)), \
             mock.patch.object(IX, "_logits_for", side_effect=_fake_logits_for(
                 {"विक्रम पाटिल विक्रम": {0: (1, 5.0), 1: (2, 5.0), 2: (1, 5.0)}})), \
             mock.patch.object(IX, "normalize_roman", side_effect=lambda s, lang: (s, False)):
            found = IX.extract_indic_entities(text, "hi", 1)
        values = [e["value"] for e in found]
        self.assertIn("विक्रम पाटिल", values)
        self.assertNotIn("विक्रम", values)


class DegradationTests(SimpleTestCase):
    def test_model_load_failure_extracts_nothing(self):
        det = {"code": "hi", "confidence": 1.0, "trusted": True}
        with mock.patch.object(IX, "_get_components",
                               side_effect=IX.IndicUnavailable("load-failed", "401 gated")):
            ents, status, _d = X.extract_for_evidence(HINDI_1, det, 5)
        self.assertEqual(ents, [])
        self.assertEqual(status, "unsupported_language")

    def test_missing_torch_extracts_nothing(self):
        det = {"code": "mr", "confidence": 0.9, "trusted": True}
        with mock.patch.object(IX, "_get_components",
                               side_effect=IX.IndicUnavailable("no-torch", "x")):
            ents, status, _d = X.extract_for_evidence(MARATHI_1, det, 5)
        self.assertEqual(ents, [])
        self.assertEqual(status, "unsupported_language")


class ResolveXlitTests(SimpleTestCase):
    def test_ascii_passthrough_without_import(self):
        self.assertNotIn("ai4bharat", sys.modules)
        from .services.resolve import transliterate
        self.assertEqual(transliterate("rahul sharma"), "rahul sharma")
        self.assertNotIn("ai4bharat", sys.modules)

    def test_latin_scores_unchanged(self):
        from .services.resolve import person_score
        self.assertEqual(person_score("rahul sharma", "rahul sharma"), (0.95, "exact-name"))
        self.assertEqual(person_score("r. sharma", "rahul sharma"), (0.80, "initial-surname"))
        self.assertEqual(person_score("rahul sharma", "vikram patil"), (0.0, ""))

    def test_cross_script_fallback_capped(self):
        from .services import resolve as R
        with mock.patch.object(R, "transliterate",
                               side_effect=lambda t, target_script="latin":
                               "rahul sharma" if t == "राहुल शर्मा" else t):
            score, reason = R.person_score("राहुल शर्मा", "rahul sharma")
        self.assertEqual(score, 0.85)
        self.assertEqual(reason, "xlit-exact-name")

    def test_engine_failure_keeps_zero(self):
        from .services import resolve as R
        with mock.patch.object(R, "transliterate", side_effect=lambda t, target_script="latin": t):
            self.assertEqual(R.person_score("राहुल शर्मा", "rahul sharma"), (0.0, ""))


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class PipelineLanguageTests(TestCase):
    def setUp(self):
        from apps.accounts.models import Role, User
        from apps.cases.models import Case
        from apps.evidence.models import Evidence
        self.sho = User.objects.create_user("sho_ml", password="pw123456", role=Role.SHO)
        self.case = Case.objects.create(fir_no="FIR-ML-1", title="multilingual", owner=self.sho)
        blob = "x".encode()
        self.ev_hi = Evidence.objects.create(
            case=self.case, file_name="hindi.txt", mime_type="text/plain", size_bytes=len(blob),
            sha256=Evidence.hash_bytes(blob), storage_key="k-hi", uploaded_by=self.sho,
            ocr_status="done", ocr_engine="raw-text", ocr_text=HINDI_1)
        self.ev_en = Evidence.objects.create(
            case=self.case, file_name="eng.txt", mime_type="text/plain", size_bytes=len(blob),
            sha256=Evidence.hash_bytes(blob), storage_key="k-en", uploaded_by=self.sho,
            ocr_status="done", ocr_engine="raw-text", ocr_text=ENGLISH_1)

    def _canned_indic(self, text, language, source_evidence_id=""):
        del language
        if "राहुल शर्मा" in text and "विक्रम पाटिल" in text:
            return [
                {"node_type": "Person", "value": "राहुल शर्मा", "confidence": 0.93,
                 "span": [0, 11], "engine": "indic-ner", "native_snippet": text[:280],
                 "source_evidence_id": source_evidence_id},
                {"node_type": "Person", "value": "विक्रम पाटिल", "confidence": 0.81,
                 "span": [20, 32], "engine": "indic-ner", "native_snippet": text[:280],
                 "source_evidence_id": source_evidence_id},
                {"node_type": "Location", "value": "पुणे रेलवे स्टेशन", "confidence": 0.77,
                 "span": [40, 58], "engine": "indic-ner", "native_snippet": text[:280],
                 "source_evidence_id": source_evidence_id},
            ]
        return []

    def test_hindi_evidence_routes_indic_and_persists(self):
        from .models import ExtractedEntity
        from .tasks import extract_entities, extract_relations
        with mock.patch.object(IX, "extract_indic_entities", side_effect=self._canned_indic):
            r = extract_entities(self.ev_hi.id)
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["language"], "hi")
        self.assertGreaterEqual(r["entities"], 3)
        self.ev_hi.refresh_from_db()
        self.assertEqual(self.ev_hi.detected_language, "hi")
        self.assertGreater(self.ev_hi.detected_language_confidence, 0.0)
        self.assertEqual(self.ev_hi.extraction_status, "ok")
        rows = ExtractedEntity.objects.filter(case=self.case, engine="indic-ner")
        self.assertGreaterEqual(rows.count(), 3)
        first = rows.order_by("id").first()
        self.assertTrue(first.native_snippet)
        confs = set(rows.values_list("confidence", flat=True))
        self.assertGreater(len(confs), 1)  # real, non-constant confidences
        # Relations run over the same rows with the unchanged writer.
        r2 = extract_relations(self.ev_hi.id)
        self.assertEqual(r2["status"], "ok")
        self.assertGreaterEqual(r2["relations"], 1)

    def test_review_queue_shape_carries_language_fields(self):
        from rest_framework.test import APIClient
        from .tasks import extract_entities
        with mock.patch.object(IX, "extract_indic_entities", side_effect=self._canned_indic):
            extract_entities(self.ev_hi.id)
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": "sho_ml", "password": "pw123456"})
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        lst = c.get(f"/api/entities/review/entities/?case_id={self.case.id}&status=pending")
        self.assertEqual(lst.status_code, 200)
        row = lst.data["results"][0]
        self.assertIn("native_snippet", row)
        self.assertEqual(row["detected_language"], "hi")

    def test_english_evidence_unchanged(self):
        from .tasks import extract_entities
        r = extract_entities(self.ev_en.id)
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["language"], "en")
        self.ev_en.refresh_from_db()
        self.assertEqual(self.ev_en.detected_language, "en")
        self.assertEqual(self.ev_en.extraction_status, "ok")

    def test_degradation_persists_unsupported_and_writes_nothing(self):
        from apps.evidence.models import Evidence
        from .models import ExtractedEntity
        from .tasks import extract_entities
        blob = "y".encode()
        ev = Evidence.objects.create(
            case=self.case, file_name="tamil.txt", mime_type="text/plain", size_bytes=len(blob),
            sha256=Evidence.hash_bytes(blob), storage_key="k-ta", uploaded_by=self.sho,
            ocr_status="done", ocr_engine="raw-text",
            ocr_text="சாட்சி ராகுல் சர்மா சென்னை காவல் நிலையத்தில் புகார் அளித்தார்। " * 3)
        n_before = ExtractedEntity.objects.filter(case=self.case).count()
        with mock.patch.object(IX, "_get_components",
                               side_effect=IX.IndicUnavailable("load-failed", "gated")):
            r = extract_entities(ev.id)
        self.assertEqual(r["status"], "unsupported_language")
        ev.refresh_from_db()
        self.assertEqual(ev.extraction_status, "unsupported_language")
        self.assertEqual(ExtractedEntity.objects.filter(case=self.case).count(), n_before)


class RunOcrDetectionTests(TestCase):
    def test_run_ocr_persists_language(self):
        from unittest.mock import patch
        from apps.evidence.models import Evidence
        from apps.evidence.tasks import run_ocr
        blob = HINDI_1.encode()
        ev = Evidence.objects.create(
            case=self.case, file_name="h.txt", mime_type="text/plain", size_bytes=len(blob),
            sha256=Evidence.hash_bytes(blob), storage_key="k-runocr", uploaded_by=self.sho)
        with patch("apps.evidence.services.storage.download_bytes", return_value=blob):
            r = run_ocr(ev.id)
        self.assertEqual(r["status"], "done")
        ev.refresh_from_db()
        self.assertEqual(ev.detected_language, "hi")
        self.assertGreater(ev.detected_language_confidence, 0.0)

    def setUp(self):
        from apps.accounts.models import Role, User
        from apps.cases.models import Case
        self.sho = User.objects.create_user("sho_mlocr", password="pw123456", role=Role.SHO)
        self.case = Case.objects.create(fir_no="FIR-ML-OCR", title="ocr-lang", owner=self.sho)
