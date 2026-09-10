"""Mock ICJS external system — a thin file server, nothing more.

No database, no ORM, no persistence: every request reads manifest.json and
the case files straight off the filesystem. The artificial delay on file
download exists only so import-progress UIs feel real.
"""
import asyncio
import mimetypes
import os
import random

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse

CASES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases")
DOWNLOAD_DELAY = (0.2, 0.5)

app = FastAPI(title="Mock ICJS", version="0.1.0",
              description="Synthetic stand-in for an external case-bundle API. All data is invented.")


def _case_dir(case_id: str) -> str:
    if not case_id or "/" in case_id or "\\" in case_id or case_id.startswith("."):
        raise HTTPException(status_code=404, detail="Unknown case.")
    path = os.path.join(CASES_DIR, case_id)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Unknown case.")
    return path


def _manifest(case_id: str) -> dict:
    import json
    path = os.path.join(_case_dir(case_id), "manifest.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        raise HTTPException(status_code=500, detail="Corrupt manifest.")


def _safe_file(case_id: str, filename: str) -> str:
    if not filename or "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Unknown file.")
    if filename == "manifest.json":
        raise HTTPException(status_code=404, detail="Unknown file.")
    path = os.path.join(_case_dir(case_id), filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Unknown file.")
    return path


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/icjs/cases")
def list_cases():
    out = []
    if os.path.isdir(CASES_DIR):
        for case_id in sorted(os.listdir(CASES_DIR)):
            manifest_path = os.path.join(CASES_DIR, case_id, "manifest.json")
            if os.path.isfile(manifest_path):
                try:
                    m = _manifest(case_id)
                    out.append({"case_id": case_id, "title": m.get("title", case_id),
                                "state": m.get("state", ""), "district": m.get("district", "")})
                except HTTPException:
                    continue
    return {"cases": out}


@app.get("/icjs/cases/{case_id}")
def get_case(case_id: str):
    return JSONResponse(_manifest(case_id))


@app.get("/icjs/cases/{case_id}/files")
def list_files(case_id: str):
    d = _case_dir(case_id)
    files = []
    for name in sorted(os.listdir(d)):
        if name == "manifest.json" or name.startswith("."):
            continue
        full = os.path.join(d, name)
        if not os.path.isfile(full):
            continue
        ctype, _ = mimetypes.guess_type(name)
        files.append({
            "name": name,
            "size_bytes": os.path.getsize(full),
            "content_type": ctype or "application/octet-stream",
            "download_url": f"/icjs/cases/{case_id}/files/{name}",
        })
    return {"case_id": case_id, "files": files}


@app.get("/icjs/cases/{case_id}/files/{filename}")
async def download_file(case_id: str, filename: str):
    path = _safe_file(case_id, filename)
    await asyncio.sleep(random.uniform(*DOWNLOAD_DELAY))
    ctype, _ = mimetypes.guess_type(filename)
    return FileResponse(path, media_type=ctype or "application/octet-stream",
                        filename=filename)
