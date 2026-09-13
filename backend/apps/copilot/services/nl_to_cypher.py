"""NL-to-Cypher safety core: schema injector, verifier gate, scoped executor.

STAGE 2 (this module's `verify_and_scope`) is deterministic — zero LLM
involvement. Every generated query passes through it before execution:

  1. banned-keyword tripwire on literal-stripped text (regex, first pass);
  2. grammar parse (`cypher_parse`) — anything outside the read-only subset
     is a syntax error, never executed;
  3. AST checks: single MATCH, every node aliased + :Case-labeled, labels /
     rel types / properties against the schema constants, aliases resolve,
     functions allowlisted, no SKIP / variable paths / procedures;
  4. scope injection: `alias.case_id IN $case_ids` ANDed (parenthesized)
     onto every MATCH endpoint alias; any LIMIT rewritten to the clamp.
     `$case_ids` is server-set from `visible_case_ids()` — model params can
     never widen it (a colliding key is overwritten).

Slice 1 drives this module with hand-written Cypher (no LLM anywhere);
Stage 1 generation (slice 2) feeds the same gate.
"""
from __future__ import annotations

import json
import logging
import re

from apps.graph_api.services.graph_service import (
    EDGE_PROPS,
    EDGE_TYPES,
    GRAPH_NODE_LABEL,
    NODE_PROPS,
    NODE_TYPES,
)

from .cypher_parse import CypherInvalid, ParsedQuery, parse, strip_literals  # noqa: F401 (CypherInvalid re-exported for callers)

log = logging.getLogger(__name__)

MAX_LIMIT = 100
QUERY_TIMEOUT_S = 10

# First-pass tripwire on literal/comment-stripped text. Word-boundary regex
# only — the grammar parser below is the real gate; this fails fast with a
# clear reason for obviously hostile input.
_BANNED = re.compile(
    r"\b(CREATE|DELETE|DETACH|SET|MERGE|DROP|CALL|YIELD|REMOVE|FOREACH|LOAD|"
    r"UNION|OPTIONAL|WITH|SKIP|UNWIND|USING|PERIODIC|CONSTRAINT|INDEX|START|"
    r"UNION|SHOW|TERMINATE)\b|;",
    re.IGNORECASE,
)

CANT_EXPRESS = "I can't express that as a graph query yet."


class CypherRejected(Exception):
    """Verifier refusal. `reason` is a short code; str() is user-facing."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{CANT_EXPRESS} {detail}".strip())
        self.reason = reason
        self.detail = detail


GENERATION_TEMPERATURE = 0.0


class GenerationUnavailable(Exception):
    """Stage 1 could not produce a candidate (no key, transport failure)."""


FEW_SHOTS = [
    {
        "question": "Find the person named Rahul Sharma",
        "cypher": "MATCH (p:Case:Person {value: $name}) RETURN p",
        "params": {"name": "Rahul Sharma"},
        "explanation": "Direct entity lookup by display value.",
        "confidence": 0.95,
        "unanswerable": False,
    },
    {
        "question": "Who called 9876543210?",
        "cypher": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:PhoneNumber {value: $phone}) "
                   "RETURN a, r, b ORDER BY r.confidence_score DESC"),
        "params": {"phone": "9876543210"},
        "explanation": "One-hop incoming CALLED traversal to a phone node.",
        "confidence": 0.9,
        "unanswerable": False,
    },
    {
        "question": "Calls between 2026-03-01 and 2026-03-12",
        "cypher": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:Person) "
                   "WHERE r.valid_from >= $from AND r.valid_from <= $to "
                   "RETURN a, r, b"),
        "params": {"from": "2026-03-01", "to": "2026-03-12"},
        "explanation": "Temporal filter on edge validity dates (concrete dates only).",
        "confidence": 0.85,
        "unanswerable": False,
    },
    {
        "question": "Which people called someone who was seen in Mumbai?",
        "cypher": ("MATCH (a:Case:Person)-[r1:CALLED]->(b:Case:Person)"
                   "-[r2:PRESENT_AT]->(l:Case:Location {value: $loc}) "
                   "RETURN a, r1, b, r2, l"),
        "params": {"loc": "Mumbai"},
        "explanation": "Fixed two-hop chain written out explicitly.",
        "confidence": 0.85,
        "unanswerable": False,
    },
    {
        "question": "How many vehicles does each person own?",
        "cypher": ("MATCH (p:Case:Person)-[r:OWNS]->(v:Case:Vehicle) "
                   "RETURN p.value AS person, count(v) AS vehicles "
                   "ORDER BY vehicles DESC"),
        "params": {},
        "explanation": "Aggregation over a typed traversal.",
        "confidence": 0.8,
        "unanswerable": False,
    },
    {
        "question": "Show me everything suspicious",
        "cypher": "",
        "params": {},
        "explanation": ("No concrete entity, relationship, or date to query on — "
                        "guessing would invent scope."),
        "confidence": 0.0,
        "unanswerable": True,
    },
]


WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}

_MONTHS = None  # lazy: calendar.month_name lowercased, index 1..12


def _month_index(name: str) -> int | None:
    global _MONTHS
    if _MONTHS is None:
        import calendar
        _MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
    return _MONTHS.get((name or "").lower())


def resolve_temporal(question: str, today=None) -> dict:
    """Resolve relative date phrases to concrete ranges — server-side.

    Returns {"ranges": [{"from": iso, "to": iso, "phrase": str}],
    "has_relative": bool}. Pure + deterministic (pass `today` in tests;
    defaults to server-local date, Asia/Kolkata per TIME_ZONE — the
    officers' wall clock, documented here not hidden).

    Covered phrases (bounded set; anything else is left for the model,
    which may only use concrete dates or decline):
      today / yesterday / last night(=yesterday) / tomorrow,
      this week (Mon-today) / last week (Mon-Sun) / past N days|weeks|months,
      this month (1st-today) / last month (full) / this year / last year,
      weekday names ("Tuesday" = most recent <= today; "last Tuesday" =
      most recent strictly before today — standard readings, pinned by tests).
    Multiple phrases merge to the overall min..max span (one $date_from /
    $date_to pair keeps the contract — and the verifier — simple).
    """
    import datetime as _dt
    import re

    if today is None:
        try:
            from django.utils import timezone
            today = timezone.localdate()
        except Exception:
            today = _dt.date.today()
    text = (question or "").lower()
    spans: list[tuple] = []

    def add(day_from, day_to, phrase):
        if day_from and day_to and day_from <= day_to:
            spans.append((day_from.isoformat(), day_to.isoformat(), phrase))

    if re.search(r"\btoday\b", text):
        add(today, today, "today")
    if re.search(r"\byesterday\b|\blast night\b", text):
        add(today - _dt.timedelta(days=1), today - _dt.timedelta(days=1), "yesterday")
    if re.search(r"\btomorrow\b", text):
        add(today + _dt.timedelta(days=1), today + _dt.timedelta(days=1), "tomorrow")
    if re.search(r"\bthis week\b", text):
        add(today - _dt.timedelta(days=today.weekday()), today, "this week")
    if re.search(r"\blast week\b", text):
        end = today - _dt.timedelta(days=today.weekday() + 1)
        add(end - _dt.timedelta(days=6), end, "last week")
    m = re.search(r"\bpast (\d+) (day|days|week|weeks|month|months)\b", text)
    if m:
        n = int(m.group(1))
        days = n * (1 if "day" in m.group(2) else 7 if "week" in m.group(2) else 30)
        add(today - _dt.timedelta(days=days), today, m.group(0))
    if re.search(r"\bthis month\b", text):
        add(today.replace(day=1), today, "this month")
    if re.search(r"\blast month\b", text):
        first = today.replace(day=1)
        end = first - _dt.timedelta(days=1)
        add(end.replace(day=1), end, "last month")
    if re.search(r"\bthis year\b", text):
        add(today.replace(month=1, day=1), today, "this year")
    if re.search(r"\blast year\b", text):
        add(_dt.date(today.year - 1, 1, 1), _dt.date(today.year - 1, 12, 31), "last year")
    for name, weekday in WEEKDAYS.items():
        if re.search(r"\blast " + name + r"\b", text):
            delta = (today.weekday() - weekday) % 7 or 7
            day = today - _dt.timedelta(days=delta)
            add(day, day, "last " + name)
        elif re.search(r"(?<![a-z])" + name + r"\b", text):
            delta = (today.weekday() - weekday) % 7
            day = today - _dt.timedelta(days=delta)
            add(day, day, name)
    # "March 2026" style month-year pins (concrete, no relativity).
    for m in re.finditer(
            r"\b(january|february|march|april|may|june|july|august|"
            r"september|october|november|december)\s+(\d{4})\b", text):
        mi = _month_index(m.group(1))
        year = int(m.group(2))
        if mi:
            start = _dt.date(year, mi, 1)
            end = (_dt.date(year + 1, 1, 1) if mi == 12 else _dt.date(year, mi + 1, 1)) \
                - _dt.timedelta(days=1)
            add(start, end, m.group(0))
    if not spans:
        return {"ranges": [], "has_relative": False}
    frm = min(s[0] for s in spans)
    to = max(s[1] for s in spans)
    return {"ranges": [{"from": frm, "to": to,
                        "phrase": "; ".join(sorted({s[2] for s in spans}))}],
            "has_relative": True}


def find_mentions(question: str, case_ids: list[int] | None) -> list[dict]:
    """Map question text to CONFIRMED registry entities (never pending).

    Strategy: quoted spans first (explicit mentions), else substring scan of
    multi-token confirmed values (script-agnostic — works for Devanagari as
    well as Latin). Single-token values are skipped in the scan (too noisy:
    "Amit" alone must not claim every Amit). Returns per-mention candidate
    lists: [{"mention": str, "candidates": [{id, value, node_type,
    confidence, case_id, case_fir, graph_key}]}]. DB hit, capped.
    """
    import re

    from django.db.models import Q

    from apps.graph_api.models import ExtractedEntity

    text = question or ""
    if not text.strip():
        return []
    quoted = [m.group(1).strip() for m in
              re.finditer(r'[""\u201c\u201d](.+?)[""\u201c\u201d]', text)]
    quoted += [m.group(1).strip() for m in re.finditer(r"'([^']{2,})'", text)]
    quoted = [q for q in quoted if q]
    base = (ExtractedEntity.objects.exclude(status="rejected")
            .exclude(status="pending")
            .select_related("case").order_by("-confidence"))
    if case_ids is not None:
        base = base.filter(case_id__in=case_ids)
    out = []
    if quoted:
        for q in quoted[:10]:
            hits = list(base.filter(Q(value__icontains=q) | Q(normalized__icontains=q.lower()))[:10])
            out.append({"mention": q, "candidates": [_cand(h) for h in hits]})
        return out
    lowered = text.lower()
    seen: set[int] = set()
    mentions: dict[str, list] = {}
    for ent in base.filter()[:500]:
        if " " not in (ent.value or "").strip():
            continue  # multi-token values only in the unquoted scan
        if ent.id in seen:
            continue
        if ent.value.lower() in lowered or ent.normalized in lowered:
            seen.add(ent.id)
            mentions.setdefault(ent.value, []).append(ent)
    for value, ents in list(mentions.items())[:10]:
        out.append({"mention": value, "candidates": [_cand(e) for e in ents[:10]]})
    return out


def _cand(ent) -> dict:
    return {"id": ent.id, "value": ent.value, "node_type": ent.node_type,
            "confidence": ent.confidence, "case_id": ent.case_id,
            "case_fir": ent.case.fir_no if ent.case_id else "",
            "graph_key": ent.graph_key}


def build_prompt(question: str, context: str = "") -> str:
    """Stage 1 prompt: live schema + few-shots + strict contract.

    The schema block is generated from code constants (never a static
    string), so schema changes flow into the prompt automatically.
    `context` carries server-resolved dates + entity hints (slice 3).
    """
    shots = []
    for s in FEW_SHOTS:
        shots.append(
            "Q: {q}\n{js}".format(
                q=s["question"],
                js=json.dumps(
                    {k: s[k] for k in ("cypher", "params", "explanation",
                                       "confidence", "unanswerable")},
                    ensure_ascii=False)))
    parts = [
        ("You translate an investigator's question into a read-only Neo4j "
         "Cypher query. Output STRICT JSON only, exactly these keys: "
         '{"cypher": str, "params": object, "explanation": str, '
         '"confidence": number 0-1, "unanswerable": bool}. '
         "No markdown fences, no commentary."),
        graph_schema_text(),
        ("Hard rules — violate any of them and the query is discarded, so "
         "follow them exactly:\n"
         "1. READ-ONLY: one MATCH clause, then optional WHERE, then RETURN, "
         "then optional ORDER BY / LIMIT. Nothing else exists: no WITH, "
         "SKIP, OPTIONAL, UNION, variable-length [*..] paths, procedures, "
         "or second statements.\n"
         "2. Every node pattern needs a variable AND the :Case label, e.g. "
         "(p:Case:Person). Write multi-hop paths as explicit fixed chains.\n"
         "3. Use ONLY the labels, relationship types, and properties listed "
         "above. Anything else -> unanswerable:true, never an invented name.\n"
         "4. NEVER filter on case_id — scoping is injected server-side and "
         "your case_id predicates are ignored.\n"
         "5. Dates: use ONLY concrete ISO dates from the question, or the "
         "resolved $date_from / $date_to values below when a Resolved-dates "
         "block is present (copy them exactly, never invent others). With "
         "no dates anywhere, write no date predicate.\n"
         "6. Vague questions with no entity, relationship, or date to anchor "
         "on -> unanswerable:true with the reason in explanation.\n"
         "7. confidence is YOUR honest uncertainty about this translation "
         "(not data quality); low confidence never blocks execution — a "
         "separate verifier decides that."),
        "Examples:\n" + "\n\n".join(shots),
    ]
    if context and context.strip():
        parts.append(context.strip())
    parts.append(f"Q: {question.strip()[:1000]}")
    return "\n\n".join(parts)


def _parse_model_json(text: str) -> dict:
    """Strict parse of the model's JSON; raises GenerationUnavailable."""
    body = (text or "").strip()
    if body.startswith("```"):
        lines = body.splitlines()
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        body = "\n".join(lines).strip()
    try:
        data = json.loads(body)
    except Exception as exc:
        raise GenerationUnavailable(f"model returned non-JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise GenerationUnavailable("model returned a JSON non-object")
    if "unanswerable" not in data:
        raise GenerationUnavailable("model JSON misses required key 'unanswerable'")
    try:
        unanswerable = bool(data["unanswerable"])
        explanation = str(data.get("explanation", ""))
        confidence = float(data.get("confidence", 0.0))
        cypher = str(data.get("cypher", ""))
        params = data.get("params", {})
    except (ValueError, TypeError) as exc:
        raise GenerationUnavailable(f"model JSON has bad types: {exc}") from exc
    if not isinstance(params, dict):
        raise GenerationUnavailable("model params must be an object")
    confidence = max(0.0, min(1.0, confidence))
    if not unanswerable and not cypher.strip():
        raise GenerationUnavailable("model gave no query without unanswerable:true")
    return {"cypher": cypher.strip(), "params": params,
            "explanation": explanation.strip(), "confidence": confidence,
            "unanswerable": unanswerable}


def build_question_context(question: str, case_ids: list[int] | None,
                           today=None) -> tuple[str, dict, list[dict]]:
    """Slice-3 preprocessing -> (prompt_context, forced_params, ambiguities).

    - Temporal phrases resolve to one $date_from/$date_to pair (server wins:
      returned in forced_params for the caller to overwrite model params).
    - Confirmed-registry mentions become "Known entities" hints (exact values
      and keys the model should reuse).
    - Mentions matching >1 confirmed row come back as ambiguities — the
      caller must ask the officer to pick BEFORE spending an LLM call.
    """
    temporal = resolve_temporal(question, today=today)
    forced: dict = {}
    blocks = []
    if temporal["has_relative"]:
        r = temporal["ranges"][0]
        forced = {"date_from": r["from"], "date_to": r["to"]}
        blocks.append(
            "Resolved dates: the question's relative phrase(s) "
            f"({r['phrase']}) mean {r['from']} to {r['to']}. Use params "
            "$date_from and $date_to with EXACTLY these values.")
    mentions = find_mentions(question, case_ids)
    ambiguities = [m for m in mentions if len(m["candidates"]) > 1]
    singles = [m for m in mentions if len(m["candidates"]) == 1]
    if singles:
        lines = ["Known entities mentioned in the question (confirmed rows — "
                 "reuse these exact values/keys):"]
        for m in singles:
            c = m["candidates"][0]
            lines.append(f"- '{m['mention']}' = {c['node_type']} '{c['value']}' "
                         f"(key {c['graph_key'] or 'unbuilt'}, case {c['case_fir'] or c['case_id']})")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks), forced, ambiguities


def generate_cypher(question: str, context: str = "") -> dict:
    """Stage 1: one temperature-0 Gemini call -> candidate dict.

    Returns the parsed contract (keys: cypher/params/explanation/confidence/
    unanswerable). Raises GenerationUnavailable when there is no key or the
    call/parse fails. NEVER executes anything — the caller must feed the
    candidate through verify_and_scope first.
    """
    from .gemini import GeminiUnavailable, generate, is_configured

    if not question or not question.strip():
        raise GenerationUnavailable("empty question")
    if not is_configured():
        raise GenerationUnavailable("GEMINI_API_KEY is not configured")
    try:
        text = generate(build_prompt(question, context), temperature=GENERATION_TEMPERATURE)
    except GeminiUnavailable as exc:
        raise GenerationUnavailable(str(exc)) from exc
    return _parse_model_json(text)


def graph_schema_text() -> str:
    """Schema block for prompts, built from code constants (never static).

    If NODE_TYPES/EDGE_TYPES/props change, this output changes with them.
    """
    lines = [
        "Graph schema (Neo4j). Every node carries the :Case label and a "
        "numeric case_id property; case scoping is applied server-side, "
        "so never filter on case_id yourself.",
        "Node labels: " + ", ".join(sorted(NODE_TYPES)),
        "Node properties: " + ", ".join(NODE_PROPS),
        "Relationship types: " + ", ".join(sorted(EDGE_TYPES)),
        "Relationship properties: " + ", ".join(EDGE_PROPS),
        "Node identity: key = '<case_id>:<node_type>:<normalized>' "
        "(e.g. '12:Person:rahul sharma').",
    ]
    return "\n".join(lines)


def _check_banned(cypher: str) -> None:
    m = _BANNED.search(strip_literals(cypher))
    if m:
        raise CypherRejected("banned-clause", f"Found disallowed clause {m.group(0)!r}.")


def _check_ast(parsed: ParsedQuery) -> None:
    # Every MATCH endpoint must be aliased + :Case-labeled (scope injection
    # needs an alias; the label pins reads to case-scoped nodes). A bare
    # re-mention `(a)` of an alias bound WITH :Case earlier in the same MATCH
    # is allowed — it reuses the scoped variable (models write this
    # constantly); truly anonymous `()` never is.
    bound: set[str] = set()
    for alias in parsed.node_aliases:
        labels = parsed.node_labels.get(alias, [])
        if not alias:
            raise CypherRejected("anonymous-node",
                                 "Every node needs a variable, e.g. (p:Case:Person).")
        if not labels:
            if alias not in bound:
                raise CypherRejected(
                    "missing-case-label",
                    f"Node ({alias}) must include the :{GRAPH_NODE_LABEL} label.")
            continue
        if GRAPH_NODE_LABEL not in labels:
            raise CypherRejected(
                "missing-case-label",
                f"Node ({alias}) must include the :{GRAPH_NODE_LABEL} label.")
        for lab in labels:
            if lab != GRAPH_NODE_LABEL and lab not in NODE_TYPES:
                raise CypherRejected("unknown-label", f"Unknown node label :{lab}.")
        bound.add(alias)
    for alias, types in parsed.rel_types.items():
        for t in types:
            if t not in EDGE_TYPES:
                raise CypherRejected("unknown-relationship", f"Unknown relationship :{t}.")
    _check_refs(parsed)


def _check_refs(parsed: ParsedQuery) -> None:
    """Walk WHERE/RETURN/ORDER tokens: aliases resolve, props/functions known."""
    from .cypher_parse import ALLOWED_FUNCTIONS

    toks = parsed.tokens
    node_alias = set(parsed.node_aliases)
    rel_alias = set(parsed.rel_aliases)
    i = parsed.where_at if parsed.where_at is not None else parsed.return_at
    # Scan WHERE (if any) through end-of-query: RETURN/ORDER BY included.
    n = len(toks)
    while i < n:
        tok = toks[i]
        if tok.kind == "IDENT":
            nxt = toks[i + 1] if i + 1 < n else None
            if nxt is not None and nxt.kind == "PUNCT" and nxt.text == "(":
                if tok.text.lower() not in ALLOWED_FUNCTIONS:
                    raise CypherRejected("banned-function",
                                         f"Function {tok.text}() is not allowlisted.")
                i += 1
                continue
            if nxt is not None and nxt.kind == "PUNCT" and nxt.text == ".":
                prop = toks[i + 2] if i + 2 < n else None
                if prop is None or prop.kind not in ("IDENT", "KEYWORD"):
                    raise CypherRejected("bad-property", "Malformed property reference.")
                if tok.text not in node_alias and tok.text not in rel_alias:
                    raise CypherRejected("unknown-alias",
                                         f"Unknown variable {tok.text!r}.")
                allowed = NODE_PROPS if tok.text in node_alias else EDGE_PROPS
                if prop.text not in allowed:
                    raise CypherRejected("unknown-property",
                                         f"Unknown property {tok.text}.{prop.text}.")
                i += 3
                continue
        i += 1
    # Every `:Label` in MATCH patterns (outside `{...}` maps, whose colons
    # separate keys from values) must be known. Labels only appear in MATCH
    # (the grammar rejects them elsewhere), so scan MATCH tokens at brace
    # depth 0.
    depth = 0
    for j in range(parsed.match_end):
        tok = toks[j]
        if tok.kind == "PUNCT" and tok.text == "{":
            depth += 1
            continue
        if tok.kind == "PUNCT" and tok.text == "}":
            depth -= 1
            continue
        if depth == 0 and tok.kind == "PUNCT" and tok.text == ":":
            lab = toks[j + 1] if j + 1 < len(toks) else None
            if lab is None or lab.kind not in ("IDENT", "KEYWORD"):
                raise CypherRejected("bad-label", "Malformed :Label.")
            if lab.text != GRAPH_NODE_LABEL and lab.text not in NODE_TYPES \
                    and lab.text not in EDGE_TYPES:
                raise CypherRejected("unknown-label", f"Unknown :{lab.text}.")
    # Map-literal keys in MATCH patterns must be real properties.
    _check_match_maps(parsed)


def _check_match_maps(parsed: ParsedQuery) -> None:
    toks = parsed.tokens
    depth = 0
    i = 0
    in_match = True
    while i < parsed.match_end:
        tok = toks[i]
        if tok.kind == "PUNCT" and tok.text == "{":
            depth += 1
            i += 1
            # key context: node map (inside parens) vs rel map (inside brackets)
            is_rel = any(t.kind == "PUNCT" and t.text == "[" for t in toks[max(0, i - 12):i])
            allowed = EDGE_PROPS if is_rel else NODE_PROPS
            while depth > 0 and i < parsed.match_end:
                t2 = toks[i]
                if t2.kind == "PUNCT" and t2.text == "{":
                    depth += 1
                elif t2.kind == "PUNCT" and t2.text == "}":
                    depth -= 1
                elif depth == 1 and t2.kind in ("IDENT", "KEYWORD"):
                    nxt = toks[i + 1] if i + 1 < parsed.match_end else None
                    if nxt is not None and nxt.kind == "PUNCT" and nxt.text == ":":
                        if t2.text not in allowed:
                            raise CypherRejected("unknown-property",
                                                 f"Unknown property {t2.text} in pattern.")
                i += 1
            continue
        i += 1


def _clause_text(cypher: str, parsed: ParsedQuery) -> tuple[str, str | None, str]:
    """Split original text into (match_span, where_span|None, rest_span)."""
    toks = parsed.tokens
    match_end_off = toks[parsed.match_end].pos
    if parsed.where_at is None:
        return cypher[:match_end_off], None, cypher[match_end_off:]
    where_off = toks[parsed.where_at].pos
    rest_off = toks[parsed.where_end].pos
    return cypher[:match_end_off], cypher[where_off:rest_off], cypher[rest_off:]


def inject_scope(cypher: str, parsed: ParsedQuery, case_ids: list[int]) -> str:
    """AND `alias.case_id IN $case_ids` for every MATCH node alias.

    Existing WHERE bodies are parenthesized so OR semantics survive.
    Any model-written LIMIT is dropped and replaced by the clamp.
    """
    if not case_ids:
        raise CypherRejected("no-visible-cases", "No visible cases in scope.")
    seen: set[str] = set()
    unique_aliases = [a for a in parsed.node_aliases if not (a in seen or seen.add(a))]
    preds = " AND ".join(f"{a}.case_id IN $case_ids" for a in unique_aliases)
    match_span, where_span, rest_span = _clause_text(cypher, parsed)
    if where_span is None:
        scoped = f"{match_span.rstrip()} WHERE {preds} {rest_span.lstrip()}"
    else:
        scoped = (f"{match_span.rstrip()} WHERE ({where_span[len('WHERE'):].strip()}) "
                  f"AND {preds} {rest_span.lstrip()}")
    # Force the LIMIT clamp by token position (never regex on text, so a
    # string like 'LIMIT 5' inside literals is untouchable). The parser
    # guarantees a LIMIT clause, if present, is the final clause.
    scoped = _strip_trailing_limit(scoped, parsed, cypher)
    return f"{scoped} LIMIT {MAX_LIMIT}"


def _strip_trailing_limit(scoped: str, parsed: ParsedQuery, cypher: str) -> str:
    """Remove a model-written trailing LIMIT using parser token offsets."""
    for tok in parsed.tokens[parsed.return_at:]:
        if tok.kind == "KEYWORD" and tok.text.upper() == "LIMIT":
            # Token offsets index the ORIGINAL text; the scoped text shares
            # every prefix up to the RETURN clause, and LIMIT (if present)
            # is the final clause — so its tail length transfers exactly.
            tail_len = len(cypher) - tok.pos
            return scoped[: len(scoped) - tail_len].rstrip()
    return scoped.rstrip()


def verify_and_scope(cypher: str, case_ids: list[int] | None) -> tuple[str, dict]:
    """Full gate: tripwire -> parse -> AST checks -> scope injection.

    Returns (scoped_cypher, params). Raises CypherRejected on any failure.
    `case_ids=None` (SHO, sees all) still injects the predicate — with the
    caller's full id list resolved upstream, never "no filter". Callers must
    resolve None to explicit ids before calling (see views).
    """
    if not (cypher or "").strip():
        raise CypherRejected("empty-query", "Empty query.")
    if case_ids is None:
        raise CypherRejected("unscoped", "Case scope is required.")
    _check_banned(cypher)
    try:
        parsed = parse(cypher)
    except CypherInvalid as exc:
        raise CypherRejected("syntax", str(exc)[:160])
    _check_ast(parsed)
    scoped = inject_scope(cypher, parsed, list(case_ids))
    return scoped, {"case_ids": list(case_ids)}


def shape_records(rows: list) -> tuple[list[str], list[str], list[dict]]:
    """Map raw driver records -> (node_ids, edge_ids, json-safe rows).

    node_ids are graph `key` props (what the canvas isolate() takes);
    edge_ids use the frontend's `src->type->dst` composite format.
    Unknown shapes pass through rows but never invent ids.
    """
    node_ids: list[str] = []
    edge_ids: list[str] = []
    out_rows: list[dict] = []
    for rec in rows:
        if not isinstance(rec, dict):
            out_rows.append({"value": _json_safe(rec)})
            continue
        out_row = {}
        for k, v in rec.items():
            kind, payload = _shape_value(v)
            out_row[k] = payload
            # collect(...) lists nest nodes/edges — recurse so aggregations
            # still yield isolate-ready ids.
            for sub_kind, sub in _walk_nested(payload):
                if sub_kind == "node" and sub.get("key") and sub["key"] not in node_ids:
                    node_ids.append(sub["key"])
                if sub_kind == "edge" and sub.get("id") and sub["id"] not in edge_ids:
                    edge_ids.append(sub["id"])
            if kind == "node" and payload.get("key") and payload["key"] not in node_ids:
                node_ids.append(payload["key"])
            if kind == "edge" and payload.get("id") and payload["id"] not in edge_ids:
                edge_ids.append(payload["id"])
        out_rows.append(out_row)
    return node_ids, edge_ids, out_rows


def _walk_nested(payload):
    """Yield (kind, mapping) for nodes/edges nested in lists/dicts.

    Routes every item through _shape_value, so driver Node/Relationship
    objects inside collect(...) lists yield isolate-ready ids instead of
    degrading to str(). Top-level duplicates are filtered by the caller.
    """
    if isinstance(payload, list):
        for item in payload:
            kind, sub = _shape_value(item)
            if kind in ("node", "edge"):
                yield kind, sub
            for sub_kind, sub_sub in _walk_nested(sub):
                yield sub_kind, sub_sub
    elif isinstance(payload, dict):
        for v in payload.values():
            for sub_kind, sub in _walk_nested(v):
                yield sub_kind, sub


def _shape_value(v):
    """Classify one driver value -> (kind, json-safe payload)."""
    if isinstance(v, dict):
        # Already-mapped node/edge dicts (tests, future readers).
        if "key" in v and ("node_type" in v or "value" in v):
            return "node", {kk: _json_safe(vv) for kk, vv in v.items()}
        if "src" in v and "dst" in v and "type" in v:
            vv = dict(v)
            vv["id"] = f"{v['src']}->{v['type']}->{v['dst']}"
            return "edge", {kk: _json_safe(x) for kk, x in vv.items()}
        return "scalar", {kk: _json_safe(vv) for kk, vv in v.items()}
    labels = getattr(v, "labels", None)
    if labels is not None and hasattr(v, "items"):
        props = {kk: _json_safe(vv) for kk, vv in dict(v.items()).items()}
        return "node", props
    if getattr(v, "type", None) is not None and hasattr(v, "start_node"):
        try:
            s = dict(v.start_node.items())
            e = dict(v.end_node.items())
            payload = {
                "id": f"{s.get('key')}->{v.type}->{e.get('key')}",
                "src": _json_safe(s.get("key")), "dst": _json_safe(e.get("key")),
                "type": v.type,
                "props": {kk: _json_safe(vv) for kk, vv in dict(v.items()).items()},
            }
            return "edge", payload
        except Exception:
            return "scalar", {"type": str(getattr(v, "type", "?"))}
    if isinstance(v, (list, tuple)):
        # Structured per item (collect(node) stays inspectable, not str()).
        return "scalar", [_shape_value(x)[1] for x in v]
    return "scalar", _json_safe(v)


def _json_safe(v):
    import datetime as _dt

    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    try:
        import neo4j.time as _nt
        if isinstance(v, (_nt.DateTime, _nt.Date, _nt.Time, _nt.Duration)):
            return str(v)
    except Exception:
        pass
    return str(v)


def run_graph_query(cypher: str, case_ids: list[int] | None,
                    limit: int = MAX_LIMIT,
                    timeout_s: int = QUERY_TIMEOUT_S,
                    extra_params: dict | None = None) -> dict:
    """Verify, scope, execute, shape. Raises CypherRejected / GraphUnavailable.

    `limit` is accepted for future use but the clamp always wins today
    (documented: expected sets are FULL sets up to MAX_LIMIT; fixtures stay
    small so truncation never bites — the harness asserts counts < limit).
    `extra_params` (hand-written path) merge under the server-set case_ids —
    a colliding "case_ids" key is overwritten, never widened.
    """
    from apps.graph_api.services.graph_service import GraphService

    _ = limit  # clamp wins; see docstring.
    scoped, params = verify_and_scope(cypher, case_ids)
    if extra_params:
        if not isinstance(extra_params, dict):
            raise CypherRejected("bad-params", "params must be a JSON object.")
        for k, v in extra_params.items():
            if not isinstance(v, (str, int, float, bool, list)) and v is not None:
                raise CypherRejected("bad-params", f"Param ${k} must be a scalar or list.")
        params = {**extra_params, **params}
    rows = GraphService().run_readonly(scoped, params, timeout_s=timeout_s)
    node_ids, edge_ids, out_rows = shape_records(rows)
    return {"cypher": scoped, "node_ids": node_ids, "edge_ids": edge_ids,
            "rows": out_rows, "counts": {"nodes": len(node_ids), "edges": len(edge_ids),
                                         "rows": len(out_rows)}}
