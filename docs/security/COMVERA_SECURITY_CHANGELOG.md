# COMVERA security changelog

## 2026-11-04: security programme (branch `claude/siteguard-multitenant-saas-04lxw0`)
- Sessions end 30 days after sign-in at the latest (`SESSION_MAX_DAYS`); expired ones are cleaned up daily. (SEC-002)
- A new sign-in deletes the browser's previous session. (SEC-003)
- Structured security events in the server log: failed and successful logins, lockouts, password resets and
  changes, session revocation, MFA set-up, success and failure, CSRF rejections, rate-limit hits, bad webhook
  signatures, infected or unscannable uploads. No passwords, tokens, codes or email addresses. (SEC-004)
- Permissions-Policy header. (SEC-005)
- Dependencies: 0 known production advisories (fast-uri, ip-address updated; glob pinned to a fixed version). (SEC-006)
- Optional ClamAV scanning of every upload path (documents, Studio attachments, certificates, templates,
  Exchange uploads); fails closed. (SEC-007)
- `/review/` link tokens added to log redaction. (SEC-001)
- Weekly read-only security workflow and `scripts/security-check.mjs` (headers and certificate).
- New tests: `test/security.test.ts`, `test/scan.test.ts`.

No user-interface changes. No database migration. No production changes.

## Earlier
- 2026-10-28: manager portal with authenticator second step, customer-granted support access, append-only
  platform action log, link-token log redaction (PR #23).
- 2026-10-28: Paystack with signed and re-verified webhooks (PR #21).
