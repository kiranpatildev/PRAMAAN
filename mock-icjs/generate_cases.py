"""Generate the 3 synthetic ICJS case folders baked into the image.

All names, phones, FIR numbers and accounts are invented for demo purposes.
Entities are deliberately reused across files (and one phone across cases)
so PRAMAAN's extraction pipeline builds a connected graph.
"""
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases")

DISCLAIMER = (
    "DEMO DATA NOTICE: This document is entirely synthetic, generated for "
    "the PRAMAAN demonstration. Any resemblance to real persons, cases, "
    "phone numbers or accounts is purely coincidental."
)


def pdf_bytes(title, lines):
    """Minimal single-page PDF with an extractable Helvetica text layer."""
    esc = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    text_ops = [f"50 760 Td 13 TL /F1 12 Tf"]
    for ln in [title, ""] + lines:
        # crude wrap at ~95 chars so text stays on the page
        while len(ln) > 95:
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
    "CASE-2026-001": {
        "manifest": {
            "case_id": "CASE-2026-001",
            "title": "Kothrud Jewellery Heist Ring",
            "station": "Kothrud Police Station",
            "district": "Pune",
            "fir_no": "FIR/2026/1042",
            "date": "2026-03-12",
            "description": "Organised theft of gold ornaments from a Kothrud jewellery shop; "
                           "suspects identified from tower dump and witness account.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR/2026/1042", [
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
    "CASE-2026-002": {
        "manifest": {
            "case_id": "CASE-2026-002",
            "title": "Swargate Extortion Probe",
            "station": "Swargate Police Station",
            "district": "Pune",
            "fir_no": "FIR/2026/1077",
            "date": "2026-03-18",
            "description": "Shopkeepers near Swargate report extortion demands made from a "
                           "number already on record in CASE-2026-001.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR/2026/1077", [
                DISCLAIMER, "",
                "Complainant alleges extortion demands received on 18 March 2026 at Swargate,",
                "Pune from mobile number 9876543210. The voice matches accused Rahul Sharma,",
                "already named in FIR/2026/1042 (Kothrud).",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9876543210,9765432109,2026-03-18T11:05:00,240,Swargate\n"
                "9765432109,9876543210,2026-03-18T18:44:12,65,Swargate\n"
                "9876543210,9765432109,2026-03-19T09:12:33,150,Hadapsar\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-03-19,XXXX6102-Sneha Kulkarni,XXXX4521-Rahul Sharma,30000,UPI,extortion\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/322", [
                DISCLAIMER, "",
                "A seized handset contains SIM linked to mobile number 9876543210, used by",
                "Rahul Sharma. Chat backups reference Sneha Kulkarni (9765432109).",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I, Sneha Kulkarni (mobile 9765432109), state that Rahul Sharma threatened",
                "shopkeepers at Swargate on 18 March 2026 and demanded money.",
            ]),
        },
    },
    "CASE-2026-003": {
        "manifest": {
            "case_id": "CASE-2026-003",
            "title": "Hadapsar Vehicle Theft",
            "station": "Hadapsar Police Station",
            "district": "Pune",
            "fir_no": "FIR/2026/1103",
            "date": "2026-03-21",
            "description": "Motorcycle theft at Hadapsar; one suspect number overlaps CASE-2026-001.",
        },
        "files": {
            "FIR.pdf": ("pdf", "FIRST INFORMATION REPORT FIR/2026/1103", [
                DISCLAIMER, "",
                "Complainant reports theft of a motorcycle at Hadapsar, Pune on 21 March 2026.",
                "Suspect Kiran More was seen with Amit Verma (9811112233), a number already",
                "on record in the Kothrud heist case FIR/2026/1042.",
            ]),
            "CDR.csv": ("csv", None,
                "caller,callee,timestamp,duration_sec,tower_location\n"
                "9811112233,9654321098,2026-03-21T07:30:00,120,Hadapsar\n"
                "9654321098,9811112233,2026-03-21T20:02:41,88,Hadapsar\n"),
            "financial_records.csv": ("csv", None,
                "date,from_account,to_account,amount_inr,mode,remark\n"
                "2026-03-22,XXXX2203-Amit Verma,XXXX8845-Kiran More,15000,UPI,sale\n"),
            "forensic_report.pdf": ("pdf", "FORENSIC EXAMINATION REPORT FSL/2026/330", [
                DISCLAIMER, "",
                "Recovered motorcycle MH-12-CD-5678 shows tampered chassis. Call data places",
                "Amit Verma (9811112233) with Kiran More (9654321098) at Hadapsar.",
            ]),
            "witness_statement.pdf": ("pdf", "WITNESS STATEMENT CrPC 161", [
                DISCLAIMER, "",
                "I saw Kiran More riding pillion with Amit Verma towards Hadapsar",
                "on the evening of 21 March 2026.",
            ]),
        },
    },
}


def main():
    os.makedirs(BASE, exist_ok=True)
    for case_id, spec in CASES.items():
        d = os.path.join(BASE, case_id)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(spec["manifest"], f, indent=2)
        for name, spec_file in spec["files"].items():
            kind = spec_file[0]
            path = os.path.join(d, name)
            if kind == "pdf":
                _, title, lines = spec_file
                with open(path, "wb") as f:
                    f.write(pdf_bytes(title, lines))
            else:  # ("csv", None, content)
                with open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(spec_file[-1])
    total = sum(len(s["files"]) for s in CASES.values())
    print(f"generated {len(CASES)} cases, {total} files under {BASE}")


if __name__ == "__main__":
    main()
