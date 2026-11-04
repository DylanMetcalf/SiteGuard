# COMVERA security verification (4 November 2026)

## What was inspected, and what was not
Inspected: the whole repository (routes, middleware, sessions, auth, storage, email, payments, jobs, migrations,
frontend token handling), CI workflows, the dependency tree, and the live site's public headers and certificate
(read-only requests). **Not accessible:** the Render dashboard (database network settings, backups, disk
snapshots, environment values), the email provider, DNS management (seen only through the owner's
screenshots), Paystack. Those controls are marked unverified.

## Scans and tools
| Tool | Version | Command | Result |
|---|---|---|---|
| npm audit | npm 10.9.4 | `npm audit --omit=dev` | before: 5 moderate; after: **0** |
| TypeScript | 7.0.2 | `npm run typecheck` | clean |
| Node syntax check | Node 22.22.0 | `node --check public/js/*.js` | clean |
| Test suite | node:test | `npm test` | **238 passed, 0 failed** |
| Route guard review | custom read-only script | every `app.get/post/...` without an auth guard listed and reviewed | only intentionally public or token routes |
| SQL interpolation review | grep | template literals inside SQL | only constants and fixed ternaries |
| Live headers and certificate | `scripts/security-check.mjs` | against comvera.onrender.com | CSP, HSTS, nosniff present; Permissions-Policy missing until this change is deployed; certificate valid 29 days (auto-renewed by Render) |

## The five audits
**Audit 1: discovery and threat model.** Architecture, trust boundaries and data flows documented; threat model
T1–T20. Findings SEC-002 to SEC-006. Low-risk fix applied: dependency updates (SEC-006). Tests: full suite green.

**Audit 2: identity and authorisation.** Re-checked login, lockout, reset, password change, revocation and roles.
Found SEC-002 (no absolute session cap) and SEC-003 (previous session survives a new sign-in), fixed and proven:
the two new tests **fail without the fix and pass with it**. Membership removal, demotion and cross-tenant tests
already existed and pass. MFA for customers remains open (SEC-010).

**Audit 3: data, files, email, infrastructure.** Upload allowlist and serving headers confirmed; added optional
fail-closed ClamAV scanning on both storage choke points (`storeFile`, `storeExchangeFile`) with tests for clean,
infected and scanner-down. Personal data inventory: names, emails, phones, last 4 digits of ID numbers only,
worker certificates including medical fitness. Email DNS reviewed from screenshots: SPF and DKIM present, DMARC
`p=none`. Provider settings listed in the external configuration document (E1–E13).

**Audit 4: attack resistance.** No `eval`, no outbound fetch to user-supplied URLs (no SSRF path found), SQL
parameterised, errors return short messages without stack traces (tested). Added security event logging (SEC-004),
Permissions-Policy (SEC-005), and redaction of `/review/` link tokens (SEC-001 extended). Weekly security workflow added.

**Audit 5: independent-style verification.** Re-read every change: session cap uses a parameter (no
interpolation); cleanup job matches the cap; scanning sits before type sniffing and storage on every upload path
(documents, Studio, certificates, templates, Exchange); security events never include email addresses, tokens
or codes (unit-tested); no new public route. Full suite re-run: 238/238. Not re-verified: provider settings and
real ClamAV behaviour (only a protocol-compatible fake was used).

## Scorecard
| Area | Status |
|---|---|
| Password storage and reset | VERIFIED |
| Session management (cookie flags, revocation, lifetime, fixation) | VERIFIED |
| MFA for platform admins | VERIFIED |
| MFA for customer accounts | FAILED (not implemented: SEC-010) |
| Tenant isolation and object-level access | VERIFIED (tests) |
| CSRF | VERIFIED |
| Upload type and serving controls | VERIFIED |
| Malware scanning | PARTIALLY VERIFIED (built and tested with a fake scanner; not deployed) |
| Webhook integrity and payment state | VERIFIED |
| Dependency advisories | VERIFIED (0 on 4 Nov) |
| Security headers | VERIFIED in code; live after deploy |
| Security logging | VERIFIED (events emitted; external retention UNVERIFIED) |
| Database network exposure, backups, restore | UNVERIFIED |
| Email authentication (SPF, DKIM, DMARC) | PARTIALLY VERIFIED (records seen; DMARC monitoring only) |
| POPIA obligations | UNVERIFIED (legal review needed) |

## Readiness
- Internal development: **supported.**
- Controlled external testing (a free pilot with synthetic or low-sensitivity data first): **supported** once E1–E4 are done.
- Public launch: **not yet.** Needs SEC-010 (customer MFA, at least optional), E5, E6 or an accepted malware risk, E13 restore test, legal review, and an independent security test.
- Handling sensitive production data at scale (medical certificates for many workers): **not yet**, for the same reasons.

## Independent review recommended
Authorisation across all routes (loadSite coverage), the Exchange guest portal, the payment webhooks, the TOTP
implementation, upload handling, and the Render configuration.
