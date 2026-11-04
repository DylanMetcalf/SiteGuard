# COMVERA residual risks

COMVERA is not "completely secure"; no system is. These are the known risks that remain after the 4 November
2026 programme, with the reason each is accepted or the step that would reduce it.

| Risk | Level | Why it remains | What would reduce it |
|---|---|---|---|
| Customer accounts protected by password only | Medium | MFA exists only for platform admins (SEC-010) | Optional, then required, TOTP for organisation owners and admins |
| Malware in uploaded files | Medium until E6 | Scanning is built but needs a ClamAV service (SEC-007) | Deploy ClamAV (E6) |
| Provider-level settings unverified | Medium | Database exposure, backup encryption and restores cannot be seen from the code (SEC-011) | E5, E13; record evidence |
| Email deliverability and spoofing | Low–Medium | No bounce handling; DMARC monitoring only (SEC-009, SEC-015) | Email provider webhooks; DMARC quarantine (E8) |
| Forwarded share links | Low | Token-only, read-only, expiring (SEC-013) | One-time code for share links if customers ask |
| Lockout abuse | Low | Per-account lockout (SEC-012) | Watch `login_locked` events |
| Single database role | Low | Same role for app, jobs, migrations (SEC-014) | Separate migration role |
| Logs held only by Render | Low | Until a log stream is added (E7) | External log stream |
| Health information (medical certificates) | Medium | Special personal information under POPIA; legal paperwork not yet done | Attorney review, Information Officer, operator agreements, retention schedule |
| No independent test | Medium | All verification so far is in-house | Independent penetration test before public launch |
