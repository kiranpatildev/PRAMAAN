"""Court-ready evidence package (Phase 7): one PDF bundling case summary,
evidence manifest with SHA-256 hashes, per-file chain-of-custody ledger,
confirmed network findings, and a hash manifest page.

reportlab/platypus only — no external binaries, demo-safe.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone


def _doc(title):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer
    buf = io.BytesIO()
    styles = getSampleStyleSheet()
    doc = BaseDocTemplate(buf, pagesize=A4, title=title,
                          leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame])])
    return doc, styles, buf


MAX_EXHIBIT_BYTES = 5 * 1024 * 1024
EXHIBIT_MIMES = {"image/png", "image/jpeg"}


def build_evidence_package(case, generated_by: str = "", exhibits=None) -> bytes:
    """Render the full package. Raises nothing — callers catch Exception.

    exhibits: [{label, png_bytes, sha256, captured_at?}] rendered as §5 map
    exhibits (caption + pixels + hash). Omitted entirely when empty, so
    exhibit-free packages render byte-comparably to before (modulo dates).
    """
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Image as RLImage, Paragraph, Spacer, Table, TableStyle

    from apps.evidence.models import ChainOfCustody, Evidence
    from apps.graph_api.models import ExtractedEntity, ExtractedRelation, ReviewStatus

    doc, styles, buf = _doc(f"PRAMAAN evidence package — {case.fir_no}")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, leading=10)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], spaceBefore=12, textColor=colors.HexColor("#1e3a5f"))
    story = [
        Paragraph(f"PRAMAAN — Evidence Package", styles["Title"]),
        Paragraph(f"Case {case.fir_no} — {case.title}", styles["Heading2"]),
        Paragraph(f"Status: {case.status} · Station: {case.station or '—'} · District: {case.district or '—'}",
                  styles["Normal"]),
        Paragraph(f"Generated {now} by {generated_by or 'system'} · PRAMAAN court-ready export", small),
        HRFlowable(width="100%", thickness=1, color=colors.grey),
    ]

    evs = list(Evidence.objects.filter(case=case).select_related("uploaded_by").order_by("created_at"))
    story.append(Paragraph(f"1. Evidence manifest ({len(evs)} file(s))", h2))
    manifest = [["#", "File", "Type", "Size", "SHA-256 (truncated)", "Classified"]]
    for i, ev in enumerate(evs, 1):
        manifest.append([str(i), ev.file_name[:38], ev.file_type, str(ev.size_bytes),
                         ev.sha256[:20] + "…", f"{ev.classification or '—'} ({ev.classification_confidence:.0%})"
                         if ev.classification else "—"])
    story.append(_table(manifest, [22, 150, 60, 45, 110, 90]))

    story.append(Paragraph("2. Chain-of-custody ledger", h2))
    if not evs:
        story.append(Paragraph("No evidence on file.", styles["Normal"]))
    for ev in evs:
        story.append(Paragraph(f"{ev.file_name}", styles["Heading3"]))
        entries = ChainOfCustody.objects.filter(evidence=ev).select_related("actor").order_by("timestamp")
        rows = [["Timestamp (UTC)", "Action", "Actor", "Details"]]
        for c in entries:
            rows.append([c.timestamp.strftime("%Y-%m-%d %H:%M"),
                         c.action, str(c.actor or "pipeline"), str(c.details)[:80]])
        story.append(_table(rows or [["—", "No custody entries", "", ""]], [80, 80, 80, 237]))

    confirmed_e = ExtractedEntity.objects.filter(case=case, status=ReviewStatus.CONFIRMED).order_by("-confidence")
    confirmed_r = (ExtractedRelation.objects.filter(case=case, status=ReviewStatus.CONFIRMED)
                   .select_related("src", "dst").order_by("-confidence")[:50])
    story.append(Paragraph(f"3. Confirmed network findings ({confirmed_e.count()} entities)", h2))
    erows = [["Entity", "Type", "Confidence", "Mentions"]]
    for e in confirmed_e[:40]:
        erows.append([e.value[:40], e.node_type, f"{e.confidence:.0%}", str(e.mention_count)])
    story.append(_table(erows, [200, 90, 70, 60]))
    story.append(Paragraph("Top confirmed links", styles["Heading3"]))
    rrows = [["From", "Relation", "To", "Confidence"]]
    for r in confirmed_r[:30]:
        rrows.append([r.src.value[:30], r.edge_type, r.dst.value[:30], f"{r.confidence:.0%}"])
    story.append(_table(rrows, [150, 130, 150, 60]))

    story.append(Paragraph("4. Hash manifest (verify integrity)", h2))
    hrows = [["File", "Full SHA-256"]]
    for ev in evs:
        hrows.append([ev.file_name[:40], ev.sha256])
    story.append(_table(hrows, [150, 327]))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        "This package was generated from the PRAMAAN system of record. Recompute SHA-256 over the "
        "original files and compare against §4 to verify nothing was altered.", small))

    exhibits = exhibits or []
    if exhibits:
        story.append(Paragraph(f"5. Map exhibits ({len(exhibits)})", h2))
        for ex in exhibits:
            story.append(Paragraph(f"{ex.get('label') or 'Map view'}"
                                   f" — captured {ex.get('captured_at') or now}", styles["Normal"]))
            story.append(Paragraph(f"SHA-256: {ex.get('sha256') or ''}", small))
            story.append(Spacer(1, 3 * mm))
            story.append(_exhibit_image(doc, ex.get("png_bytes") or b""))
            story.append(Spacer(1, 6 * mm))

    doc.build(story)
    return buf.getvalue()


def _exhibit_image(doc, png_bytes: bytes):
    """Fit exhibit pixels to page width, preserving aspect. Never raises."""
    from reportlab.platypus import Image as RLImage, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet
    try:
        from PIL import Image as PILImage
        with PILImage.open(io.BytesIO(png_bytes)) as im:
            w, h = im.size
        scale = doc.width / max(w, 1)
        return RLImage(io.BytesIO(png_bytes), width=doc.width, height=h * scale)
    except Exception:
        styles = getSampleStyleSheet()
        return Paragraph("[map exhibit image could not be rendered]", styles["Normal"])


def _table(rows, widths):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("LEADING", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t
