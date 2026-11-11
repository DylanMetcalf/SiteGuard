# Operations: backups, recovery and keeping it running

Plain-language notes for whoever runs COMVERA. The setup steps are in
[LAUNCH_GUIDE.md](LAUNCH_GUIDE.md), and the technical hosting details are in [DEPLOYMENT.md](DEPLOYMENT.md).

## What holds the data

| What | Where | Backed up by |
|---|---|---|
| Records: sites, documents, reviews, workers, audit trail | Postgres database | The hosting provider's daily backups (point-in-time recovery on paid plans) |
| Uploaded files (PDFs, photos, logos) | The app's disk (`STORAGE_DRIVER=local`) or an S3/R2 bucket | Daily disk snapshots, or bucket versioning |
| Settings and secrets | Environment variables in the hosting dashboard | Keep your own copy in a password manager |
| The code | GitHub | GitHub |

COMVERA keeps no records on phones or browsers. The offline page shows only that there is no connection.

## Recovery targets (what to aim for)

These are **targets to set up and test, not promises**. Check what your hosting plan actually provides.

- **How much data you could lose (RPO):** at most 24 hours with daily backups, and minutes with
  point-in-time recovery. Turn on point-in-time recovery before the first paid customer.
- **How long you could be down (RTO):** aim for under 4 hours to restore the database and redeploy.

## Monthly restore test (15 minutes)

1. In the hosting dashboard, restore the latest database backup into a **new** database. Never restore over the live one.
2. Point a test copy of the app at it (`DATABASE_URL`) and sign in.
3. Open a site and download its safety file PDF. If that works, the backup is good.
4. Delete the test database and the test app.

## When something breaks

| Symptom | First check |
|---|---|
| Site down | `/healthz` (it checks the database too) and the hosting logs |
| Emails not arriving | More → Platform → Health ("Emails failed"), then `SMTP_URL` and the email provider's dashboard |
| AI drafting not working | `ANTHROPIC_API_KEY`. Without a key, COMVERA falls back to its built-in templates on its own |
| Users report errors | Search the logs for `browser error`; read More → Platform → Latest feedback |
| A bad deploy | Roll back to the previous deploy in the hosting dashboard. Migrations only add things, so the older version still runs |

## Restoring after data loss

1. Put the app in maintenance by scaling it to zero, or by pausing it in the dashboard.
2. Restore the database to the point just before the problem.
3. Restore the uploads disk snapshot from the same time, or the bucket versions.
4. Start the app. Migrations run on start and skip anything already applied.
5. Check a few sites, then tell affected customers what happened and what was restored.

## Customers' data requests

- **A copy of their data:** the organisation's admin downloads it under More → Organisation
  settings → Download our data.
- **Deletion:** there is no self-service deletion yet, because the audit trail is append-only. Handle it
  by hand with legal advice on what must be kept (see `PARKING_LOT.md`).

## Staging (before the first paying customer)

Use Render's *Duplicate* (or a second service from the same repository) with its own database, and point
it at a branch you deploy to first. Use Stripe test keys there and no real customer data. Test the
change on staging, then merge to `main` for production. Migrations only add things, so staging and
production can run the same code.

## Restore drill you can run any time (no hosting account needed)
`DATABASE_URL=<database> LOCAL_STORAGE_DIR=<uploads folder> npx tsx scripts/restore-drill.mts` dumps the database, archives the uploads, restores both into a **scratch** database and folder, compares every table's row count, and re-checks the SHA-256 of every stored file against the database record. It prints PASS or FAIL with reasons and never writes to the source. Verified on 2026-11-11 against a seeded local copy (76 tables, 3 files: PASS), and verified to FAIL when files are missing.

For a hosted database, restore the provider's backup into a **new** database, then run `DATABASE_URL=<live> RESTORED_DATABASE_URL=<restored> npx tsx scripts/restore-drill.mts` (add `DRILL_ALLOW_PROD_SOURCE=1` if the live name contains "prod"; reading is safe).

## Alerts
The app emails the addresses in `PLATFORM_ADMIN_EMAILS` when, over five minutes, it sees 10+ server errors, 30+ slow requests (over 3 s), 100+ failed sign-ins or 200+ turned-away requests; at most once an hour per signal; counts only, no personal details (`src/lib/alerts.ts`). These are per instance and need email delivery working. They do not replace an outside uptime check (`.github/workflows` has one); add the host's own alert for CPU, memory and database connections.

## Stored-file clean-up
Each day the app counts files nothing points at (older than 7 days, not a logo). By default it only logs the count. To delete them, set `ORPHAN_CLEANUP=delete` after you have a backup you trust; the row is re-checked before each delete.
