"""Seed realistic demo data so frontend work is never blocked on the ML pipeline (§10.4).

Idempotent: re-runs only fill gaps (get_or_create by FIR/file, update seed
texts). Covers cross-case entities (shared phone), multiple evidence kinds,
tasks/comments, an alert rule, a formal case link, and a closed case.
"""
import random

from django.core.management.base import BaseCommand

from apps.accounts.models import Role, User
from apps.alerts.models import Alert, AlertRule
from apps.cases.models import Case, CaseAssignment, CaseComment, CaseLink, CaseTask
from apps.evidence.models import ChainOfCustody, CustodyAction, Evidence

DISTRICTS = ["Pune", "Mumbai", "Nagpur", "Nashik", "Thane"]

# (fir_suffix, title, district, station, status, risk)
CASES = [
    (1000, "Organized vehicle-theft ring", "Pune", "Kothrud", "open", "high"),
    (1001, "Cross-district extortion network", "Mumbai", "Andheri", "under_investigation", "high"),
    (1002, "Fake invoicing & money trail", "Pune", "Shivajinagar", "under_investigation", "medium"),
    (1003, "Mobile-tower dumping follow-up", "Nashik", "Central", "open", "medium"),
    (1004, "Interstate smuggling corridor", "Nagpur", "Sadar", "pending_review", "high"),
    (1005, "Loan-fraud syndicate", "Thane", "Naupada", "closed", "low"),
]

# Realistic extraction fodder: names, phones, plates, orgs, money, dates.
# The shared 9876543210 number deliberately spans cases (cross-case demo).
STATEMENTS = [
    ("witness", "On 12 March 2026, I saw Rahul Sharma meeting Vikram Patil near Pune railway station. "
     "Rahul Sharma called Vikram Patil from mobile number 9876543210. "
     "Rahul owns a white Swift car with registration MH12AB1234. "
     "R. Sharma was also seen driving the same Swift near the station."),
    ("cdr", "Call analysis dated 13 March 2026: 9876543210 (Rahul Sharma) called 9123456780 "
     "(Vikram Patil) six times between 8pm and 11pm. Vikram Patil also contacted Amit Verma on 9811112233."),
    ("bank", "Sharma Transports paid Rs 50,000 to Vikram Patil on 14 March 2026 vide UTR BKID12345. "
     "Amit Verma works for Sharma Transports as a driver."),
]

CDR_CSV = """calling,called_party,date,duration_sec,tower
9876543210,9123456780,2026-03-13,184,Pune-Kothrud
9123456780,9811112233,2026-03-13,42,Pune-Kothrud
9876543210,9811112233,2026-03-14,305,Mumbai-Andheri
"""


class Command(BaseCommand):
    help = "Create demo users, cases, evidence, workflow, and links."

    def add_arguments(self, parser):
        parser.add_argument("--cases", type=int, default=6)

    def handle(self, *args, **opts):
        random.seed(42)
        sho = self._user("sho_demo", Role.SHO, is_staff=True)
        inv = self._user("inv_demo", Role.INVESTIGATOR)
        priya = self._user("inv_priya", Role.INVESTIGATOR)
        amit = self._user("inv_amit", Role.INVESTIGATOR)
        investigators = [inv, priya, amit]

        n = min(opts["cases"], len(CASES))
        made_cases = []
        for i in range(n):
            suffix, title, district, station, status_, risk = CASES[i]
            fir = f"FIR-2026-{suffix}"
            case, created = Case.objects.get_or_create(
                fir_no=fir,
                defaults={"title": title, "description": "Seeded demo case. Replace with real FIR data.",
                          "status": status_, "risk_level": risk, "station": f"{station} PS",
                          "district": district, "owner": sho},
            )
            if not created:
                case.status, case.risk_level = status_, risk
                case.save(update_fields=["status", "risk_level"])
            made_cases.append(case)
            CaseAssignment.objects.get_or_create(case=case, user=inv,
                                                 defaults={"permission": "edit", "assigned_by": sho})
            CaseAssignment.objects.get_or_create(case=case, user=investigators[i % 3],
                                                 defaults={"permission": "edit", "assigned_by": sho})
            kind, text = STATEMENTS[i % len(STATEMENTS)]
            # NOTE: statement filename/mime intentionally match the original
            # seed so re-runs update rows in place (never duplicating live
            # review states); only ocr_text/classification refresh.
            self._evidence(case, f"{fir}-statement.pdf", "witness_statement", "application/pdf",
                           text, inv, classification=kind, confidence=0.8)
            if i in (0, 1, 3):
                self._evidence(case, f"{fir}-cdr.csv", "cdr", "text/csv",
                               CDR_CSV, inv, classification="cdr", confidence=0.9)
            if i == 2:
                self._evidence(case, f"{fir}-bank-note.txt", "bank_statement", "text/plain",
                               STATEMENTS[2][1], priya, classification="bank_statement", confidence=0.9)
            # Extraction over seed texts (best-effort: seed must never fail).
            try:
                from apps.graph_api.tasks import extract_entities, extract_relations
                for seed_ev in case.evidence.filter(ocr_engine="seed"):
                    extract_entities(seed_ev.id)
                    extract_relations(seed_ev.id)
            except Exception as exc:  # noqa: BLE001
                self.stdout.write(self.style.WARNING(f"seed extraction skipped for {fir}: {exc}"))
            Alert.objects.get_or_create(
                case=case, message=f"Seed alert for {fir}: review pending AI suggestions.",
                defaults={"kind": "info", "severity": "low"},
            )

        if made_cases:
            first = made_cases[0]
            CaseTask.objects.get_or_create(case=first, title="Verify tower-dump CDR rows",
                                           defaults={"description": "Cross-check against seizure memo.",
                                                     "assignee": inv, "created_by": sho, "status": "doing"})
            CaseTask.objects.get_or_create(case=first, title="Confirm Vikram Patil identity",
                                           defaults={"assignee": priya, "created_by": sho, "status": "todo"})
            if not CaseComment.objects.filter(case=first).exists():
                CaseComment.objects.create(case=first, author=sho,
                                           text="Focus on the shared 9876543210 number first.")
            if not AlertRule.objects.filter(user=inv, kind="any").exists():
                AlertRule.objects.create(user=inv, kind="any", min_severity="low")
            if len(made_cases) > 1:
                CaseLink.objects.get_or_create(
                    from_case=made_cases[0], to_case=made_cases[1],
                    defaults={"reason": "Shared phone 9876543210 across both cases.", "created_by": sho})
            # Instant demo graph: confirm everything in the first case, resolve + build.
            try:
                from apps.graph_api.models import ExtractedEntity, ExtractedRelation, ReviewStatus
                from apps.graph_api.tasks import build_temporal_graph, resolve_entities
                ExtractedEntity.objects.filter(case=first).update(status=ReviewStatus.CONFIRMED)
                ExtractedRelation.objects.filter(case=first).update(status=ReviewStatus.CONFIRMED)
                resolve_entities(first.id)
                build_temporal_graph(first.id)
            except Exception as exc:  # noqa: BLE001
                self.stdout.write(self.style.WARNING(f"seed graph build skipped: {exc}"))
        self.stdout.write(self.style.SUCCESS(
            f"Seeded sho_demo/inv_demo/inv_priya/inv_amit + {n} cases (password Pramaan123!)."))

    def _user(self, username, role, is_staff=False):
        user, _ = User.objects.get_or_create(username=username, defaults={"role": role, "is_staff": is_staff})
        user.set_password("Pramaan123!")
        user.role = role
        user.is_staff = is_staff
        user.totp_secret = ""  # demo logins stay 2FA-free; enable it in-app to try 2FA
        user.totp_enabled = False
        user.save()
        return user

    def _evidence(self, case, file_name, file_type, mime, text, user, classification="", confidence=0.0):
        blob = text.encode()
        ev, created = Evidence.objects.get_or_create(
            case=case, file_name=file_name,
            defaults={"file_type": file_type, "mime_type": mime, "size_bytes": len(blob),
                      "sha256": Evidence.hash_bytes(blob),
                      "storage_key": f"cases/{case.id}/{file_name}",
                      "uploaded_by": user, "classification": classification,
                      "classification_confidence": confidence,
                      "ocr_status": "done", "ocr_engine": "seed", "ocr_text": text},
        )
        if not created and ev.ocr_engine == "seed":
            ev.ocr_text, ev.ocr_status, ev.classification = text, "done", classification or ev.classification
            ev.classification_confidence = confidence or ev.classification_confidence
            ev.save(update_fields=["ocr_text", "ocr_status", "classification", "classification_confidence"])
        if created:
            ChainOfCustody.log(ev, user, CustodyAction.UPLOADED,
                               {"sha256": ev.sha256, "size_bytes": ev.size_bytes, "seed": True})
            try:  # best-effort: make seed bytes real in MinIO too
                from apps.evidence.services import storage
                storage.upload_bytes(ev.storage_key, blob, mime)
            except Exception:
                pass
        return ev
