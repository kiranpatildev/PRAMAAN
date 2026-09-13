"""Phase 3 extraction stages — separate Celery tasks w/ clear contracts (§10.3).

  extract_entities(evidence_id) -> {"entities": n, "label_counts": {...}}
  extract_relations(evidence_id) -> {"relations": n}
  resolve_entities(case_id)       -> {"merge_suggestions": n}
  build_temporal_graph(case_id)   -> {"nodes_written": n, "edges_written": m}

Human-in-the-loop: extraction writes PENDING rows to the Postgres review
queue; only CONFIRMED rows are built into Neo4j (via GraphService).
"""
from __future__ import annotations

import logging

from celery import shared_task

log = logging.getLogger(__name__)


def _parse_iso_date(value):
    if not value:
        return None
    try:
        from datetime import date
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _emit_cross_case(case, found: list[dict]) -> None:
    """Flag entities shared with other cases (strict per-user delivery at emit)."""
    from django.db.models import Q
    from apps.alerts.services import emit_event
    from .models import ExtractedEntity

    pairs = {(e["node_type"], e["normalized"]) for e in found}
    if not pairs:
        return
    q = Q()
    for t, n in list(pairs)[:50]:
        q |= Q(node_type=t, normalized=n)
    others = (ExtractedEntity.objects.exclude(case=case).exclude(status="rejected")
              .filter(q).select_related("case")[:200])
    by_pair: dict[tuple, list] = {}
    for o in others:
        by_pair.setdefault((o.node_type, o.normalized), []).append(o)
    for (t, n), hits in by_pair.items():
        cases = sorted({h.case for h in hits}, key=lambda c: c.id)
        emit_event(
            "cross_case", case,
            f"'{hits[0].value}' also appears in {len(cases)} other case(s): "
            + ", ".join(c.fir_no for c in cases[:3]),
            severity="medium",
            refs={"entity": f"{t}:{n}",
                  "other_cases": [{"id": c.id, "fir_no": c.fir_no} for c in cases[:5]]},
            confidence=hits[0].confidence,
            dedupe_key=f"xcase-{t}-{n}-{case.id}")


def _post_build_alerts(case) -> None:
    """Anomaly + risk fan-out after a successful graph build (best-effort)."""
    from django.utils import timezone
    from apps.alerts.services import emit_event
    from apps.analytics.services import anomalies as anom_svc
    from apps.analytics.services import gds as gds_svc
    from apps.analytics.services import risk as risk_svc
    from apps.analytics.services.crosscase import cross_case_counts
    from apps.graph_api.services.graph_service import GraphService

    metrics = gds_svc.case_metrics(case.id)
    graph = GraphService().get_case_graph(case.id, limit=5000)
    for a in anom_svc.detect(metrics["nodes"], graph["edges"], metrics["communities"]):
        if a["severity"] not in ("high", "medium"):
            continue
        node_keys = [n.get("key", "") for n in a.get("nodes", [])]
        emit_event("anomaly", case, f"Anomaly [{a['severity']}]: {a['explanation']}"[:500],
                   severity=a["severity"],
                   refs={"kind": a["kind"], "nodes": node_keys},
                   confidence=0.7,
                   dedupe_key=f"anom-{case.id}-{a['kind']}-{node_keys[0] if node_keys else 'case'}")
    counts = cross_case_counts(None)  # system context; delivery still per-user scoped
    by_norm = {(t, nrm): c for (t, nrm), c in counts.items()}
    per_key = {}
    for key, n in metrics["nodes"].items():
        norm = key.split(":", 2)[-1] if key.count(":") >= 2 else ""
        per_key[key] = by_norm.get((n.get("type", ""), norm), 1)
    scores = risk_svc.score_nodes(metrics["nodes"], per_key)
    if scores and scores[0]["score"] >= 0.6:
        top = scores[0]
        day = timezone.now().date().isoformat()
        emit_event("risk", case,
                   f"Risk threshold crossed: '{top['label']}' at {top['score']:.0%} ({top['level']})",
                   severity="high" if top["level"] == "high" else "medium",
                   refs={"top": [{**s, "factors": s["factors"][:2]} for s in scores[:3]]},
                   confidence=top["score"],
                   dedupe_key=f"risk-{case.id}-{top['level']}-{day}")


@shared_task
def extract_entities(evidence_id: int) -> dict:
    from apps.evidence.models import Evidence
    from apps.graph_api.services.extract import extract_entities as run_extract
    from .models import ExtractedEntity

    try:
        ev = Evidence.objects.select_related("case").get(pk=evidence_id)
    except Evidence.DoesNotExist:
        return {"evidence_id": evidence_id, "stage": "ner", "status": "missing"}
    text = (ev.ocr_text or "").strip()
    if not text:
        return {"evidence_id": evidence_id, "stage": "ner", "status": "skipped-empty"}
    try:
        found = run_extract(text, source_evidence_id=ev.id)
        counts: dict[str, int] = {}
        for ent in found:
            obj, created = ExtractedEntity.objects.get_or_create(
                case=ev.case, node_type=ent["node_type"], normalized=ent["normalized"],
                defaults={"evidence": ev, "value": ent["value"],
                          "confidence": ent["confidence"], "engine": ent["engine"]},
            )
            if not created:
                obj.mention_count += 1
                if ent["confidence"] > obj.confidence:
                    obj.confidence = ent["confidence"]
                    obj.engine = ent["engine"]
                obj.save(update_fields=["mention_count", "confidence", "engine", "updated_at"])
            else:
                try:
                    from apps.graph_api.services.geo import attach_gazetteer  # auto-pin known places
                    attach_gazetteer(obj)
                except Exception:
                    pass
            counts[ent["node_type"]] = counts.get(ent["node_type"], 0) + 1
        try:
            _emit_cross_case(ev.case, found)  # Phase 7: shared-entity fan-out
        except Exception:
            log.exception("cross-case check failed for evidence %s", ev.id)
        return {"evidence_id": ev.id, "stage": "ner", "status": "ok",
                "entities": len(found), "label_counts": counts}
    except Exception as exc:
        log.exception("extract_entities failed for %s", evidence_id)
        return {"evidence_id": evidence_id, "stage": "ner", "status": "failed", "error": str(exc)[:300]}


@shared_task
def extract_relations(evidence_id: int) -> dict:
    from apps.evidence.models import Evidence
    from apps.graph_api.services.extract import extract_relations as run_re
    from .models import ExtractedEntity, ExtractedRelation

    try:
        ev = Evidence.objects.select_related("case").get(pk=evidence_id)
    except Evidence.DoesNotExist:
        return {"evidence_id": evidence_id, "stage": "relation_extraction", "status": "missing"}
    text = (ev.ocr_text or "").strip()
    if not text:
        return {"evidence_id": evidence_id, "stage": "relation_extraction", "status": "skipped-empty"}
    try:
        registry = {(e.node_type, e.normalized): e
                    for e in ExtractedEntity.objects.filter(case=ev.case)}
        plain = [{"node_type": e.node_type, "normalized": e.normalized, "value": e.value}
                 for e in registry.values()]
        found = run_re(text, plain, source_evidence_id=ev.id)
        n = 0
        for rel in found:
            src = registry.get((rel["src_type"], rel["src"]))
            dst = registry.get((rel["dst_type"], rel["dst"]))
            if src is None or dst is None or src.id == dst.id:
                continue
            vf = _parse_iso_date(rel.get("valid_from"))
            obj, created = ExtractedRelation.objects.get_or_create(
                case=ev.case, src=src, dst=dst, edge_type=rel["edge_type"],
                defaults={"evidence": ev, "confidence": rel["confidence"],
                          "snippet": rel["snippet"], "engine": rel["engine"],
                          "valid_from": vf},
            )
            if not created and vf and not obj.valid_from:
                obj.valid_from = vf
                obj.save(update_fields=["valid_from"])
            n += int(created)
        return {"evidence_id": ev.id, "stage": "relation_extraction", "status": "ok", "relations": n}
    except Exception as exc:
        log.exception("extract_relations failed for %s", evidence_id)
        return {"evidence_id": evidence_id, "stage": "relation_extraction", "status": "failed",
                "error": str(exc)[:300]}


@shared_task
def resolve_entities(case_id: int) -> dict:
    from apps.cases.models import Case
    from apps.graph_api.services.resolve import find_merge_candidates
    from .models import ExtractedEntity, MergeStatus, MergeSuggestion

    try:
        case = Case.objects.get(pk=case_id)
    except Case.DoesNotExist:
        return {"case_id": case_id, "stage": "entity_resolution", "status": "missing"}
    try:
        entities = list(ExtractedEntity.objects.filter(case=case).exclude(status="rejected"))
        n = 0
        for s in find_merge_candidates(entities):
            a_id, b_id = (s["a_id"], s["b_id"]) if s["a_id"] < s["b_id"] else (s["b_id"], s["a_id"])
            _, created = MergeSuggestion.objects.get_or_create(
                case=case, entity_a_id=a_id, entity_b_id=b_id,
                defaults={"score": s["score"], "reason": s["reason"]},
            )
            n += int(created)
        return {"case_id": case.id, "stage": "entity_resolution", "status": "ok", "merge_suggestions": n}
    except Exception as exc:
        log.exception("resolve_entities failed for case %s", case_id)
        return {"case_id": case_id, "stage": "entity_resolution", "status": "failed",
                "error": str(exc)[:300]}


@shared_task
def build_temporal_graph(case_id: int) -> dict:
    """Write CONFIRMED review-queue rows into Neo4j (idempotent MERGEs)."""
    from apps.cases.models import Case
    from apps.graph_api.services.graph_service import GraphService, node_key
    from .models import ExtractedEntity, ExtractedRelation, ReviewStatus

    try:
        case = Case.objects.get(pk=case_id)
    except Case.DoesNotExist:
        return {"case_id": case_id, "stage": "graph_build", "status": "missing"}
    try:
        svc = GraphService()
        nodes = edges = 0
        confirmed = ExtractedEntity.objects.filter(case=case, status=ReviewStatus.CONFIRMED)
        keys = {}
        for ent in confirmed:
            key = node_key(case.id, ent.node_type, ent.normalized)
            svc.upsert_entity(case.id, ent.node_type, {
                "value": ent.value, "normalized": ent.normalized,
                "confidence_score": ent.confidence,
                "source_evidence_id": ent.evidence_id,
                "extracted_by": f"review-confirm:{ent.engine}"})
            keys[ent.id] = key
            if ent.graph_key != key:
                ent.graph_key = key
                ent.save(update_fields=["graph_key", "updated_at"])
            nodes += 1
        rels = ExtractedRelation.objects.filter(
            case=case, status=ReviewStatus.CONFIRMED,
            src__status=ReviewStatus.CONFIRMED, dst__status=ReviewStatus.CONFIRMED)
        for rel in rels:
            src_key = keys.get(rel.src_id) or node_key(case.id, rel.src.node_type, rel.src.normalized)
            dst_key = keys.get(rel.dst_id) or node_key(case.id, rel.dst.node_type, rel.dst.normalized)
            svc.upsert_relationship(case.id, rel.edge_type, src_key, dst_key, {
                "confidence_score": rel.confidence, "source_evidence_id": rel.evidence_id,
                "snippet": rel.snippet, "extracted_by": f"review-confirm:{rel.engine}",
                "valid_from": rel.valid_from.isoformat() if rel.valid_from else None})
            edges += 1
        try:
            _post_build_alerts(case)  # Phase 7: anomaly + risk fan-out
        except Exception:
            log.exception("post-build alerts failed for case %s", case_id)
        return {"case_id": case.id, "stage": "graph_build", "status": "ok",
                "nodes_written": nodes, "edges_written": edges}
    except Exception as exc:
        log.exception("build_temporal_graph failed for case %s", case_id)
        return {"case_id": case_id, "stage": "graph_build", "status": "failed",
                "error": str(exc)[:300]}
