# Operations: backups, recovery and keeping it running

Plain-language notes for whoever runs SiteGuard. The setup steps are in
[LAUNCH_GUIDE.md](LAUNCH_GUIDE.md), and the technical hosting details are in [DEPLOYMENT.md](DEPLOYMENT.md).

## What holds the data

| What | Where | Backed up by |
|---|---|---|
| Records: sites, documents, reviews, workers, audit trail | Postgres database | The hosting provider's daily backups (point-in-time recovery on paid plans) |
| Uploaded files (PDFs, photos, logos) | The app's disk (`STORAGE_DRIVER=local`) or an S3/R2 bucket | Daily disk snapshots, or bucket versioning |
| Settings and secrets | Environment variables in the hosting dashboard | Keep your own copy in a password manager |
| The code | GitHub | GitHub |

SiteGuard keeps no records on phones or browsers. The offline page shows only that there is no connection.

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
| AI drafting not working | `ANTHROPIC_API_KEY`. Without a key, SiteGuard falls back to its built-in templates on its own |
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
