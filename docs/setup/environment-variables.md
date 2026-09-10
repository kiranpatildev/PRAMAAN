# Environment Variables

Sources, in precedence order: process env → `.env` file (compose
`env_file`, optional) → `environment:` block in `docker-compose.yml` →
Django/Next defaults. Only `.env.example` is committed; copy it to `.env`.

## Backend / compose (darlings of `docker-compose.yml` + `settings.py`)

| Variable | Used by | What it does | Example |
|---|---|---|---|
| `SECRET_KEY` | Django | Signs JWTs/sessions. Default is the well-known dev string; settings **warn** if it's still default with `DEBUG≠1` | `dev-insecure-change-me` |
| `DEBUG` | Django | `"1"` = debug mode (default) | `1` |
| `DATABASE_URL` | Django (`dj-database-url`) | Postgres DSN. Compose: `postgres://pramaan:pramaan@db:5432/pramaan`; host dev **must** use `@localhost:5433` | see left |
| `REDIS_URL` | Celery broker+backend, Channels layer | Compose: `redis://redis:6379/0`; host dev: `redis://localhost:6380/0` | see left |
| `CELERY_EAGER` | Django | `"1"` runs tasks inline (tests, host dev without a worker) | `0` in compose (unset) |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | `GraphService`, GDS service, health check | Bolt address + auth; compose wires `bolt://neo4j:7687` | `bolt://localhost:7687` (host) |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` / `MINIO_SECURE` | `storage.py` | S3-compatible store; bucket `evidence`; `MINIO_SECURE="1"` switches to https | `minio:9000` in compose |
| `CORS_ALLOWED_ORIGINS` | django-cors-headers | Comma list; compose sets `:3000,:8080` | — |
| `FIELD_ENCRYPTION_KEY` | ⚠️ read, **unused** | Intended Fernet key for field encryption; `apps/security.py` exists but no field uses it | (empty) |
| `GEMINI_API_KEY` | copilot `gemini.py` | Enables embeddings (`text-embedding-004`) + grounded generation (`GEMINI_MODEL`, default `gemini-2.0-flash`). Empty = keyword-only, extractive answers | (empty) |
| `GEMINI_MODEL` | copilot | Generation model name | `gemini-2.0-flash` |
| `RAG_TOP_K` | retrieval | Citations per answer (default `6`) | `6` |
| `SENTRY_DSN` | ⚠️ in `.env.example` only | **Nothing reads it** — no Sentry SDK is installed; reserved name | (empty) |
| `POSTGRES_USER/PASSWORD/DB` | db container | `pramaan`/`pramaan`/`pramaan` (init only) | — |
| `NEO4J_AUTH` | neo4j container | `neo4j/${NEO4J_PASSWORD}` | — |
| `MINIO_ROOT_USER/PASSWORD` | minio container | Same values as access/secret keys | — |

## Frontend

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_API_URL` | Baked at build/dev time; compose sets `http://localhost:8080/api`. The WS bell derives `ws(s)://<page-host>/ws/alerts/` from the page URL, not this var |

## Browser localStorage (set by the app, not you)

`pramaan_access` / `pramaan_refresh` (JWT), `pramaan_theme`
(`dark`/`light`), `pramaan_lang` (`en`/`hi`). IndexedDB `pramaan-outbox`
holds queued offline uploads.
