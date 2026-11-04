# COMVERA threat model

Assets, in order of harm if exposed: workers' medical and training certificates (special personal information
under POPIA); companies' compliance documents; account credentials and sessions; link tokens; the audit trail;
payment state; backups; the Render, GitHub, domain and email accounts that control the service.

Scale: L = likelihood, I = impact (High / Medium / Low). Status refers to the register in COMVERA_SECURITY_FINDINGS.md.

| # | Threat | Actor | L | I | Main mitigations | Status |
|---|---|---|---|---|---|---|
| T1 | Read another company's documents by changing an id | Malicious user | M | H | `loadSite()` 404s, `canReadFile`, tenancy tests | Mitigated, tested |
| T2 | Escalate role inside an organisation | Malicious member | L | H | server-side role checks; last owner protected; role re-read per request | Mitigated, tested |
| T3 | Keep access after removal or demotion | Ex-member | M | M | membership checked every request | Mitigated, tested |
| T4 | Credential stuffing or brute force | External | H | H | rate limits, lockout, constant-time compare, no account enumeration | Mitigated; no MFA for ordinary users (residual) |
| T5 | Stolen session cookie used indefinitely | External, malware | M | H | httpOnly, Secure, 30-day absolute cap, sign-out-everywhere, revocation on password change | Mitigated (SEC-002) |
| T6 | Session fixation | External | L | M | new sign-in deletes the browser's previous session | Mitigated (SEC-003) |
| T7 | Forwarded or leaked link token | Recipient, mailbox compromise | M | M | hashed, expiring, revocable; Exchange adds a one-time email code; share links are read-only | Partly mitigated (SEC-013) |
| T8 | Tokens leaked through logs | Insider, log provider | M | M | URL redaction of link paths and `token`/`code` parameters | Mitigated (SEC-001, extended) |
| T9 | Malicious upload (malware for reviewers, active content) | Malicious contractor | M | H | type allowlist, sandbox CSP, `nosniff`, optional ClamAV | Partly mitigated until ClamAV is deployed (SEC-007) |
| T10 | Cross-site scripting | External | L | H | strict CSP, escaping on arrival (`deepEscape`, `escapeHtml`) | Mitigated |
| T11 | CSRF | External | L | M | per-session token, SameSite=Lax, JSON-only anonymous writes | Mitigated, tested |
| T12 | SQL injection | External | L | H | parameterised queries; interpolations reviewed are constants only | Mitigated (Audit 4 review) |
| T13 | Payment forgery or replay | External | M | M | signed webhooks, re-fetch from provider, idempotency | Mitigated, tested |
| T14 | Platform admin account takeover | External | L | H | allow-listed email, verified email, TOTP every 12 h, append-only action log, no access to file contents | Mitigated |
| T15 | Vulnerable dependency | Supply chain | M | M–H | lockfile, Dependabot, weekly audit, 0 known production advisories on 4 Nov 2026 | Mitigated, monitored |
| T16 | Compromise of Render, GitHub, domain or mailbox accounts | External | L | H | outside the app: 2FA on each, least access | Manual (see external configuration) |
| T17 | Database or backup exposure | External, misconfiguration | L | H | provider-managed; single app role; external access setting unverified | Unverified (SEC-011) |
| T18 | Denial of service | External | M | M | rate limits, body and upload limits, provider edge | Partly mitigated |
| T19 | Insider misuse by COMVERA support | Insider | L | H | counts-only portal; customer-granted, expiring support view; never file contents; logged in both places | Mitigated |
| T20 | AI or automation tooling misuse | Prompt injection | L | M | assistant is read-only, server-side, returns cards the user confirms | Mitigated |

Not modelled in depth: physical security of the provider; nation-state actors. The model should be revisited
whenever a new integration, data type or user role is added.
