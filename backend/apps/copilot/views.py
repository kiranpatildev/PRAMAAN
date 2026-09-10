"""Investigation copilot (Phase 6): intent-routed answers over graph + retrieval.

  path .... "how is X connected to Y" -> Neo4j shortestPath, verbalized
            hop-by-hop with per-hop evidence. No LLM needed.
  summary . case rollup from GDS overview + risk (templated, cited).
  generic . hybrid retrieval (vector + keyword) -> Gemini-grounded answer
            when configured, else an honestly-labeled extractive answer.

Every answer carries citations; nothing is ever asserted without evidence.
Case scoping is enforced before any lookup.
"""
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_view_case, visible_case_ids
from apps.evidence.models import Evidence
from apps.graph_api.models import ExtractedEntity
from apps.graph_api.services.graph_service import GraphService, GraphUnavailable, node_key

from .services import intents
from .services import retrieval as R
from .services.gemini import GeminiUnavailable, generate, is_configured


def _scope(request, case_id):
    """Return (case_ids or None, error). None = all cases (SHO, no filter)."""
    if case_id is not None:
        try:
            case = Case.objects.get(pk=case_id)
        except Case.DoesNotExist:
            return None, Response({"detail": "Case not found."}, status=404)
        if not user_can_view_case(request.user, case):
            return None, Response({"detail": "Forbidden."}, status=403)
        return [case.id], None
    return visible_case_ids(request.user), None


def _file_names(ev_ids):
    rows = Evidence.objects.filter(pk__in=set(ev_ids)).select_related("case")
    return {e.id: {"file_name": e.file_name, "fir": e.case.fir_no if e.case_id else "",
                   "classification": e.classification} for e in rows}


def _find_entity(name, case_ids):
    qs = (ExtractedEntity.objects.exclude(status="rejected")
          .select_related("case", "evidence")
          .order_by("-confidence"))
    if case_ids is not None:
        qs = qs.filter(case_id__in=case_ids)
    hit = qs.filter(Q(value__icontains=name) | Q(normalized__icontains=name.lower())).first()
    return hit


def _cite_entity(ent, files, score=1.0, method="registry"):
    f = files.get(ent.evidence_id, {}) if ent.evidence_id else {}
    return {"evidence_id": ent.evidence_id, "file_name": f.get("file_name", ""),
            "case_fir": f.get("fir", ""), "snippet": f"{ent.node_type} '{ent.value}' "
            f"(confidence {ent.confidence:.0%}, {ent.status})",
            "score": score, "method": method}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def query(request):
    question = str(request.data.get("question", "")).strip()[:1000]
    if not question:
        return Response({"detail": "question is required."}, status=400)
    case_ids, err = _scope(request, request.data.get("case_id"))
    if err:
        return err
    intent, slots = intents.classify(question)
    if intent == "path":
        return Response(_answer_path(request, case_ids, question, slots))
    if intent == "summary":
        return Response(_answer_summary(request, case_ids, question))
    return Response(_answer_generic(request, case_ids, question))


def _answer_path(request, case_ids, question, slots):
    a = _find_entity(slots["a"], case_ids)
    b = _find_entity(slots["b"], case_ids)
    files = _file_names([e.evidence_id for e in (a, b) if e and e.evidence_id])
    citations = [_cite_entity(e, files) for e in (a, b) if e]
    if a is None or b is None:
        missing = [n for n, e in ((slots["a"], a), (slots["b"], b)) if e is None]
        return {"question": question, "intent": "path", "generated": False,
                "answer": (f"I could not find {', '.join(repr(m) for m in missing)} in the "
                           f"extracted entities — check spelling or confirm pending extractions first."),
                "citations": citations}
    if a.id == b.id:
        return {"question": question, "intent": "path", "generated": False,
                "answer": f"Both names resolve to the same entity: {a.node_type} '{a.value}'.",
                "citations": citations}
    for ent in (a, b):
        if not ent.graph_key:
            return {"question": question, "intent": "path", "generated": False,
                    "answer": (f"'{ent.value}' is extracted but not yet confirmed into the graph. "
                               f"Confirm it in the review queue, rebuild, and ask again."),
                    "citations": citations}
    if a.case_id != b.case_id:
        return {"question": question, "intent": "path", "generated": False,
                "answer": (f"'{a.value}' ({a.case.fir_no}) and '{b.value}' ({b.case.fir_no}) live in "
                           f"different cases — confirmed paths are case-scoped. The shared-entity "
                           f"flag below is the cross-case link to investigate."),
                "citations": citations}
    try:
        path = GraphService().path_between(a.case_id, a.graph_key, b.graph_key)
    except GraphUnavailable as exc:
        return {"question": question, "intent": "path", "generated": False,
                "answer": f"Graph database unavailable: {exc}", "citations": citations}
    if path is None:
        return {"question": question, "intent": "path", "generated": False,
                "answer": (f"No confirmed path (≤4 hops) between '{a.value}' and '{b.value}'. "
                           f"Confirm more relations in the review queue, or the link is genuinely absent."),
                "citations": citations}
    steps = []
    hop_files = _file_names([r.get("ev") for r in path["rels"] if r.get("ev")])
    for i, hop in enumerate(path["rels"]):
        u, v = path["nodes"][i], path["nodes"][i + 1]
        f = hop_files.get(hop.get("ev"), {})
        steps.append(
            f"{i + 1}. {u['value']} —[{hop['type']} {(hop.get('conf') or 0):.0%}]→ {v['value']}"
            + (f" ({hop['snippet'][:120]}…)" if hop.get("snippet") else "")
            + (f" [source: {f.get('file_name', 'unknown')}]" if hop.get("ev") else ""))
        citations.append({"evidence_id": hop.get("ev"),
                          "file_name": f.get("file_name", ""),
                          "snippet": (hop.get("snippet") or "")[:300],
                          "score": hop.get("conf") or 0, "method": "graph-path"})
    names = " → ".join(n["value"] for n in path["nodes"])
    return {"question": question, "intent": "path", "generated": False,
            "answer": f"Confirmed connection ({len(path['rels'])} hop(s)): {names}\n" + "\n".join(steps),
            "citations": citations}


def _answer_summary(request, case_ids, question):
    from apps.analytics.services import gds as gds_svc
    from apps.analytics.services import risk as risk_svc

    citations: list[dict] = []
    if case_ids is not None and len(case_ids) == 1:
        case = Case.objects.get(pk=case_ids[0])
        try:
            m = gds_svc.case_metrics(case.id)
        except GraphUnavailable as exc:
            return {"question": question, "intent": "summary", "generated": False,
                    "answer": f"Graph database unavailable: {exc}", "citations": []}
        scores = risk_svc.score_nodes(m["nodes"], {})
        top = scores[:3]
        lines = [f"Case {case.fir_no} — {case.title}: {m['counts']['nodes']} entities, "
                 f"{m['counts']['edges']} confirmed links, {m['counts']['communities']} communities."]
        for t in top:
            lines.append(f"- {t['label']} ({t['type']}): risk {t['level']} ({t['score']:.0%}) — "
                         + ", ".join(f"{f['name']} {f['contribution']:.2f}" for f in t["factors"][:2]))
            citations.append({"evidence_id": None, "file_name": "", "snippet":
                              f"Top entity {t['label']}", "score": t["score"], "method": "risk"})
        if m["bridges"]:
            lines.append("Bridges: " + "; ".join(
                f"{b['label']} ({', '.join(b['kinds'])})" for b in m["bridges"][:3]))
        return {"question": question, "intent": "summary", "generated": False,
                "answer": "\n".join(lines), "citations": citations}
    # Multi-case rollup over visible cases.
    qs = Case.objects.all()
    if case_ids is not None:
        qs = qs.filter(id__in=case_ids)
    cases = list(qs.order_by("fir_no")[:50])
    pending = ExtractedEntity.objects.filter(status="pending")
    if case_ids is not None:
        pending = pending.filter(case_id__in=case_ids)
    lines = [f"{len(cases)} visible case(s), {pending.count()} entities awaiting review."]
    lines += [f"- {c.fir_no}: {c.title} [{c.status}, {c.risk_level} risk]" for c in cases[:10]]
    return {"question": question, "intent": "summary", "generated": False,
            "answer": "\n".join(lines), "citations": citations}


def _answer_generic(request, case_ids, question):
    from django.conf import settings
    top_k = int(getattr(settings, "RAG_TOP_K", 6))
    found = R.retrieve(question, case_ids, limit=top_k)
    citations = [{
        "evidence_id": h["evidence_id"], "file_name": h["file_name"], "case_fir": h["case_fir"],
        "snippet": h["text"][:300], "score": h["score"], "method": h["method"],
    } for h in found["hits"]]
    if not citations:
        return {"question": question, "intent": "generic", "generated": False,
                "answer": ("No evidence matches that question in the accessible cases. "
                           "Upload relevant documents or widen the case scope."),
                "citations": []}
    if is_configured():
        numbered = "\n\n".join(
            f"[{i + 1}] ({c['file_name']}) {c['snippet']}" for i, c in enumerate(citations))
        prompt = (
            "You are an investigation assistant. Answer ONLY from the evidence excerpts below; "
            "cite sources as [n]. If the excerpts do not support an answer, say so explicitly.\n\n"
            f"Question: {question}\n\nEvidence:\n{numbered}\n\nAnswer:")
        try:
            answer = generate(prompt)
            return {"question": question, "intent": "generic", "generated": True,
                    "model": getattr(settings, "GEMINI_MODEL", "gemini-2.0-flash"),
                    "vector_used": found["vector_used"], "answer": answer, "citations": citations}
        except GeminiUnavailable:
            pass  # fall through to the extractive answer below
    joined = "\n".join(
        f"[{i + 1}] {c['file_name']}: {c['snippet'][:220]}…" for i, c in enumerate(citations))
    return {"question": question, "intent": "generic", "generated": False,
            "vector_used": found["vector_used"],
            "answer": ("Top matching evidence (keyword retrieval — set GEMINI_API_KEY for "
                       f"generated answers):\n{joined}"),
            "citations": citations}
