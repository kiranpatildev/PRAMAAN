"""Acceptance harness for the NL-to-Cypher copilot (slice 4).

Seeds one isolated eval case (PG + Neo4j), runs all 30 eval questions,
compares returned node sets to expectations, then cleans up everything.

Two execution paths per question:
  live-LLM ... question -> generate_cypher -> gate -> execute -> node set
               (only when GEMINI_API_KEY is set; exactly one call each)
  gold ....... gold Cypher -> gate -> execute -> node set
               (always runs: gates the verifier/executor/shaping half)

A case PASSES when the executed node set equals expectation (order-free)
and edge counts match (when specified). Verdicts:
  pass .......... live-LLM set matches (or gold matches when keyless)
  llm-mismatch .. gold passes but live-LLM set differs (translation error)
  gate-fail ..... gold Cypher rejected (verifier/schema bug — loudest fail)
  refused ....... model declined a fair question (quality signal, not gate)
  truncated ..... result hit the LIMIT clamp (fixture too big — fix data)

Exit code 0 prints the table + rate; the ACCEPTANCE rule lives in CI docs:
100% on gate-fail-free + pass rate threshold (see test-coverage.md).
`--keep` skips cleanup for debugging. `--case` runs one case by id.
"""
from django.core.management.base import BaseCommand

from apps.copilot.services import eval_cases
from apps.copilot.services.nl_to_cypher import (
    MAX_LIMIT,
    CypherRejected,
    GenerationUnavailable,
    resolve_temporal,
    run_graph_query,
    verify_and_scope,
)


def _seed_case():
    import datetime as _dt

    from apps.accounts.models import Role, User
    from apps.cases.models import Case
    from apps.graph_api.models import ExtractedEntity, ExtractedRelation, ReviewStatus
    from apps.graph_api.services.graph_service import GraphService

    user, _ = User.objects.get_or_create(username="eval_officer", defaults={"role": Role.SHO})
    if not user.role == Role.SHO:
        user.role = Role.SHO
        user.save(update_fields=["role"])
    # Idempotent: a crashed run may have left the previous seed behind.
    for stale in Case.objects.filter(fir_no="FIR-EVAL-GQ"):
        try:
            driver = GraphService()._driver()
            with driver.session() as s:
                s.run("MATCH (n:Case {case_id: $case}) DETACH DELETE n", case=stale.id)
            driver.close()
        except Exception:
            pass
        stale.delete()
    case = Case.objects.create(fir_no="FIR-EVAL-GQ", title="eval-graph-copilot", owner=user)
    by_value = {}
    for node_type, value, normalized, conf in eval_cases.EVAL_ENTITIES:
        ent = ExtractedEntity.objects.create(
            case=case, node_type=node_type, value=value, normalized=normalized,
            confidence=conf, engine="eval", status=ReviewStatus.CONFIRMED,
            graph_key=f"TBD:{node_type}:{normalized}")
        ent.graph_key = f"{case.id}:{node_type}:{normalized}"
        ent.save(update_fields=["graph_key"])
        by_value[value] = ent
    svc = GraphService()
    for ent in by_value.values():
        svc.upsert_entity(case.id, ent.node_type, {
            "value": ent.value, "normalized": ent.normalized,
            "confidence_score": ent.confidence, "extracted_by": "eval"})
    for src_value, edge_type, dst_value, valid_from, conf in eval_cases.EVAL_EDGES:
        src, dst = by_value[src_value], by_value[dst_value]
        rel = ExtractedRelation.objects.create(
            case=case, src=src, dst=dst, edge_type=edge_type, confidence=conf,
            snippet="eval", engine="eval", status=ReviewStatus.CONFIRMED,
            valid_from=_dt.date.fromisoformat(valid_from) if valid_from else None)
        svc.upsert_relationship(case.id, edge_type, src.graph_key, dst.graph_key, {
            "confidence_score": conf, "snippet": "eval",
            "extracted_by": "eval", "valid_from": rel.valid_from.isoformat()
            if rel.valid_from else None})
    return user, case


def _cleanup(user, case):
    from apps.graph_api.services.graph_service import GraphService
    try:
        driver = GraphService()._driver()
        with driver.session() as s:
            s.run("MATCH (n:Case {case_id: $case}) DETACH DELETE n", case=case.id)
        driver.close()
    except Exception:
        pass
    case.delete()
    if not user.owned_cases.exists():
        user.delete()


def _expected(case, case_id):
    if case.get("expect_relative"):
        span = resolve_temporal(case["question"])["ranges"][0]
        frm, to = span["from"], span["to"]
        nodes, edges = set(), 0
        by_value = {}
        for node_type, value, normalized, _c in eval_cases.EVAL_ENTITIES:
            by_value[value] = (node_type, normalized)
        for src, _et, dst, vf, _c in eval_cases.EVAL_EDGES:
            if vf and frm <= vf <= to:
                edges += 1
                nodes.add((by_value[src][0], by_value[src][1]))
                nodes.add((by_value[dst][0], by_value[dst][1]))
        return eval_cases.expected_keys(case_id, nodes), edges
    return (eval_cases.expected_keys(case_id, case["expect"]),
            case.get("expect_edges"))


def _gold_for(item):
    """(cypher, params) for an item — D6's gold resolves dates at runtime."""
    if item.get("expect_relative"):
        from apps.copilot.services.nl_to_cypher import resolve_temporal as _rt
        span = _rt(item["question"])["ranges"][0]
        return ("MATCH (a:Case:Person)-[r]->(b:Case) "
                "WHERE r.valid_from >= $date_from AND r.valid_from <= $date_to "
                "RETURN a, r, b",
                {"date_from": span["from"], "date_to": span["to"]})
    return item["gold"], dict(item.get("params", {}))


def run_eval(single=None, use_llm=True, stdout=None):
    from apps.copilot.services.gemini import is_configured
    from apps.copilot.services.nl_to_cypher import generate_cypher

    log = (lambda m: stdout.write(m + "\n")) if stdout else print
    user, case = _seed_case()
    results = []
    try:
        cases = [c for c in eval_cases.CASES if single is None or c["id"] == single]
        for item in cases:
            want_nodes, want_edges = _expected(item, case.id)
            gold_cypher, gold_params = _gold_for(item)
            # Gate check on gold first: a gate-fail is a verifier bug.
            try:
                verify_and_scope(gold_cypher, [case.id])
                gate = "ok"
            except CypherRejected as exc:
                gate = f"FAIL:{exc.reason}"
            row = {"id": item["id"], "lang": item["lang"], "cat": item["category"],
                   "gate": gate, "verdict": None, "detail": ""}
            if gate != "ok":
                row["verdict"] = "gate-fail"
                results.append(row)
                continue
            if use_llm and is_configured():
                try:
                    cand = generate_cypher(item["question"])
                except GenerationUnavailable as exc:
                    row["verdict"] = "refused"
                    row["detail"] = str(exc)[:120]
                    results.append(row)
                    continue
                if cand["unanswerable"]:
                    row["verdict"] = "refused"
                    row["detail"] = cand["explanation"][:120]
                    results.append(row)
                    continue
                try:
                    out = run_graph_query(cand["cypher"], [case.id],
                                          extra_params=cand["params"])
                except CypherRejected as exc:
                    row["verdict"] = "gate-fail"
                    row["detail"] = f"model output rejected: {exc.reason}"
                    results.append(row)
                    continue
                got = set(out["node_ids"])
                if _truncated(out):
                    row["verdict"] = "truncated"
                elif got == want_nodes and (want_edges is None
                                            or out["counts"]["edges"] == want_edges):
                    row["verdict"] = "pass"
                else:
                    row["verdict"] = "llm-mismatch"
                    row["detail"] = (f"missing={sorted(want_nodes - got)} "
                                     f"extra={sorted(got - want_nodes)}")
                results.append(row)
                continue
            # Keyless mode: execute GOLD (gates everything but translation).
            try:
                out = run_graph_query(gold_cypher, [case.id], extra_params=gold_params)
            except CypherRejected as exc:
                row["verdict"] = "gate-fail"
                row["detail"] = str(exc.reason)
                results.append(row)
                continue
            got = set(out["node_ids"])
            if _truncated(out):
                row["verdict"] = "truncated"
            elif got == want_nodes and (want_edges is None
                                        or out["counts"]["edges"] == want_edges):
                row["verdict"] = "pass-keyless"
            else:
                row["verdict"] = "gold-mismatch"
                row["detail"] = (f"missing={sorted(want_nodes - got)} "
                                 f"extra={sorted(got - want_nodes)}")
            results.append(row)
    finally:
        _cleanup(user, case)
    return results


def _truncated(out):
    return (out["counts"]["rows"] >= MAX_LIMIT or out["counts"]["nodes"] >= MAX_LIMIT)


def report(results, stdout=None):
    log = (lambda m: stdout.write(m + "\n")) if stdout else print
    tally: dict[str, int] = {}
    for r in results:
        tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1
        flag = "ok" if r["verdict"] in ("pass", "pass-keyless") else "XX"
        # Console-safe: Devanagari node names escape to \\uXXXX on cp1252
        # terminals instead of crashing the report.
        detail = r["detail"][:100].encode("ascii", "backslashreplace").decode()
        log(f"[{flag}] {r['id']:3s} {r['lang']:2s} {r['cat']:17s} "
            f"{r['verdict']:13s} gate={r['gate']} {detail}")
    total = len(results)
    passed = tally.get("pass", 0) + tally.get("pass-keyless", 0)
    log(f"pass rate: {passed}/{total} " + str(tally))
    return passed, total


class Command(BaseCommand):
    help = "Acceptance eval for NL-to-Cypher (seeds, runs 30 cases, cleans up)."

    def add_arguments(self, parser):
        parser.add_argument("--case", default=None, help="Run one case id only.")
        parser.add_argument("--no-llm", action="store_true",
                            help="Gold-only mode even with a key set.")

    def handle(self, *args, **opts):
        results = run_eval(single=opts["case"], use_llm=not opts["no_llm"],
                           stdout=self.stdout)
        passed, total = report(results, stdout=self.stdout)
        if any(r["verdict"] == "gate-fail" for r in results):
            raise SystemExit("EVAL FAILED: verifier rejected a gold query.")
