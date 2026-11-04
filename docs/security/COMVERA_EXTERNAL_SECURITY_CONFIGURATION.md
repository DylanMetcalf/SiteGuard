# External security configuration (needs a person with the account)

None of these were changed by the security programme. Each needs the account owner. Until a row is done, the
protection it describes is **not active**.

| # | Where | Setting | Why | Side effects | How to check |
|---|---|---|---|---|---|
| E1 | Render, GitHub, domains.co.za, email host, Paystack | Turn on two-factor sign-in for each account | These accounts control the whole service | None | Each account shows 2FA on |
| E2 | Render → comvera → Environment | `PLATFORM_ADMIN_EMAILS` = your address; `MFA_SECRET_KEY` = 16+ random characters | Manager portal access and encrypted authenticator secrets | Changing the key later means re-enrolling | Portal checklist shows both done |
| E3 | Render → comvera → Environment | `APP_URL=https://comvera.co.za` once the domain works | Links in emails point at the right place | None | Portal checklist "Your own web address" |
| E4 | Render → comvera → Environment | `SMTP_URL`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Resets, invitations and requests reach people | None | A password reset arrives |
| E5 | Render → database | Restrict external connections (allow list or none); keep the internal connection for the app | Database not reachable from the internet | Your own `psql` access needs an allowed IP | Connection from an unlisted IP fails |
| E6 | Render | Optional: a private ClamAV service, then set `CLAMAV_HOST` (and `CLAMAV_PORT` if not 3310) on comvera | Turns on virus scanning (SEC-007) | Extra cost; uploads are refused while the scanner is down (fail closed) | Upload of the EICAR test file is refused |
| E7 | Render → comvera → Logs | Add a log stream to an external log service | Security events kept outside the app's own account | Provider cost | Events appear in the external service |
| E8 | DNS (domains.co.za) | DMARC: after 2–4 weeks of clean sending change `p=none` to `p=quarantine` and add `rua=mailto:<your address>` | Others cannot easily send email as comvera.co.za | Mis-sent mail may land in spam: watch reports first | `dig TXT _dmarc.comvera.co.za` |
| E9 | DNS | If the app sends through a service (the `send`/`resend` records suggest one), confirm its DKIM record is verified in that service and SPF covers its sending domain | Mail delivery and spoofing protection | None | The provider's domain page shows "verified" |
| E10 | GitHub → repository settings | Secret scanning and push protection (where available); CodeQL default setup if your plan includes it; branch protection requiring CI on `main` | Catch committed secrets and code issues before merge | Merges wait for CI | Settings show enabled |
| E11 | GitHub → Actions → Variables | `COMVERA_URL=https://comvera.co.za` | Turns on the weekly live header and certificate check | None | "Security checks" workflow runs green |
| E12 | Paystack | Webhook URL `https://comvera.co.za/api/billing/paystack/webhook`; test key first | Signed payment events | None | Test purchase activates; bad signature is refused |
| E13 | Render | Do a restore test into a new database (COMVERA_BACKUP_AND_RECOVERY.md) | Proves backups work | None if restored to a new database | Restore log updated |

Never paste secret values into chat, email, tickets or this repository.
