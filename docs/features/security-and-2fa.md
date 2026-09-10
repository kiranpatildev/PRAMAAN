# Security & 2FA

## RBAC — enforced in code, three ways

1. **Queryset scoping**: `CaseViewSet.get_queryset` (SHO all, else
   owned∪assigned); alert feed, notifications, reports, search, risk, and
   cross-case all filter by `visible_case_ids()` (`None` = SHO).
2. **Per-object checks**: `user_can_view_case` / `user_can_edit_case`
   (`apps/cases/permissions.py`, the single RBAC home) guard every
   detail/write path; case delete and merge-approve are SHO-only (403
   otherwise, both covered by tests).
3. **Middleware audit**: `AuditLogMiddleware` logs every POST/PUT/PATCH/
   DELETE under `/api/` (except `/api/audit/` itself) with actor, path,
   response status, and IP — best-effort, never breaks the request. The
   audit list itself is SHO-only and **read-only**.

Roles: `sho` / `investigator` / `admin` on `User` (`is_sho()` covers
sho+admin+superuser); fine-grained case rights via `CaseAssignment`
(view/edit/admin).

## 2FA (TOTP) — the exact flow

`apps/accounts/totp.py` is stdlib-only RFC 6238 (base32 secret, 30 s,
SHA-1, 6 digits, ±1 step skew, constant-time compare).

1. **Setup** (authed): `POST /api/auth/2fa/setup/` stores a fresh secret
   (`totp_enabled` stays false) and returns `{secret, otpauth_url}` for
   the authenticator app.
2. **Verify**: `POST /api/auth/2fa/verify/ {code}` → 400 on wrong code,
   else `totp_enabled: true`.
3. **Login gate**: `POST /api/auth/login/` with 2FA on returns
   `{two_factor_required: true, pre_token}` — a 5-minute JWT with
   `purpose: "2fa"` — instead of tokens. The login page then shows the
   code step.
4. **Second step**: `POST /api/auth/login/2fa/ {pre_token, code}` → real
   pair on success, 401 on bad/expired pre-token or code.
5. **Disable**: `POST /api/auth/2fa/disable/ {password}` (password-checked
   while enabled); `2fa/status/` reports state. Dashboard `SecurityCard`
   wraps all of it. Seed resets demo users to 2FA-free.

## Evidence integrity

SHA-256 at upload (`Evidence.hash_bytes`), uuid-prefixed MinIO keys,
presigned downloads (1 h evidence, 7-day reports), and an append-only
`ChainOfCustody` ledger (SET_NULL FK — deleting a file keeps its trail;
snapshot stores file_name/sha256/case). Report PDFs embed the full hash
manifest for out-of-band verification.

## Encryption & TEE — read carefully

- In transit: JWT Bearer; production TLS terminates upstream of nginx
  (hardening headers set: `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`).
- At rest: **no field-level encryption is active**. `apps/security.py`
  (Fernet AES helpers) and `FIELD_ENCRYPTION_KEY` exist but **nothing
  imports them** — no model field is encrypted today. This is the one
  security gap to close before handling real PII (wire the helpers into
  sensitive fields or adopt a proper encrypted-field package).
- ⚠️ **No hardware TEE** (SGX/TrustZone) anywhere, by decision: the threat
  model is credential/custody integrity, met by RBAC + hashes + audit +
  (once wired) software AES — see [tech-choices](../decisions/tech-choices.md).
