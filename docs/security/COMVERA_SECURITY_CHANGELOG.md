# COMVERA security changelog

## 2026-11-05: platform account controls
- Suspend/deactivate/reactivate organisations and people, enforced on the server in every session path; flags and test classification; protected two-stage deletion with step-up proof, a 14-day wait and a permanent ledger; support views now need a stated reason. Migration 025. Tests: `test/accounts.test.ts`.

## 2026-11-04: customer two-step sign-in (SEC-010)
- Authenticator-app codes for every user, optional; organisation admins can require them for their members.
- Login with a password returns a single-use ticket when two-step is on; password reset no longer signs such users in.
- Recovery codes (8, single use), shared lockout, replay protection, email on every change, manager-portal reset with reason.
- Migration 024 renames `admin_mfa` to `user_mfa` (existing admin set-ups keep working) and adds `login_challenges`.

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
