# Local Development — Zero to Demo

Prereqs: Docker + Compose, and (for host-side work) Python 3.12 + Node 20.

## 1. First boot (5–15 min, image pulls dominate)

```powershell
Copy-Item .env.example .env   # or: cp .env.example .env
docker compose up --build
```

The backend container runs `migrate` then `seed_demo --cases 6`, so first
boot ends with demo data already in place. Open:

| What | Where |
|---|---|
| App | http://localhost:8080 |
| API (+ Swagger) | http://localhost:8080/api/ · `/api/docs/` |
| Neo4j browser | http://localhost:7474 (user `neo4j`, password in `.env`) |
| MinIO console | http://localhost:9001 (keys in `.env`) |

Logins (password `Pramaan123!` for all): `sho_demo` (SHO), `inv_demo`,
`inv_priya`, `inv_amit` (investigators). Suggested first tour: log in as
`sho_demo` → open case `FIR-2026-1000` → graph explorer shows a confirmed
network → review queue on another case → confirm a relation → watch the
graph rebuild → ask the copilot *"How is Rahul Sharma connected to Vikram
Patil?"*.

## 2. Host-side development

Containers expose everything the host needs (see [infra](../architecture/infra.md)
for the remapped ports):

```powershell
$env:DATABASE_URL="postgres://pramaan:pramaan@localhost:5433/pramaan"
$env:REDIS_URL="redis://localhost:6380/0"
$env:NEO4J_URI="bolt://localhost:7687"
$env:NEO4J_PASSWORD="pramaan-neo4j"
$env:CELERY_EAGER="1"   # run Celery tasks inline (no worker needed)

cd backend
pip install -r requirements.txt
python -m spacy download en_core_web_sm
python manage.py migrate
python manage.py seed_demo --cases 6
python manage.py runserver        # HTTP only
daphne -b 127.0.0.1 -p 8000 config.asgi:application   # HTTP + ws/alerts/
```

Frontend: `cd frontend && npm install && npm run dev` (port 3000; point
`NEXT_PUBLIC_API_URL` at `http://localhost:8000/api`).

## 3. Useful commands

```powershell
python manage.py reindex --all            # rebuild RAG chunks (+ embeddings if key set)
python manage.py reindex --fir FIR-2026-1000
python manage.py backfill_geo             # pin gazetteer coords on old Location rows
python manage.py send_digest              # compose mocked email digests
python manage.py test                     # full suite (needs Postgres; see testing doc)
docker compose logs -f backend worker     # pipeline + daphne logs
```

## 4. Gotchas learned the hard way

- A local Postgres/Redis on 5432/6379 **wins over Docker's mappings** —
  always use `:5433`/`:6380` from the host.
- After editing `nginx.conf`, `docker exec pramaan-nginx-1 nginx -s reload`
  (config is a mounted file; compose won't notice the change).
- After adding an npm dependency, recreate the frontend container
  (`docker compose rm -sf frontend && docker compose up -d frontend`) —
  source-only mounts are safe, but a recreate guarantees freshness.
- Without `GEMINI_API_KEY`, embeddings and generated answers stay off;
  everything else (keyword RAG, extractive copilot) works.
- Without the `requirements-ml.txt` stack, scanned-image OCR reports
  `unavailable` instead of failing — install it for real PaddleOCR.
