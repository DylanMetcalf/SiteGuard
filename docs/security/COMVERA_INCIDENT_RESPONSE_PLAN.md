# COMVERA incident response plan

Keep this short enough to follow under pressure. Record every step with the time, in a private incident log.

## 1. Notice
Signals: the weekly security workflow fails; the uptime check fails; many `security: login_failed`, `csrf_rejected`,
`rate_limited` or `webhook_bad_signature` lines in Render's logs; a customer report; a provider alert.

## 2. Contain (first hour)
| Situation | Do this |
|---|---|
| A customer account is taken over | Ask the customer's owner to change the password (this signs out every session) and remove unknown members. Use the manager portal to send them a reset email. |
| Platform admin account suspected | Remove the address from `PLATFORM_ADMIN_EMAILS` in Render; delete its row in `user_mfa`; sign in again and re-enrol. |
| A secret may be exposed | Roll it in the provider (Paystack, Stripe, SMTP, S3, Anthropic), paste the new value into Render, then check a test payment or email. Never paste secrets into chat or tickets. |
| Database credentials exposed | Rotate the Render database password and restrict external access; Render restarts the service with the new connection string. |
| Malicious file reported | Note the file id from the audit trail; do not open it on your own machine; ask the uploading company; turn on ClamAV if it is not on. |
| Active attack or abuse | Use Render's controls to suspend the service if customers are at risk; the data stays intact. |

## 3. Assess
What data, which companies, since when. Use the audit trail (per company), `platform_actions`, the security
events in the logs, and Render's deploy history.

## 4. Notify
POPIA requires notifying the Information Regulator and affected people as soon as reasonably possible when there
are reasonable grounds to believe personal information was accessed by an unauthorised person. Contact your
attorney before sending notices. Tell affected customers plainly what happened and what to do.

## 5. Recover and learn
Restore from backup only into a new database first (COMVERA_BACKUP_AND_RECOVERY.md). Add a finding to the
register, a regression test, and a changelog entry. Review this plan.

## Contacts (fill in)
Owner: [name, phone] · Attorney: [name, phone] · Render support · Paystack support · Email provider support · Information Regulator: inforegulator.org.za
