# Tech Choices — Why, Briefly and Factually

- **Neo4j alongside Postgres, not one database.** Traversal (expand,
  shortest-path QA), centrality, and communities are graph-native; review
  queues, RBAC filtering, trigram/full-text/vector search, and audit are
  relational. The `graph_key` column joins them; Postgres stays the
  system-of-record.
- **MinIO over real S3/Supabase.** S3-compatible API with zero cloud
  dependency for a police-network demo; presigned URLs keep Django out of
  the byte path. Swap endpoint + keys for real S3 later (`storage.py` is
  the only file that knows).
- **PostGIS + pgvector in one Postgres image.** One engine for relational,
  geo-ready, and vector search. pgvector `.debs` are vendored
  (`infra/postgres/debs/`) because the 41 MB apt chain kept failing on
  slow links — offline `dpkg` install, no network at build time.
- **spaCy `en_core_web_sm` in the base image, transformers out.** The small
  model + deterministic regex + name fallback covers demo English text;
  torch/transformers stay in `requirements-ml.txt` (≈500 MB+ paddle alone)
  with lazy imports and honest `unavailable` statuses.
- **IndicBERT / IndicXlit: hooks, not code.** The build brief names them
  for regional-language NER and Devanagari↔Latin normalization (e.g.
  राहुल पाटील ↔ Rahul Patil). Only the seams exist (`engine` field
  accepts `transformers`; `transliterate()` placeholder) — no Hinglish/
  Marathi evaluation was ever run. Do not demo this as working.
- **PaddleOCR as lazy second engine.** Embedded text layers (pypdf) and
  raw text cover digital documents; scanned pages degrade to
  `unavailable` without the ML stack instead of failing the pipeline.
- **Gemini over a local LLM.** No GPU budget; `text-embedding-004` (768d)
  + `gemini-2.5-flash` via the `google-genai` SDK (the older
  `google-generativeai` package is deprecated — the code already uses the
  new one). Key-optional by design: keyword retrieval + extractive answers
  keep the demo honest offline. RAG (not a chatbot) because every claim
  must cite case-scoped evidence.
- **GDS + APOC plugins in Neo4j.** Real centrality/communities/bridges and
  relationship-preserving merges; per-case projections dropped in
  `finally`.
- **daphne, not runserver, in the container.** The alerts WebSocket needs
  ASGI; runserver is HTTP-only. Redis backs both Celery and Channels so
  worker events reach browser sockets across processes.
- **Cytoscape + MapLibre, no chart lib.** Cytoscape owns the network view;
  MapLibre + keyless Carto tiles own the map; charts are hand-rolled SVG
  bars (no Recharts dependency to carry).
- **No hardware TEE.** Threat model is credential/custody integrity, met
  by RBAC + SHA-256 + audit + (once wired) software AES. TEE would add
  ops burden with no matching attacker in scope — but note the gap above
  it: **field encryption helpers exist and are unwired**, so PII at rest
  is the actual next security task.
- **Dev-server frontend in the container** (`npm run dev`, not `next
  start`) + source-dir bind mounts: iteration speed over production
  fidelity, explicitly demo-grade.

