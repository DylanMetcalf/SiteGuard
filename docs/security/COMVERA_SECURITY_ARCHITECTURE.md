# COMVERA security architecture

Last reviewed 4 November 2026 (security programme, branch `claude/siteguard-multitenant-saas-04lxw0`).
Companion documents are in this folder. Nothing here contains secret values.

## Components and trust boundaries

```
 Browser (vanilla JS, CSP script-src 'self')        Guest browser (/x/:token, /review/:token, /share/:token, /gate/:token)
        │  session cookie (httpOnly, SameSite=Lax)          │  hashed link token (+ one-time email code for /x)
        ▼                                                    ▼
 ┌──────────────────────── Render web service: one Node 22 / Fastify 5 process ────────────────────────┐
 │ helmet headers · rate limits · CSRF (double submit) · session resolve · loadSite() tenant checks     │
 │ routes/* (zod-validated) → lib/* → raw parameterised SQL (pg)                                       │
 │ background jobs in-process (email outbox, reminders, compliance agent)                              │
 └───────┬───────────────────────┬───────────────────────┬──────────────────────┬──────────────────────┘
         ▼                       ▼                       ▼                      ▼
   Render Postgres 16      File storage            SMTP provider          Paystack / Stripe / Anthropic
   (single app role)       (local disk or private   (outbox, retries)      (server-to-server only;
                            S3, 60 s presigned)                            signed webhooks in)
   Optional: private ClamAV service (clamd) for upload scanning, reached only from the web service.
```

Trust boundaries: anonymous visitor → signed-in member of one organisation → organisation admin →
platform admin (allow-listed email + authenticator code) → server. Guests holding a link are a separate,
narrow boundary: they reach one exchange, review, share or gate record, never a workspace.

## Controls by layer

| Layer | Controls (file) |
|---|---|
| Identity | scrypt password hashes, 10-character minimum, constant-time compare, dummy hash for unknown emails (`lib/security.ts`, `routes/auth.ts`); lockout after 10 failures for 15 min; reset links 1 hour, single use, and they end every session; email verification tokens hashed; platform admins need a TOTP second step every 12 h (`lib/totp.ts`, `routes/manager.ts`) |
| Sessions | 256-bit random token, only its SHA-256 stored; httpOnly, Secure in production, SameSite=Lax; 14-day sliding expiry **capped at 30 days from sign-in** (`SESSION_MAX_DAYS`); a new sign-in deletes the browser's previous session; password change and "sign out everywhere" revoke other sessions; membership and role are re-read on every request, so removal or demotion is immediate (`lib/sessions.ts`) |
| Authorisation | every site-scoped route goes through `loadSite()` and returns 404 outside the caller's tenant; role checks (`requireAdmin`, `requireHostAdmin`, `requireReviewer`, `requireWritable`); contractors without their own plan may write only to sponsored files; platform routes 404 for everyone else |
| Request integrity | CSRF token per session on every write; anonymous writes must be JSON; zod validation; 1 MB JSON body limit; per-route rate limits (about 90 routes) |
| Files | magic-byte allowlist (PDF, JPEG, PNG, WebP, HEIC, DOCX, XLSX, UTF-8 text); random storage keys; size limit (`MAX_UPLOAD_MB`, default 20); served with `nosniff`, a sandboxing CSP and `content-disposition`; S3 downloads via 60-second presigned URLs; downloads by another company are audited; **optional ClamAV scanning that fails closed** (`lib/scan.ts`) |
| Data | parameterised SQL throughout; tenant filters in queries; append-only audit trail and platform action log enforced by database triggers; transactional outbox for email |
| Payments | no card data; signed webhooks (Stripe SDK, Paystack HMAC-SHA512 with constant-time compare); payment counted only after re-fetching the transaction from the provider; idempotent event tables |
| Transport and browser | HSTS (1 year, production), CSP `script-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, **Permissions-Policy denying camera, microphone, location, payment, USB** |
| Logging | link tokens redacted from request logs; **structured security events** (`{"security":"login_failed",...}`) with user ids or a one-way email reference, never passwords, tokens or codes (`lib/securityLog.ts`) |
| Supply chain | lockfile; Dependabot; weekly `npm audit` and live header and certificate check (`.github/workflows/security.yml`) |

## Data flows that carry sensitive information
1. Upload: browser → `/api/documents/:slot/file` (auth, CSRF, size) → scan (if on) → magic-byte check → storage → DB row.
2. Download: browser → `/api/files/:id` → `canReadFile` (owner, or a site the caller can see where it was submitted) → storage stream or presigned URL.
3. Guest request: email link → `/x/:token` → one-time code to the recipient's email → `cx` cookie scoped to `/api/x` → that one exchange only.
4. Payment: browser → Paystack page → signed webhook → re-fetch transaction → entitlement.
5. Email: write transaction inserts into `email_outbox` → worker sends with retries (6) → `failed` rows are shown in the manager portal.
