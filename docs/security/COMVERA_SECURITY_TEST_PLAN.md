# COMVERA security test plan

All tests run with `npm test` against a real Postgres (`siteguard_test`), with synthetic organisations, users
and documents only. CI runs them on every pull request.

| Area | What is tested | Where |
|---|---|---|
| Unauthenticated access | API returns 401; manager and admin routes 404 or 401 | `manager.test.ts`, `platform.test.ts` |
| Cross-tenant access | other host and unrelated contractor see nothing and cannot act; library slots private; drafts private until submitted | `tenancy.test.ts`, `hardening.test.ts` |
| Object-level authorisation | templates, exchanges, projects, payments history, support view | `templates.test.ts`, `exchange.test.ts`, `projects.test.ts`, `paystack.test.ts`, `manager.test.ts` |
| Roles and privilege escalation | host member is view-only; host cannot submit, contractor cannot review; last owner protected | `tenancy.test.ts` |
| Revoked membership | removal cuts access immediately | `tenancy.test.ts` |
| Sessions | absolute lifetime; no fixation; password change and sign-out-everywhere revoke others; admin MFA session expiry | `security.test.ts`, `manager.test.ts` |
| Tokens | reset link single-use, ends sessions, no enumeration; exchange codes and attempts; share links expire and revoke; MFA replay and recovery codes single-use | `security.test.ts`, `exchange.test.ts`, `tenancy.test.ts`, `manager.test.ts` |
| Uploads | wrong file type rejected; infected rejected; scanner down rejects (fail closed) | `tenancy.test.ts`, `scan.test.ts` |
| CSRF | signed-in write without token rejected; anonymous non-JSON rejected | `tenancy.test.ts` |
| Webhooks | bad signature, duplicate, amount mismatch | `billing.test.ts`, `paystack.test.ts` |
| Error disclosure | malformed request gets a short error with no internals | `security.test.ts` |
| Headers | CSP, Permissions-Policy, nosniff, frame options | `security.test.ts` |
| Logging | security events carry no email or secrets; link tokens redacted | `security.test.ts`, `redact.test.ts` |
| Append-only records | audit trail and platform action log refuse update and delete | `manager.test.ts` and audit tests |

Not covered by automated tests (manual or external): load and denial-of-service behaviour, provider settings
(database network access, backups), email DNS, real ClamAV signatures, an independent penetration test.
