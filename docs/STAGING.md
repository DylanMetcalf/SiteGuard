# Staging: a safe copy to test with real services

Purpose: run the bot swarm and the smoke check against a copy that uses the **real** hosting, email provider and virus scanner, with made-up data, before real customers arrive. Nothing here touches production.

## What you need to provide (I cannot do these for you)
| Item | Why | How |
|---|---|---|
| A second hosting service ("comvera-staging") and a second, empty Postgres database | Real hosting behaviour (TLS, proxy, cold starts, disk) | In Render: new web service from the same repo, new Postgres. Never point staging at the production database. |
| A throwaway sending domain or address for email | Real delivery, spam checks, links | A separate sender in the email provider (e.g. `staging@your-domain`); a test inbox you can read |
| A ClamAV scanner reachable from staging | The real upload scan | Either a ClamAV service on the host (`CLAMAV_HOST`, `CLAMAV_PORT`) or a sidecar container |
| Staging settings | The app reads these from the environment, never from code | See the list below |
| Your OK to run it | The bots create a few hundred made-up organisations and documents | Say "go" once staging exists |

## Settings for the staging service (set in the host's dashboard, never committed)
`NODE_ENV=production`, `APP_URL=https://<staging address>`, `DATABASE_URL` (staging database), `DATABASE_SSL=true`, `TRUST_PROXY=true` (the host's proxy sets the real address), `SMTP_URL` and `EMAIL_FROM` (staging sender), `CLAMAV_HOST`/`CLAMAV_PORT`, `PLATFORM_ADMIN_EMAILS=<your test address>`, `MFA_SECRET_KEY` (a new random value, not production's), `STORAGE_DRIVER` and storage credentials for a **separate** staging bucket or disk. Leave payment keys unset (or use the provider's test keys). Leave `ANTHROPIC_API_KEY` unset unless you want to test the AI features with a capped test key.

## Running the checks
1. Open the staging address and run `COMVERA_URL=https://<staging> npm run smoke`.
2. The bot scripts refuse non-local addresses on purpose. For staging only, run them from a machine that can reach it with `BOTS_ALLOW_REMOTE=1 BASE_URL=https://<staging>` **and** `DATABASE_URL` pointing at the staging database (the bots confirm email addresses and finish set-up directly in that database, which is only acceptable for a throwaway one). Run `test:bots`, then `test:bots:security`, then `test:bots:ux`.
3. Real email: sign up with a real test inbox, confirm the link arrives within a minute, and that the link works once only.
4. Real scanner: upload the standard EICAR test file (a harmless text string every scanner flags) and confirm it is refused; upload a normal PDF and confirm it is accepted.
5. Look at the host's log for lines containing `"level":50`. There should be none.
6. Delete the staging data afterwards (drop and recreate the staging database).

## Expected differences from local runs
Slower first requests (cold start), real TLS, a real proxy (so the `TRUST_PROXY` setting matters: with it off every visitor looks like one address and the limits bite), and email that actually leaves the building.
