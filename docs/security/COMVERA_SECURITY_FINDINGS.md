# COMVERA security findings register

Dates are 2026. Severity: Critical / High / Medium / Low / Info. Confidence: how sure we are the finding is real.

| ID | Found | Component | Finding and evidence | Sev. | Conf. | Status | Fix and test |
|---|---|---|---|---|---|---|---|
| SEC-001 | 28 Oct | Logging | Link tokens appeared in request-log URLs (default Fastify serializer). | Medium | High | Fixed 28 Oct; **extended 4 Nov** to `/review/` links | `redactUrl` in `src/app.ts`; `test/redact.test.ts` |
| SEC-002 | 4 Nov | Sessions | Sliding renewal had no absolute cap: a stolen cookie used at least every 14 days never expired (`lib/sessions.ts`). | Medium | High | Fixed | 30-day cap (`SESSION_MAX_DAYS`), cleanup job; `test/security.test.ts` "absolute lifetime" (fails without the fix) |
| SEC-003 | 4 Nov | Sessions | Signing in again left the browser's earlier session row valid until expiry. | Low | High | Fixed | `createSession` deletes it; test "no session fixation" (fails without the fix) |
| SEC-004 | 4 Nov | Monitoring | Failed logins, lockouts, MFA failures, CSRF rejections, rate-limit hits and bad webhook signatures left no security trail. | Medium | High | Fixed | `lib/securityLog.ts`, wired in auth, manager, app, billing, paystack; unit test in `test/security.test.ts` |
| SEC-005 | 4 Nov | Headers | No Permissions-Policy header. | Low | High | Fixed | `onSend` hook in `src/app.ts`; header test |
| SEC-006 | 4 Nov | Dependencies | `npm audit --omit=dev`: 5 moderate (fast-uri, ip-address, and glob/minimatch under @fastify/static). | Medium | High | Fixed: 0 advisories | fast-uri 4.2.3 and 3.1.9, ip-address 10.7.6 via `npm audit fix`; `overrides.glob ^14.0.2` (minimatch 11.0.4); full suite passes |
| SEC-007 | 28 Oct | Uploads | No malware scanning; reviewers at mines open contractors' files. | Medium | High | Control built, **inactive until a ClamAV service is deployed** | `lib/scan.ts` (fails closed), `test/scan.test.ts` (clean, infected, scanner down) |
| SEC-008 | 28 Oct | Auth | No breached-password check; minimum length 10 only. | Low | High | Accepted for now | Future: k-anonymity range check (sends only a 5-character hash prefix) after a privacy review |
| SEC-009 | 28 Oct | Email | No bounce or complaint handling; failed sends become `failed` rows. | Medium | High | Partly mitigated | Manager portal "Needs attention" lists failed emails with "try again"; provider webhooks need an email provider first |
| SEC-010 | 28 Oct | Auth | MFA only for platform admins, not for customer owners or admins. | Medium | High | Fixed (Nov 2026) | Two-step sign-in for every user (optional; an organisation admin can require it). Password-only login returns a 5-minute single-use ticket, not a session; reset never signs in an MFA user. Tests: `test/mfa.test.ts` |
| SEC-011 | 4 Nov | Infrastructure | Database network exposure, role privileges, encryption at rest and backup encryption are provider settings not visible from the code. | Medium | Medium | Unverified | See COMVERA_EXTERNAL_SECURITY_CONFIGURATION.md |
| SEC-012 | 28 Oct | Auth | Account lockout is per account, so someone can lock a user out for 15 minutes. | Low | High | Accepted | Per-IP rate limits already apply; review if abused |
| SEC-013 | 28 Oct | Sharing | Share links rely on the token alone for their lifetime (read-only, expiring, revocable, view-counted). | Low | High | Accepted | Exchange links already require a one-time email code |
| SEC-014 | 4 Nov | Database | One database role for the app, migrations and jobs. | Low | High | Accepted for now | Separate migration role when the team grows |
| SEC-015 | 4 Nov | Email DNS | DMARC is `p=none` (monitoring only). | Low | High | Open, manual | Move to `p=quarantine` with a report address after 2–4 weeks of clean sending |

No Critical or High findings are open. Findings are reviewed at each release and whenever the weekly check fails.
