"""Seed/fallback generator for the mock-ICJS case folders.

Manually placed files always win: this script only creates a manifest or
evidence file if that exact path does not already exist, and `--only`
regenerates a single case. Every case is therefore always complete enough
to import, whether its content is synthetic or hand-supplied.

All names, phones, FIR numbers and accounts below are invented for demo
purposes. Entities are deliberately reused across a case's files (and phone
9876543210 spans MH-2026-001 and KA-2026-001 across state lines) so
PRAMAAN's extraction builds connected graphs and cross-case hits.
"""
import argparse
import argparse
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases")

DISCLAIMER = (
    "DEMO DATA NOTICE: This document is entirely synthetic, generated for "
    "the PRAMAAN demonstration. Any resemblance to real persons, cases, "
    "phone numbers or accounts is purely coincidental."
)

FILE_SET = ["FIR.pdf", "CDR.csv", "financial_records.csv",
            "forensic_report.pdf", "witness_statement.pdf"]


def pdf_bytes(title, lines):
    """Minimal single-page PDF with an extractable Helvetica text layer."""
    esc = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    text_ops = ["50 760 Td 13 TL /F1 12 Tf"]
    for ln in [title, ""] + lines:
        while len(ln) > 95:  # crude wrap so text stays on the page
            cut = ln[:95].rfind(" ")
            cut = cut if cut > 0 else 95
            text_ops.append(f"({esc(ln[:cut])}) Tj T*")
            ln = ln[cut:].lstrip()
        text_ops.append(f"({esc(ln)}) Tj T*")
    stream = ("BT " + " ".join(text_ops) + " ET").encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    # Assemble with single newlines only; xref offsets must match exactly.
    parts, offsets = [b"%PDF-1.4"], []
    for i, body in enumerate(objs, start=1):
        offsets.append(sum(len(p) + 1 for p in parts))
        parts.append(b"%d 0 obj\n" % i + body + b"\nendobj")
    xref_pos = sum(len(p) + 1 for p in parts)
    table = [b"xref", ("0 %d" % (len(objs) + 1)).encode(),
             b"0000000000 65535 f "]
    table += [b"%010d 00000 n " % o for o in offsets]
    parts.append(b"\n".join(table))
    parts.append(("trailer\n<< /Size %d /Root 1 0 R >>" % (len(objs) + 1)).encode("latin-1"))
    parts.append(b"startxref\n%d\n%%%%EOF" % xref_pos)
    return b"\n".join(parts) + b"\n"


CASES = {
    "MH-2026-001": {
        "manifest": {
            "case_id": "MH-2026-001",
            "title": "Kothrud Jewellery Heist Ring",
            "state": "Maharashtra",
            "district": "Pune",
            "station": "Shivajinagar PS",
            "fir_no": "FIR-2026-1041",
            "date_registered": "2026-01-14",
            "description": "Organised theft of gold ornaments from a Kothrud jewellery shop; "
                           "suspects identified from tower dump and witness account.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR-2026-1041", [
                DISCLAIMER, "",
                "Complainant Meera Kulkarni reports that on 12 March 2026 her jewellery",
                "shop in Kothrud, Pune was robbed of gold ornaments worth Rs 18,50,000.",
                "Accused named: Rahul Sharma, mobile 9876543210.",
                "Witnesses state Rahul Sharma was seen near the shop with an unidentified",
                "associate driving a white Swift car, registration MH-12-AB-1234.",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9876543210,9123456780,2026-03-12T19:02:11,184,Kothrud\n"
                "9123456780,9876543210,2026-03-12T19:40:03,42,Kothrud\n"
                "9876543210,9811112233,2026-03-13T08:15:44,305,Swargate\n"
                "9123456780,9811112233,2026-03-13T09:01:19,97,Swargate\n"
                "9876543210,9123456780,2026-03-13T21:22:50,211,Kothrud\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-03-13,XXXX4521-Rahul Sharma,XXXX7834-Vikram Patil,50000,UPI,advance\n"
                "2026-03-14,Sharma Transports-CA9911,XXXX2203-Amit Verma,25000,NEFT,transport\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/311", [
                DISCLAIMER, "",
                "A white Swift car bearing registration MH-12-AB-1234 was seized at Kothrud",
                "on 14 March 2026. Fingerprints lifted match accused Rahul Sharma.",
                "Call records show Rahul Sharma (9876543210) in frequent contact with",
                "Vikram Patil (9123456780) around 12-13 March 2026.",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I, Suresh Jadhav (mobile 9898989898), state that on 12 March 2026 I saw",
                "Rahul Sharma with Amit Verma (9811112233) near Kothrud bus stop.",
                "Rahul Sharma received a call on 9876543210 and mentioned Vikram Patil.",
            ]),
        },
    },
    "MH-2026-002": {
        "manifest": {
            "case_id": "MH-2026-002",
            "title": "Andheri Extortion Network",
            "state": "Maharashtra",
            "district": "Mumbai",
            "station": "Andheri PS",
            "fir_no": "FIR-2026-1187",
            "date_registered": "2026-02-03",
            "description": "Extortion demands in Andheri traced to Vikram Patil, already on "
                           "record in the Kothrud heist case.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR-2026-1187", [
                DISCLAIMER, "",
                "Complainant alleges extortion demands received on 3 February 2026 at Andheri,",
                "Mumbai from mobile number 9123456780. The subscriber is Vikram Patil,",
                "already named in FIR-2026-1041 (Kothrud).",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9123456780,9742223334,2026-02-03T10:11:00,190,Andheri\n"
                "9742223334,9123456780,2026-02-03T17:52:36,74,Andheri\n"
                "9123456780,9742223334,2026-02-04T09:03:12,132,Bandra\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-02-04,XXXX3301-Nikhil Rao,XXXX7834-Vikram Patil,40000,UPI,extortion\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/340", [
                DISCLAIMER, "",
                "A motorcycle bearing registration MH-02-CD-9876 was seized at Andheri",
                "on 5 February 2026. Prints match Vikram Patil (9123456780).",
                "Call data links Vikram Patil with Nikhil Rao (9742223334).",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I, Nikhil Rao (mobile 9742223334), state that Vikram Patil threatened",
                "shopkeepers at Andheri on 3 February 2026 and demanded money.",
            ]),
        },
    },
    "KA-2026-001": {
        "manifest": {
            "case_id": "KA-2026-001",
            "title": "Whitefield Cyber-Fraud Ring",
            "state": "Karnataka",
            "district": "Bengaluru",
            "station": "Whitefield PS",
            "fir_no": "FIR-2026-2056",
            "date_registered": "2026-02-20",
            "description": "Online fraud run from Whitefield; the operator number matches a "
                           "Maharashtra accused — an interstate link.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR-2026-2056", [
                DISCLAIMER, "",
                "Complainant reports online fraud of Rs 2,40,000 on 20 February 2026 at",
                "Whitefield, Bengaluru. The operator used mobile number 9876543210,",
                "registered to accused Rahul Sharma of Maharashtra (FIR-2026-1041).",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9876543210,9755556666,2026-02-20T14:20:00,260,Whitefield\n"
                "9755556666,9876543210,2026-02-20T19:11:47,93,Whitefield\n"
                "9876543210,9755556666,2026-02-21T10:02:05,175,Electronic City\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-02-21,XXXX4521-Rahul Sharma,XXXX9012-Divya Nair,75000,UPI,fraud split\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/351", [
                DISCLAIMER, "",
                "A seized handset at Whitefield contains SIM linked to 9876543210, used by",
                "Rahul Sharma. Chat backups reference Divya Nair (9755556666) and a car",
                "with registration KA-05-MN-4321.",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I, Divya Nair (mobile 9755556666), state that Rahul Sharma directed",
                "fraud calls from Whitefield on 20 February 2026.",
            ]),
        },
    },
    "KA-2026-002": {
        "manifest": {
            "case_id": "KA-2026-002",
            "title": "Mysuru Vehicle Theft",
            "state": "Karnataka",
            "district": "Mysuru",
            "station": "Devaraja PS",
            "fir_no": "FIR-2026-2119",
            "date_registered": "2026-03-02",
            "description": "Motorcycle theft at Mysuru with no known links to other bundles.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR-2026-2119", [
                DISCLAIMER, "",
                "Complainant reports theft of a motorcycle at Mysuru on 2 March 2026.",
                "Suspect Arjun Gowda was seen near the scene by two witnesses.",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9766667777,9766667788,2026-03-02T07:30:00,120,Mysuru\n"
                "9766667788,9766667777,2026-03-02T20:02:41,88,Mysuru\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-03-03,XXXX5511-Arjun Gowda,XXXX5522-Deepak Rai,15000,UPI,sale\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/360", [
                DISCLAIMER, "",
                "Recovered motorcycle KA-09-XY-1122 shows tampered chassis. Call data places",
                "Arjun Gowda (9766667777) at Mysuru on 2 March 2026.",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I saw Arjun Gowda riding towards Mysuru palace road",
                "on the evening of 2 March 2026.",
            ]),
        },
    },
    "DL-2026-001": {
        "manifest": {
            "case_id": "DL-2026-001",
            "title": "Karol Bagh Mobile Snatching",
            "state": "Delhi",
            "district": "Delhi",
            "station": "Karol Bagh PS",
            "fir_no": "FIR-2026-3304",
            "date_registered": "2026-03-10",
            "description": "Street mobile snatching at Karol Bagh with no known links to other bundles.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR-2026-3304", [
                DISCLAIMER, "",
                "Complainant reports mobile snatching at Karol Bagh, Delhi on 10 March 2026.",
                "Suspect Rohan Mehta fled on a motorcycle, registration DL-8C-AB-1234.",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9788889999,9788889900,2026-03-10T18:40:00,45,Karol Bagh\n"
                "9788889900,9788889999,2026-03-10T21:15:22,110,Karol Bagh\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-03-11,XXXX7711-Rohan Mehta,XXXX7722-Kunal Shah,12000,UPI,quick sale\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/371", [
                DISCLAIMER, "",
                "CCTV at Karol Bagh shows Rohan Mehta (9788889999) with an accomplice on",
                "motorcycle DL-8C-AB-1234 on 10 March 2026.",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I, Kunal Shah, state that Rohan Mehta sold me a mobile phone cheaply",
                "at Karol Bagh on 11 March 2026.",
            ]),
        },
    },
}


def ensure_case(case_id, counts):
    """Write manifest + missing files for one case. Never overwrites."""
    spec = CASES[case_id]
    d = os.path.join(BASE, case_id)
    os.makedirs(d, exist_ok=True)
    manifest_path = os.path.join(d, "manifest.json")
    if not os.path.isfile(manifest_path):
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(spec["manifest"], f, indent=2)
        counts["manifests"] += 1
    for name in FILE_SET:
        path = os.path.join(d, name)
        if os.path.isfile(path):
            counts["skipped"] += 1
            continue
        kind = spec["files"][name][0]
        if kind == "pdf":
            _, title, lines = spec["files"][name]
            with open(path, "wb") as f:
                f.write(pdf_bytes(title, lines))
        else:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(spec["files"][name][-1])
        counts["created"] += 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", metavar="CASE_ID",
                        help="regenerate only this case (e.g. --only KA-2026-001)")
    args = parser.parse_args(argv)
    targets = [args.only] if args.only else sorted(CASES)
    unknown = [c for c in targets if c not in CASES]
    if unknown:
        raise SystemExit(f"unknown case(s): {', '.join(unknown)} "
                         f"(known: {', '.join(sorted(CASES))})")
    os.makedirs(BASE, exist_ok=True)
    counts = {"manifests": 0, "created": 0, "skipped": 0}
    for case_id in targets:
        ensure_case(case_id, counts)
    print(f"seeded {len(targets)} case(s) under {BASE}: "
          f"{counts['manifests']} manifests, {counts['created']} files created, "
          f"{counts['skipped']} existing files left untouched")


if __name__ == "__main__":
    main()
