"""Entity + relation extraction (Phase 3): regex first, spaCy second, IndicNER third.

Layers (cheap -> expensive), each emitting {node_type, value, confidence,
span, engine} with `extracted_by` attribution:
  1. `regex` — Indian-context patterns: phones (+91/10-digit), vehicle plates,
     money amounts (used as relation evidence, not nodes). Deterministic and
     script-agnostic for Latin digits — shared by both language paths.
  2. `spacy` — en_core_web_sm for PERSON/ORG/GPE/LOC (English path only).
     Small-model noise (phones/amounts tagged DATE) is suppressed: regex
     spans always win, and single-token PERSON/ORG matching a known
     multi-token person's name part is folded into that person as an alias
     mention.
  3. `indic-ner` — ai4bharat/IndicNER via transformers (Indic path only, see
     `indic_extract.py`): real softmax confidences, explicit PER/LOC/ORG
     mapping, native-script snippets retained.

Routing lives in `extract_for_evidence()`: trusted Indic detections go to
path 3 (+ regex), everything else runs paths 1+2 byte-identically to before.
Trusted-but-unsupported languages yield status "unsupported_language" with
ZERO entities — never spaCy-on-Hindi garbage.

Relation extraction is sentence-level co-occurrence with verb-pattern typing
(CALLED / TRANSFERRED_MONEY_TO / ASSOCIATED_WITH / PRESENT_AT / OWNS /
EMPLOYED_BY). Every relation carries the source sentence as evidence snippet.
Known limitation (documented, not hidden): verb lexicons and money patterns
are English, so Indic text mostly yields PRESENT_AT + co-occurrence
ASSOCIATED_WITH edges. Entity extraction — the evidentiary core — is fully
native; verb localization is tracked follow-up work.
"""
from __future__ import annotations

import logging
import re
import unicodedata

log = logging.getLogger(__name__)

# -- regex layer -------------------------------------------------------------
PHONE_RE = re.compile(r"(?:\+?91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}\b")
# Indian plates: MH12AB1234, MH-12-AB-1234, MH 12 AB 1234 (+ Bharat series DL1Z...).
PLATE_RE = re.compile(r"\b[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{3,4}\b")
MONEY_RE = re.compile(r"(?:Rs\.?|INR|₹)\s?[\d,]+(?:\.\d{1,2})?|\b[\d,]+\s?(?:rupees|lakh|lakhs|crore)\b", re.IGNORECASE)
# The danda branch (।, with or without following space) only ever fires on
# Indic text — English splitting is byte-identical to before.
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])|।\s*")

# Temporal layer: explicit dates anchor relations in time (valid_from).
# Indian-context formats: "12 March 2026", "2026-03-12", "12/03/2026" (DD/MM).
MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
DATE_RE_TEXT = re.compile(r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})\b", re.IGNORECASE)
DATE_RE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DATE_RE_NUM = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")


def parse_dates(text: str) -> list[str]:
    """Explicit calendar dates in text -> sorted unique ISO YYYY-MM-DD strings.

    Numeric dates read DD/MM/YYYY (Indian convention); impossible dates
    (32/13/2026) are dropped. No inference — undated text yields [].
    """
    import datetime as _dt

    found: set[str] = set()

    def _add(y: int, m: int, d: int):
        try:
            found.add(_dt.date(y, m, d).isoformat())
        except ValueError:
            pass

    for m in DATE_RE_TEXT.finditer(text or ""):
        _add(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    for m in DATE_RE_ISO.finditer(text or ""):
        _add(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    for m in DATE_RE_NUM.finditer(text or ""):
        y = int(m.group(3))
        _add(2000 + y if y < 100 else y, int(m.group(2)), int(m.group(1)))
    return sorted(found)

CALL_VERBS = ("call", "called", "calling", "spoke", "spoken", "contacted", "contact", "rang", "phone", "phoned")
MEET_VERBS = ("met", "meet", "meeting", "seen with", "gathered", "visited")
MONEY_VERBS = ("paid", "pay", "transferred", "transfer", "sent money", "wired", "deposited")
OWN_VERBS = ("owns", "owned", "owner of", "belongs to", "registered", "driving", "drove")
WORK_VERBS = ("works", "worked", "working", "employed", "employee", "member of", "joined")

# Regex-name fallback: en_core_web_sm misses Indian names in noisy contexts
# (parentheticals, PRODUCT mistags). Two/three capitalized words, minus generic
# phrases — the gap IndicBERT (requirements-ml.txt) will fill properly.
NAME_RE = re.compile(r"\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,2})\b")
STOP_WORDS = {
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday",
    "police", "station", "report", "first", "information", "call", "bank",
    "statement", "court", "fir", "cdr", "tower", "dump", "analysis", "mobile",
    "swift", "white", "black", "near", "dated",
}
# Single-token all-caps noise the model emits as ORG (UTR numbers etc.).
NOISE_TOKENS = {"UTR", "FIR", "CDR", "UPI", "OTP", "SMS", "EMI", "ATM", "PAN", "GST", "NEFT", "RTGS", "IFSC"}

_NLP = None


def get_nlp():
    """spaCy model or None (regex-only mode). Cached; never raises."""
    global _NLP
    if _NLP is None:
        try:
            import spacy
            try:
                _NLP = spacy.load("en_core_web_sm")
            except OSError:
                log.warning("en_core_web_sm missing — regex-only extraction (python -m spacy download en_core_web_sm)")
                _NLP = False
        except ImportError:
            log.warning("spacy not installed — regex-only extraction")
            _NLP = False
    return _NLP or None


def normalize_value(node_type: str, value: str) -> str:
    """Canonical key shared by extraction, resolution, and Neo4j node keys."""
    v = unicodedata.normalize("NFKC", (value or "").strip())
    if node_type == "PhoneNumber":
        digits = re.sub(r"\D", "", v)
        if len(digits) > 10 and digits.startswith("91"):
            digits = digits[2:]
        return digits[-10:] if len(digits) >= 10 else digits
    if node_type == "Vehicle":
        return re.sub(r"[^A-Z0-9]", "", v.upper())
    v = re.sub(r"^(mr|mrs|ms|shri|smt|late)\.?\s+", "", v, flags=re.IGNORECASE)
    v = re.sub(r"\s+", " ", re.sub(r"[^\w\s.\-']", "", v, flags=re.UNICODE)).strip().lower()
    return v


def _spans_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _match_regex(text: str) -> list[tuple]:
    """Deterministic phone/plate matches: [(node_type, value, confidence, span, engine)].

    Shared by both language paths (Latin-digit patterns are script-agnostic).
    No dedup here — the caller's collector applies span claiming.
    """
    out = []
    for m in PHONE_RE.finditer(text or ""):
        out.append(("PhoneNumber", m.group(), 0.95, m.span(), "regex"))
    for m in PLATE_RE.finditer(text or ""):
        plate = re.sub(r"[\s\-]", "", m.group())
        if len(re.sub(r"[^A-Z0-9]", "", plate.upper())) >= 8:
            out.append(("Vehicle", plate, 0.90, m.span(), "regex"))
    return out


def _make_collector(source_evidence_id):
    """Shared span-claiming collector -> (add, dedupe).

    `add` normalizes, drops empties/overlaps, and preserves any extra keys
    the caller passes (e.g. native_snippet from the Indic path). `dedupe`
    keeps the best-confidence row per (type, normalized).
    """
    found: list[dict] = []
    claimed: list[tuple[int, int]] = []

    def add(node_type, value, confidence, span, engine, **extra):
        norm = normalize_value(node_type, value)
        if not norm or any(_spans_overlap(span, c) for c in claimed):
            return
        claimed.append(span)
        found.append({
            "node_type": node_type, "value": (value or "").strip(), "normalized": norm,
            "confidence": confidence, "span": [span[0], span[1]], "engine": engine,
            "source_evidence_id": source_evidence_id,
            **extra,
        })

    def dedupe():
        best: dict[tuple[str, str], dict] = {}
        for ent in found:
            key = (ent["node_type"], ent["normalized"])
            if key not in best or ent["confidence"] > best[key]["confidence"]:
                best[key] = ent
        return sorted(best.values(), key=lambda e: e["span"][0])

    return add, dedupe, claimed, found


def extract_entities(text: str, source_evidence_id: int | str = "") -> list[dict]:
    """Return deduped entities: {node_type, value, normalized, confidence, span, engine}.

    THE English path. Behavior is frozen: routing sends all non-Indic text
    here, and existing tests pin its outputs exactly.
    """
    text = text or ""
    add, dedupe, claimed, found = _make_collector(source_evidence_id)

    for node_type, value, confidence, span, engine in _match_regex(text):
        add(node_type, value, confidence, span, engine)

    nlp = get_nlp()
    persons: dict[str, str] = {}  # normalized -> display value (multi-token first)
    if nlp is not None:
        doc = nlp(text[:100_000])  # cap for demo-scale latency
        multi = [e for e in doc.ents if e.label_ == "PERSON" and len(e.text.split()) > 1]
        for e in multi:
            persons.setdefault(normalize_value("Person", e.text), e.text.strip())
        for e in doc.ents:
            span = (e.start_char, e.end_char)
            if e.label_ == "PERSON":
                norm = normalize_value("Person", e.text)
                if len(e.text.split()) == 1:
                    # Alias of a known person? ("Vikram" when "Vikram Patil" seen)
                    target = next((p for n, p in persons.items()
                                   if norm in n.split() or n in norm.split()), None)
                    if target is not None:
                        continue  # alias mention; canonical person already recorded
                    add("Person", e.text, 0.55, span, "spacy")
                else:
                    add("Person", e.text, 0.75, span, "spacy")
            elif e.label_ == "ORG":
                if e.text.strip().upper() not in NOISE_TOKENS:
                    add("Organization", e.text, 0.65, span, "spacy")
            elif e.label_ in ("GPE", "LOC", "FAC"):
                add("Location", e.text, 0.65, span, "spacy")
            # DATE/CARDINAL/MONEY deliberately ignored: regex owns phones/plates/amounts.

    # Regex-name fallback for person names the small model misses (parens,
    # PRODUCT/TIME mistags). Runs last so claimed spans (incl. ORG/LOC) win.
    for m in NAME_RE.finditer(text):
        phrase = m.group(1)
        tokens = phrase.split()
        if any(t.lower() in STOP_WORDS for t in tokens):
            continue
        if any(_spans_overlap(m.span(), c) for c in claimed):
            continue
        norm = normalize_value("Person", phrase)
        if not norm:
            continue
        claimed.append(m.span())
        found.append({
            "node_type": "Person", "value": phrase, "normalized": norm,
            "confidence": 0.50, "span": [m.start(), m.end()], "engine": "regex-name",
            "source_evidence_id": source_evidence_id,
        })

    return dedupe()


def extract_for_evidence(text: str, detection: dict | None = None,
                         source_evidence_id: int | str = "") -> tuple[list[dict], str, dict]:
    """Language-routed extraction -> (entities, status, detection).

    detection is a `language.detect_language()` dict; None detects internally
    (single source of truth — callers must NOT pre-filter by script).
    status is "ok" or "unsupported_language" (trusted non-Indic language with
    no model: extracts NOTHING, by design). The English path below is a plain
    call into `extract_entities` — frozen behavior, zero regression surface.
    """
    from .language import detect_language, route_for

    text = text or ""
    if detection is None:
        detection = detect_language(text)
    route = route_for(detection, text)
    if route == "english":
        return extract_entities(text, source_evidence_id), "ok", detection
    if route == "unsupported":
        log.warning("unsupported extraction language %s — extracting nothing",
                    detection.get("code", "?"))
        return [], "unsupported_language", detection
    # Indic path: deterministic regex layer (phones/plates) + IndicNER spans
    # through the same span-claiming collector (regex wins overlaps).
    from .indic_extract import IndicUnavailable, extract_indic_entities

    code = detection.get("code", "")
    try:
        raw = extract_indic_entities(text, code, source_evidence_id)
    except IndicUnavailable as exc:
        log.warning("indic path unavailable (%s) — extracting nothing", exc.reason)
        return [], "unsupported_language", detection
    add, dedupe, _claimed, _found = _make_collector(source_evidence_id)
    for node_type, value, confidence, span, engine in _match_regex(text):
        add(node_type, value, confidence, span, engine)
    for ent in raw:
        add(ent["node_type"], ent["value"], ent["confidence"], tuple(ent["span"]),
            ent["engine"], native_snippet=ent.get("native_snippet", ""))
    return dedupe(), "ok", detection


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in SENT_SPLIT_RE.split(text or "") if s.strip()]


def _alias_maps(persons: list[dict]) -> dict[str, dict]:
    """Unambiguous first/last-name tokens -> canonical person (for alias mentions).

    "Rahul owns ..." resolves to Rahul Sharma only if no other known person
    shares that token; ambiguous tokens never resolve (no false attribution).
    """
    first: dict[str, list[dict]] = {}
    last: dict[str, list[dict]] = {}
    for p in persons:
        toks = p["normalized"].split()
        if toks:
            first.setdefault(toks[0], []).append(p)
            last.setdefault(toks[-1], []).append(p)
    return {t: ps[0] for d in (first, last) for t, ps in d.items() if len(ps) == 1}


def _mentions(sentence: str, entities: list[dict], aliases: dict[str, dict] | None = None) -> list[dict]:
    """Entities occurring in a sentence (full name, or unambiguous alias token).

    Alias tokens never fire inside another matched entity's span, so the
    "Sharma" in "Sharma Transports" is not misread as Rahul Sharma.
    """
    hits = []
    lowered = sentence.lower()
    occupied: list[tuple[int, int]] = []
    seen_ids = set()

    def _overlaps(span: tuple[int, int]) -> bool:
        return any(s < span[1] and span[0] < e for s, e in occupied)

    for ent in entities:
        idx = lowered.find(ent["value"].lower())
        if idx >= 0 or ent["normalized"] in normalize_value(ent["node_type"], sentence):
            hits.append(ent)
            seen_ids.add(id(ent))
            if idx >= 0:
                occupied.append((idx, idx + len(ent["value"])))
    if aliases:
        for token, person in aliases.items():
            if id(person) in seen_ids:
                continue
            for m in re.finditer(rf"\b{re.escape(token)}\b", lowered):
                if not _overlaps(m.span()):
                    hits.append(person)
                    seen_ids.add(id(person))
                    occupied.append(m.span())
                    break
    return hits


def _has_verb(sentence: str, verbs: tuple[str, ...]) -> bool:
    s = sentence.lower()
    return any(v in s for v in verbs)


def extract_relations(text: str, entities: list[dict], source_evidence_id: int | str = "") -> list[dict]:
    """Sentence-level typed relations with evidence snippets.

    Returns {src, dst (normalized keys), src_type, dst_type, edge_type,
    confidence, snippet, engine}.
    """
    relations: list[dict] = []
    seen: set[tuple] = set()
    person_ents = [e for e in entities if e["node_type"] == "Person"]
    aliases = _alias_maps(person_ents)
    for sent in _sentences(text):
        if len(sent) > 2000:
            continue
        lowered_sent = sent.lower()
        m = _mentions(sent, entities, aliases)

        def _order(group: list[dict]) -> list[dict]:
            # Textual order => deterministic edge direction (subject usually first).
            return sorted(group, key=lambda e: lowered_sent.find(e["value"].lower()))

        persons = _order([e for e in m if e["node_type"] == "Person"])
        phones = _order([e for e in m if e["node_type"] == "PhoneNumber"])
        locs = _order([e for e in m if e["node_type"] == "Location"])
        vehicles = _order([e for e in m if e["node_type"] == "Vehicle"])
        orgs = _order([e for e in m if e["node_type"] == "Organization"])
        snippet = sent[:280]
        sent_dates = parse_dates(sent)
        valid_from = sent_dates[0] if sent_dates else None

        def emit(a, b, edge_type, confidence, engine="pattern"):
            key = (a["normalized"], b["normalized"], edge_type)
            if a["normalized"] == b["normalized"] or key in seen:
                return
            seen.add(key)
            relations.append({
                "src": a["normalized"], "dst": b["normalized"],
                "src_type": a["node_type"], "dst_type": b["node_type"],
                "src_value": a["value"], "dst_value": b["value"],
                "edge_type": edge_type, "confidence": confidence,
                "snippet": snippet, "engine": engine,
                "valid_from": valid_from,
                "source_evidence_id": source_evidence_id,
            })

        money = MONEY_RE.search(sent)
        if _has_verb(sent, CALL_VERBS):
            for i, a in enumerate(persons):
                for b in persons[i + 1:]:
                    emit(a, b, "CALLED", 0.60)
            for a in persons:
                for b in phones:
                    emit(a, b, "CALLED", 0.55)
        if money and _has_verb(sent, MONEY_VERBS):
            # Payer -> payee in textual order; org payers (fronts, firms) allowed
            # at slightly lower confidence than person-to-person transfers.
            parties = _order([e for e in m if e["node_type"] in ("Person", "Organization")])
            if len(parties) >= 2 and parties[0]["normalized"] != parties[1]["normalized"]:
                both_persons = parties[0]["node_type"] == "Person" and parties[1]["node_type"] == "Person"
                emit(parties[0], parties[1], "TRANSFERRED_MONEY_TO", 0.60 if both_persons else 0.55)
        if _has_verb(sent, MEET_VERBS):
            for i, a in enumerate(persons):
                for b in persons[i + 1:]:
                    emit(a, b, "ASSOCIATED_WITH", 0.55)
        if _has_verb(sent, OWN_VERBS):
            for a in persons:
                for b in phones + vehicles:
                    emit(a, b, "OWNS", 0.60)
        if _has_verb(sent, WORK_VERBS):
            for a in persons:
                for b in orgs:
                    emit(a, b, "EMPLOYED_BY", 0.55)
        for a in persons:
            for b in locs:
                emit(a, b, "PRESENT_AT", 0.50)
        # Fallback: co-occurring persons with no verb signal are weakly linked.
        if len(persons) >= 2 and not any(r["snippet"] == snippet for r in relations):
            for i, a in enumerate(persons):
                for b in persons[i + 1:]:
                    emit(a, b, "ASSOCIATED_WITH", 0.45, engine="cooccurrence")
    return relations
