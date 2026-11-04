# COMVERA backup and recovery

Operational detail lives in `docs/OPERATIONS.md`; this page records the security view.

| Item | Current state | Verified? |
|---|---|---|
| Database backups | Render Postgres backups on the paid plan (daily, point-in-time recovery per plan) | **Unverified**: no restore test recorded |
| Uploaded files | Local disk on the Render service (5 GB) unless `STORAGE_DRIVER=s3`; disk snapshots depend on the Render plan | **Unverified** |
| Backup access | Whoever can sign in to the Render account | Protect with 2FA |
| Backup encryption | Provider-managed | **Unverified** (provider statement only) |
| Recovery point objective | 24 hours (daily backups) or less with point-in-time recovery | Target |
| Recovery time objective | Under 4 hours | Target, untested |

## Monthly restore test (15 minutes, never over the live database)
1. Render → database → Recovery → restore the latest backup into a **new** database.
2. Point a temporary copy of the web service at it (or connect with `psql`) and count organisations and documents.
3. Open one safety file PDF. Record the date and result here.
4. Delete the temporary database.

## Before taking real customers
- Do one restore test and record it.
- Move uploads to private S3-compatible storage with versioning (protects against accidental deletion), or confirm
  the Render disk snapshot schedule.
- Remember that the audit trail and platform log are append-only in the app but are still in the same database;
  backups are the protection against database loss.

Restore test log: (none yet)
