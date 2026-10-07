# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22, TypeScript, Fastify | Fast and small. Schema-validated inputs (zod). The same language as the UI. |
| Database | Postgres 16, raw SQL, numbered migrations | The domain is relational and access rules are joins. Postgres also provides LISTEN/NOTIFY for live sync and advisory locks for jobs. |
| Auth | Built in (scrypt, httpOnly session cookies, CSRF tokens) | No third-party account needed to run it. Sessions are revocable server-side. SSO can be added later (see Known limits). |
| Files | S3-compatible storage (AWS S3, Cloudflare R2, MinIO), or local disk in dev | Private bucket. Downloads go through a permission check first. |
| Email | SMTP via nodemailer, through a transactional outbox | Works with Postmark, SES, Resend, Mailgun or others. A rolled-back action never sends mail. |
| Billing | Stripe Checkout, Customer Portal and webhooks | Stripe is the source of truth. The webhook mirrors it onto the organisation. |
| AI | Claude API (`@anthropic-ai/sdk`), server-side only | The key never reaches a browser. Usage is plan-gated and metered per organisation. |
| Documents | pdfmake (PDF), docx (Word), pdf-lib (merging the bound safety file) | Pure JavaScript, no system binaries; standard PDF fonts, no network or disk access while rendering. |
| Web app | The MVP's HTML/CSS/JS, split into ES modules, no build step | Reuses the existing UI and design system as-is. |

## Tenancy model

```
organisations (kind = host | contractor)      ← the tenant
  ├─ memberships (user, role)                 ← users can belong to several organisations
  ├─ contractors                              ← a HOST's directory of contractor companies
  │     └─ linked_org_id → organisations      ← set when that company accepts an invitation
  ├─ sites (host-owned) → contractor
  │     ├─ requirements → documents → document_versions → files
  │     ├─ reviews, approvals, info_requests
  │     ├─ incidents, permits, diary_entries, inspections → defects
  │     ├─ site_workers → workers → worker_certificates
  │     ├─ toolbox_talks → toolbox_attendance
  │     └─ share_links
  ├─ documents (library_org_id)               ← a CONTRACTOR's reusable company documents
  ├─ workers, appointments
  └─ audit_events (append-only)
```

The whole access model rests on two relationships:

- A **host** sees every site it owns (`sites.org_id`).
- A **contractor** sees a site when the host's directory entry for it is linked to the contractor's
  organisation (`contractors.linked_org_id`), and only after accepting the invitation. Declined
  sites disappear from its view.

`lib/authz.ts → loadSite()` is the one gate every site-scoped route goes through. It returns
`side = host | contractor`, and routes then apply the role rules below. Anything outside the
caller's tenant returns **404**, never 403, so the API doesn't even confirm that the record exists.

### How the UI gets its data

`GET /api/bootstrap` builds the signed-in user's view server-side, in the same shape as the MVP's
old `state` object (`sites`, `requirements[siteId]`, `documents[reqId]`, `incidents[siteId]`, and
so on). The existing render code therefore ported with light changes, and filtering by tenant and
role happens on the server. On the contractor side, every site's `contractorId` is rewritten to the
contractor's own id, so the MVP's "my sites" logic still works when one contractor serves many hosts.

Writes go to small REST endpoints (`POST /api/documents/:slot/submit`, `POST /api/sites/:id/approve`,
and so on). After each write the client refetches its view.

### Live sync

Every write calls `publishChange(orgIds)`, which sends a Postgres `NOTIFY` inside the same
transaction. Each app instance `LISTEN`s and pushes a content-free `change` event over Server-Sent
Events (`/api/events`) to browsers signed into the affected organisations. Those browsers then
refetch their own permission-filtered view. No record data travels over the event channel, so it
cannot leak across tenants. This works across any number of instances, with no Redis required.

## Permission matrix

Hosts have **Owner/Admin**, **Reviewer** and **Site Staff** roles. Contractors have **Owner/Admin**
and **Staff** roles. The server enforces every rule below; the UI only hides what the server would
refuse.

| Action | Host Owner/Admin | Host Reviewer | Host Site Staff | Contractor Owner/Admin | Contractor Staff |
|---|:-:|:-:|:-:|:-:|:-:|
| View the host's sites and records | ✓ | ✓ | ✓ | only sites it has accepted | only sites it has accepted |
| Create/edit sites, requirements, contractor directory; resend or reassign invitations | ✓ | | | | |
| Approve / request correction on documents; approve Site Ready | ✓ | ✓ | | | |
| Issue or refuse permits; investigate and close incidents; log inspections and defects; verify defects | ✓ | ✓ | | | |
| Send requests for documents/information; mark them complete | ✓ | ✓ | | | |
| Report incidents; write diary entries; comment on requirements; close out a live permit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit or withdraw documents; respond to requests; request permits; mark defects resolved | | | | ✓ | ✓ |
| Manage own workers and certificates; record toolbox talks and signatures | ✓ | ✓ | | ✓ | ✓ |
| Assign workers to a site | | | | ✓ | ✓ |
| Accept or decline site invitations | | | | ✓ | |
| Create external share links | ✓ | ✓ | | ✓ | |
| Approve or ask for changes on document sections (review workspace) | ✓ | ✓ | | | |
| Comment in the review workspace | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit, save revisions of, and send review links for the company's own Studio documents | | | | ✓ | ✓ |
| Create a site join code | ✓ | | | | |
| Create a site contractors join with a site code; change its requirements, code or open/closed state | ✓ | | | | |
| Join a site with its site code (creates the contractor's own file for the site) | | | | ✓ | |
| Remove a contractor from a shared site, or restore it (with a reason the contractor sees) | ✓ | | | | |
| Add its own extra documents to its file for a site | | | | ✓ | ✓ |
| Join a site with a code | | | | ✓ | ✓ |
| Download the bound safety file of a visible site | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export own documents as one document pack | | | | ✓ | ✓ |
| Submit a company document to a site requirement | | | | ✓ | ✓ |
| Delete a never-submitted Studio document (creator or admin) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Correct a contractor's invitation details (only until it joins) | ✓ | | | | |
| Appointments register | ✓ | | | ✓ | |
| Team, roles, billing, organisation settings | ✓ | | | ✓ | |
| Create, edit and archive own projects; shape a project's requirement list | | | | ✓ | |
| File documents to own projects (counted straight away) | | | | ✓ | ✓ |
| See a visible file's timeline | ✓ | ✓ | ✓ | ✓ | ✓ |
| Suspend or lift a suspension on a contractor (all the mine's sites) | ✓ | | | | |
| Set validity rules | ✓ | | | | |
| Audit a contractor; close or reopen audit findings | ✓ | ✓ | | | |
| Respond to an audit finding | | | | ✓ | ✓ |
| See gate clearance and print QR gate cards for a visible site | ✓ | ✓ | ✓ | ✓ | ✓ |
| Send one request to every contractor on a site | ✓ | ✓ | | | |
| See safety file revisions of a visible site | ✓ | ✓ | ✓ | ✓ | ✓ |
| Make a site's or one file's requirement optional / required | ✓ | | | own projects only | |
| Record toolbox talks, induction, awareness, briefing, meeting or training sessions | ✓ | ✓ | | ✓ | ✓ |
| Set reminder days; download the organisation's data (JSON) | ✓ | | | ✓ | |
| End or resume sponsoring a contractor's file on own site | ✓ | | | | |
| Archive, restore, duplicate a site; delete one nobody joined | ✓ | | | | |
| Arrange the order of documents in own project file | | | | ✓ | |
| Redeem a promo code | ✓ | | | ✓ | |
| Platform overview (More → Platform) | only addresses in `PLATFORM_ADMIN_EMAILS` with a confirmed email; 404 for everyone else | | | | |

More rules the server enforces:

- A site can be marked Site Ready only when every requirement is complete (none expiring) and there
  is no open lost-time injury or fatality. Closing an incident requires a root cause and corrective
  actions.
- Site Ready is live (`lib/siteready.ts`): when a Site Ready file stops qualifying (a document
  sent back, withdrawn or expired, a requirement added, an open lost-time injury or fatality) the
  site returns to *in progress*, with a system audit entry and both sides notified; the background
  job re-checks every Site Ready site with the compliance agent. The public verification page and
  exports follow the status.
- Approving a document can carry the version the reviewer read; a newer version returns 409.
  Documents that lapse (COID letter, insurance, tax status, medicals, licences, load tests) and
  worker certificates of fitness can't be submitted without an expiry date.
- In the review workspace a mine counts only its own reviewers' section decisions and sees only
  its own and the author's comments; opened from a requirement, it acts on that requirement.
- Practice-space (demo) organisations and real ones can never join each other's sites.
- A mine issuing a permit directly must set its end time.
- A draft attachment (uploaded but not yet submitted) is visible only to the uploading company.
  Submitted versions stay visible to the host even if later withdrawn, because the history is part
  of the record.
- A contractor sees a host's site audit history only from its own invitation onward, and never
  events by other contractors. Hosts see everything on their sites.
- Only owners can create or change owners. The last owner can't leave or be demoted.
- An organisation whose trial or subscription has lapsed stays fully readable but can't write
  (HTTP 402), except for billing.

## Security measures

- **Passwords:** scrypt (N=2¹⁵), 10-character minimum, constant-time comparison. A dummy hash is
  checked for unknown emails so login timing doesn't reveal which accounts exist. Accounts lock for
  15 minutes after 10 failures, and login/signup/reset are rate-limited per IP.
- **Sessions:** 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in
  production). Only a SHA-256 of the token is stored. Sessions slide for 14 days. A password reset
  or change signs out other sessions, and removing a member cuts off access on their next request.
- **CSRF:** every signed-in write needs a per-session `x-csrf-token` header. Anonymous writes must
  be JSON, which forces a CORS preflight.
- **Tokens in emails** (confirmation, reset, team invites, site invites) and share links are 256-bit
  random values. Only their hashes are stored. Reset tokens are single-use and expire in 1 hour.
- **XSS:** every string from the server is HTML-escaped once on arrival in the browser
  (`core.js → deepEscape`), so data typed by another company can't inject markup. Server-rendered
  pages and emails escape too. The CSP is `script-src 'self'` with no inline scripts.
- **Uploads:** the type is decided from magic bytes, not the file name (PDF, JPEG/PNG/WebP/HEIC,
  DOCX/XLSX, text), with a 20 MB cap. Files are served with `nosniff` and a sandboxing CSP, and
  S3 downloads use 60-second presigned URLs.
- **Audit trail:** a database trigger rejects `UPDATE` and `DELETE` on `audit_events`. Only an
  explicit whole-tenant purge (expired demo sandboxes) may opt out, for one transaction.
- **POPIA-minded:** only the last 4 characters of ID numbers are stored for workers. Share pages
  are `noindex` and `no-referrer`.
- **Demo isolation:** demo users can't sign in with a password or receive email. Persona switching
  is limited to users in the same sandbox, and sandboxes are deleted after 3 days.
  `DEV_ROLE_SWITCHER` refuses to start in production.

## Background jobs

`jobs/worker.ts` runs inside the web process by default (`RUN_JOBS_IN_WEB`), or as its own process:

- **Email delivery** every 5 s, using `FOR UPDATE SKIP LOCKED`, so several workers are safe. Failed
  sends retry with exponential backoff and are marked failed after 6 attempts.
- **Reminder digests** hourly, under an advisory lock. Each item (such as "COID letter expires in 7
  days") is recorded in `reminder_log`, so it's emailed once per threshold (30 days, 7 days,
  expired) rather than daily. Each person gets a single digest.
- **Compliance agent** every 15 minutes, under an advisory lock (see below).
- **Housekeeping:** expired sessions and tokens, and demo sandboxes older than 3 days (including
  their stored files).

## Assistant and compliance agent

**Assistant** (`lib/assistant.ts`, `POST /api/assistant`). The browser sends the conversation; the
server returns a reply plus *cards* (start a site, checklist, draft, open a site).
- With an API key and a plan that includes AI, it runs a manual Claude tool-use loop (adaptive
  thinking, server-side refusal fallback, handling `tool_use`, `pause_turn` and `refusal`). Its
  tools are read-only and scoped to the caller's organisation: starter packs, own sites, one
  site's status (through `loadSite`, so cross-tenant ids return an error), plus
  `propose_site` / `prepare_checklist` / `suggest_draft`, which only produce cards.
  Web search (`AI_WEB_SEARCH`) supplies site-specific research, and citations are returned as
  sources.
- Without a key, or when the AI is rate-limited or the monthly allowance is spent, the same
  endpoint answers from rules in `lib/knowledge.ts` and the starter packs.
- Cards hand off to the normal endpoints (e.g. the Add a site sheet, prefilled), so every write
  stays under the permission matrix and audit trail. Conversations are not stored.

**Compliance agent** (`lib/agent.ts`). Every 15 minutes (and on demand) it computes findings per
organisation with plain SQL rules and upserts them into `agent_findings` keyed by
`(org_id, key)`. Findings not seen on a run are marked resolved, and a run that changes anything
sends a live-update event. Findings are delivered in `/api/bootstrap` and are only ever
selected by the viewer's own `org_id`. The assistant reads them (`get_attention_items`), and the
hourly job emails owners and admins a Monday summary (`weeklySummary` org setting, deduplicated per
ISO week).

**Support signals.** `POST /api/feedback` stores in-app problem reports (`feedback` table) and emails
`SUPPORT_EMAIL`; `POST /api/client-errors` writes browser errors to the server log without storing
them.

## Document Studio

`src/lib/studio/`: `blueprints.ts` (document types, questions and template content), `model.ts`
(the document model and its validation), `render-pdf.ts` (pdfmake, standard fonts, no network or
disk access) and `render-docx.ts` (docx), `generate.ts` (numbering, revisions, AI tailoring and
storage), and routes in `routes/studio.ts`.

- Generation reads context and runs the AI **outside** any transaction, then allocates the
  document number (under a lock on the organisation row), renders both formats and stores them in
  one short transaction.
- The AI returns the document through a `submit_document` tool whose input is validated against
  the same zod schema; invalid output is sent back once or twice to be fixed, and any failure falls
  back to the complete template draft, so generation never fails because of the AI.
- Generated files are ordinary files owned by the organisation, so downloads use the existing
  permission-checked `/api/files/:id`. `POST /api/documents/:slot/attach-generated` puts a generated
  PDF into a requirement or library slot as the pending attachment; the normal submit endpoint does
  the rest, with the review date as the expiry date.
- Branding (logo file, colour, number prefix) lives in the organisation's `settings`.

## Review workspace, inbox, join codes and the bound safety file

- **Review workspace** (`lib/review.ts`, `routes/review.ts`, `public/js/review.js`). A Studio
  document is visible to its author, and to the host only once a revision has been submitted to one
  of the host's sites (joined through `document_versions` → `requirements` → `sites`); anyone else
  gets 404. Section decisions (`doc_section_reviews`) are keyed by a hash of the section's
  canonical JSON, so an unchanged section keeps its approval across revisions and an edited one
  needs review again. Comments (`doc_comments`) belong to the document number, not a revision.
  Saving edits creates the next revision through the normal Studio pipeline (same number, new PDF
  and Word files). Only the author edits; only host owners/admins/reviewers decide.
- **Review links** (`review_links`) store only a SHA-256 of the token, expire (1–60 days), can be
  withdrawn, always show the latest revision, and let a named guest comment or decide on sections.
  Guests get the PDF through the link, never a file id.
- **Notifications** (`notifications`, `lib/notify.ts`) are one row per user, written in the same
  transaction as the event, sent in `/api/bootstrap` (latest 40) and refreshed by the usual live
  sync.
- **Join codes** (`routes/join.ts`, migration 009) are 8 characters from an unambiguous alphabet,
  stored hashed on the site's pending invitation, valid 14 days; a new code replaces the old one.
  Redeeming one runs the same acceptance as the email link. Codes are rate-limited.
- **Safety File Builder** (`public/js/builder.js`) is client-side only: it calls the same
  `POST /api/studio/documents`, `attach-generated` and `submit` endpoints one document at a time,
  so a failure on one never loses the others and every server rule still applies.
- **Bound safety file** (`lib/bundle.ts`): pdfmake renders the cover and contents (twice: once to
  count pages, once with page numbers), pdf-lib merges the documents and stamps page footers. It
  includes only documents the other side can already see (complete, expiring, awaiting review),
  the same rule as safety-file share links, and caps merged content at 80 MB.

- **Sites contractors join with a code** (`routes/workplaces.ts`, migration 010, `public/js/workplaces.js`):
  a `workplaces` row holds the site's name, location, emergency details, requirement list and site
  code. Joining (`POST /api/sites/join`, which tries a site code before one-off invitation codes)
  finds or creates the mine's directory entry for the contractor company and creates the
  contractor's own file for the site: an ordinary `sites` row with `workplace_id`, the site's
  requirements copied in and status `in_progress` (one file per contractor per site, enforced by a
  unique index). Everything else (review, builder, export, permits, readiness, Site Ready) works on
  that file unchanged, and tenancy still goes through `loadSite`. Adding a requirement to the site
  adds it to every file; removing one only affects future joiners (existing files keep their
  history). The site code is stored readable so admins can show it again; it only lets a
  contractor company ask to join, can be replaced, and the site can be closed to new joiners.
- **Safety file guide** (`public/js/guide.js`) is client-side, built from the file's requirements,
  company documents, assigned workers and the builder. `POST /api/sites/:id/my-documents` lets the
  contractor add an extra item (source `company`) to its own file.
- **Company documents on sites**: `libraryTypeFor` (`lib/readiness.ts`) matches a requirement's
  name to a company document type; `POST /api/documents/:slot/use-library` attaches the current,
  unexpired company copy as the pending file and the normal submit does the rest.
- **Contractor details**: once `contractors.linked_org_id` is set, bootstrap shows the contractor
  organisation's own registration, COID, trade, address and owner contact, and
  `PATCH /api/contractors/:id` returns 409.
- **Studio document status** comes from the requirement whose live file is any revision of the
  document number; `DELETE /api/studio/documents/:id` refuses anything that ever reached
  `document_versions`.
- **Clean-start demo** (`demo/clean.ts`): `POST /api/demo {clean:true}` creates an empty host and
  contractor organisation with one owner persona each; `settings.cleanDemo` keeps them 30 days.

## Oversight: gate clearance, audits, suspension, validity rules, revisions

- **Gate clearance** (`lib/gate.ts`, `routes/gate.ts`, migration 011). Worked out live on every
  request, never stored, so it can't go stale. A worker is cleared when: the file is `site_ready`,
  the contractor isn't suspended, the worker is active, and there is a valid medical and a valid
  induction (`lib/validity.ts → certExpiry` applies the mine's months from the issue date; with a
  rule set, a certificate without an issue date doesn't count). Each `site_workers` row gets an
  unguessable `gate_token` (18 random bytes) on first use; the QR encodes `/gate/<token>`. The
  public page is rate-limited, `no-store`, `noindex`, and shows name, occupation, company, site and
  a general reason ("the worker's medical or induction isn't in order") — never ID digits,
  employee numbers, certificate details or the suspension reason. A lost card is replaced with
  `POST /api/sites/:id/gate/:workerId/reissue`; the old QR stops working. "Today" is South African
  time. Inductions are the contractor's own certificate records (not per mine yet), so a mine that
  cares sets an induction rule (e.g. 12 months from the induction date).
- **Audits** (`routes/oversight.ts`, tables `contractor_audits`, `audit_findings`). Host
  reviewers only, through `loadSite`. Findings move `open → responded → closed`; the mine can
  reopen a responded finding with a note, which is appended to the response history. Both sides
  are notified with `notifyOrg` in the write's transaction.
- **Suspension** (`contractors.suspended_*`). Suspending runs `recheckSiteReady` on each of the
  contractor's files (the lapse reason names the suspension) and closes its pending and active
  permits with a note; Site Ready approval (which locks the contractor row `for share`) and permit
  create/issue return 409 while suspended.
- **Validity rules** live in `organisations.settings.validityRules` (1–60 months each), and months
  are added calendar-correctly (31 Aug + 6 months = end of February). On submit
  (`routes/documents.ts`) a site requirement matched to the COID or insurance company-document type
  (`libraryTypeFor`) has its expiry is capped at today + months and
  the response carries a `ruleNote`. The contractor's company library copies are not capped; the
  copy submitted to a site is.
- **Safety file revisions** (migration 012, `lib/bundle.ts`). Compiling the PDF computes the file's
  lines (section, name, status, version, expiry, included; duplicate names get "(2)") and a
  SHA-256 of them; a new `safety_file_versions` row is written only when the digest differs from
  the latest. Compiling runs in one transaction under a per-site advisory lock, so simultaneous
  downloads get consecutive revisions and a failed render records nothing. Downloads through an
  external share link record a revision too (generated by "external link from …"), which is the
  evidence of what that person was given. Workforce certificates in the file use the mine's
  validity rules, as the gate does. The agent's "audit due" reminder counts from when audits
  arrived in COMVERA (migration 011), so existing sites aren't all flagged on the day of release. The cover and
  page stamps show the revision; `GET /api/sites/:id/safety-file/revisions` returns the history and
  `diffContents` of the latest against the file as it stands. The contractor's agent adds a
  low-priority "has changed since Rev n" item.
- **Walkthrough** (`public/js/tour.js`) only sets navigation state and re-renders; it never calls
  a write endpoint.

## Contractor projects

- **Shape** (`routes/projects.ts`, migration 013). A client is an `organisations` row with
  `managed_by_org` set to the contractor (kind `host`, no memberships, so nobody can sign in to
  it). The contractor has one `contractors` entry in each client record (`linked_org_id` = itself),
  and each project is an ordinary `sites` row for that client. `loadSite` flags `project`, and
  every existing rule still applies: the contractor is on the contractor side, and host-only
  routes are unreachable because no user belongs to the client record.
- **Behaviour**: submissions to a project are `complete` straight away and don't notify
  reviewers. There is no Site Ready, gate, audit or permit issuing. The cover, share page and
  project page say it was prepared by the contractor. Client records are reused by name, and a
  record left empty after a project moves to another client is removed. Projects archive (status
  `declined`) and are never deleted, because the audit trail is append-only. Demo client records
  carry the demo group and are purged with it.
- **Limits**: `projectLimit` on plans (free: 2 active; enforced only when billing is configured).
- **Timeline**: `GET /api/sites/:id/timeline` returns the file's audit events written by either
  party (latest 200), through `loadSite`.

## Who pays: trials, sponsorships, grants, promo codes, pricing

- **Own access** (`hasOwnAccess` in `lib/plans.ts`): a subscription, a trial in date (14 days for everyone),
  or a grant (`organisations.grant_plan/grant_until`, from a promo code or the platform admin). Without
  billing configured everyone has it.
- **Sponsorships** (`lib/sponsorship.ts`, table `sponsorships`): one row per contractor file on a mine's
  site, created when the contractor joins (code or invitation). In force while not ended, within its
  dates, and while the mine itself is in good standing. A contractor without own access keeps writing
  only to sponsored files: `loadSite` refuses writes (402) on any other file for such a contractor
  (`ctx.write` marks non-GET requests), and `requireWritable` treats it as lapsed when nothing sponsors it.
  Reads and downloads always work. Mines end/resume a sponsorship (`POST /api/sites/:id/sponsorship/:action`).
- **Entitlements** (`lib/entitlements.ts`): a sponsored-only contractor gets `SPONSORED` features;
  `CONTRACTOR_PROJECTS`, AI and share links need its own plan.
- **Promo codes** (`lib/promos.ts`, tables `promo_codes`, `promo_redemptions`): created by the platform
  admin; redeemed by an org admin at `POST /api/billing/redeem` with the code row locked; the same error
  for every invalid case so codes can't be probed. A 100% code becomes a grant; less needs a Stripe coupon.
- **Pricing page** (`lib/pricing.ts`, table `plan_settings`): display prices, edited in Platform, served
  publicly at `GET /api/pricing`. Charges come from Stripe prices only.
- **Platform admin** also searches organisations and gives or removes a plan (`/api/admin/orgs/:id/grant`);
  each change is written to that customer's own audit trail as "COMVERA platform".

## Safety files, sites and the public site

- **Safety files** (contractor nav): Create safety file (`public/js/safetyfiles.js`) → join a site with its
  code, start a project, or continue a file → the guide (`guide.js`) → the readiness check sheet → preview
  (`?preview=1`, inline, no revision recorded) / download / share. Project files can be reordered
  (`POST /api/projects/:id/requirements/order`). Upload document routes a file to a company document or a
  file's requirement through the existing requirement sheet.
- **Sites** (mine): archive/restore/delete-while-unused/duplicate (`/api/workplaces/:id/...`, migration 017).
  Archived sites are closed to joining and don't count toward the site limit.
- **Sessions** record start time, work type and tools (migration 018); tools add their hazards, checks
  and PPE to the content. A future-dated session is scheduled and can't be signed before its date.
- **Risk assessments** take a matrix size (5×5 default, 4×4, 3×3).
- **Public site** (`public/js/landing.js`): `/`, `/features`, `/safety-file-builder`, `/for-contractors`,
  `/for-sites`, `/pricing`, `/how-it-works`, `/contact` (SPA routes; the server serves the shell for each).
  `POST /api/contact` stores `enquiries` (rate-limited, honeypot) and emails `SUPPORT_EMAIL`.

## Plans, privacy pages, data export, platform overview, offline shell

- **Entitlements** (`lib/entitlements.ts`): `PLAN_FEATURES` lists what each plan includes. Routes call
  `requireFeature(ctx, 'SHARE_LINKS')` (402 with the plan that includes it) or `can(org, 'AI_GENERATION')`.
  Without Stripe configured nothing is gated. AI also needs a key and stops when an account lapses.
  Bootstrap sends `org.entitlements` for display only. Site and project limits stay in `lib/plans.ts`.
- **Required vs optional** (`requirements.optional`, migration 014): `countsTowardReadiness()` in
  `lib/readiness.ts` (mirrored in `public/js/core.js`) counts an optional item only once it is filed.
- **Privacy and terms** (`routes/legal.ts`): server-rendered `/privacy` and `/terms`, marked as drafts for
  legal review; the list of service providers follows what is configured (email, Stripe, AI).
- **Data export** (`GET /api/org/export`): org admins only, rate-limited and audited. It contains the
  organisation's details, members, the same state the app shows (`buildState`) and the audit trail.
  Uploaded files are listed, not included. There are no password hashes, tokens or Stripe IDs.
- **Platform overview** (`routes/admin.ts`, `public/js/platform.js`): counts by kind, plan and
  subscription status, usage, email health, the latest sign-ups and feedback. Demo organisations are
  left out. It is read-only.
- **Service worker** (`public/sw.js`): network-first for pages and static files, with `/offline.html`
  when there is no connection. It never caches `/api` and never runs cross-origin requests.

## Known limits and next steps

These are deliberate scope boundaries, not hidden gaps:

- **SSO/SAML and 2FA** are not built. The session layer is isolated in `lib/sessions.ts`, and an
  OIDC/SAML provider such as WorkOS can issue the same sessions.
- **Scale:** `/api/bootstrap` sends an organisation's whole visible dataset (the audit trail is
  capped at the latest 300 events; filters and exports fetch more). That is comfortable up to a few
  thousand documents per organisation. Beyond that, paginate the heavy collections.
- **Rate limits** are held in memory per instance. With several instances, back
  `@fastify/rate-limit` with Redis.
- **Data subject requests** (POPIA export and erasure) are manual for now. Deleting a user touches
  the append-only audit trail, so it needs the purge flag and a deliberate procedure.
- **Integrations** (InspectX links, SAP) remain at the MVP's level: configuration fields and deep
  links only.
- **Legal content** (requirement templates, appointment presets) is a starting point, not legal
  advice. Customers configure their own.

## What was verified, and how

- `npm test`: 125 integration tests, including contractor projects (privacy, filing, requirement lists, client records, sharing, archive) and file timelines, gate clearance and the public gate page, audits and findings, validity rules, suspension, safety file revisions, site-wide requests and work activities, plus the clean-start demo, document packs, company
  documents reused on sites, Studio document statuses and deletion, and contractor details being
  read-only once joined, plus including the review workspace (visibility, section
  decisions, approvals carried across revisions, review links, notifications), join codes and the
  bound safety file, plus including every Document Studio blueprint rendered to PDF and
  Word, numbering and revisions, branding, attach-and-submit and tenant isolation, against real Postgres, covering the assistant's offline mode and
  scoping, template drafting, the compliance agent's findings and tenant isolation, requirement starter packs, tenant isolation (cross-tenant
  reads and writes all 404), the role matrix, CSRF, draft-file privacy, share-link scope, expiry
  and revocation, audit scoping and immutability, the Site Ready gates, permit/defect/request
  workflows, workforce visibility, password reset and lockout, demo isolation, and billing (signed
  Stripe webhooks, trial, seat and site limits, read-only when lapsed).
- `npm run test:e2e`: two companies in two separate browsers. Sign-up, email confirmation, site
  invitation by email, accept, upload, live update without refresh, review, Site Ready, external
  share, then revoke.
- Checked by hand during development:
  - The S3 driver against MinIO.
  - SMTP delivery through the outbox, against a local SMTP sink.
  - The AI proxy against a mock of the Messages API: streaming, PDF input, structured output,
    refusal-fallback request, usage metering, and the assistant's multi-step tool loop (tool
    errors, citations, per-role tools, contractor scoping).
  - The production build started the way the Render blueprint runs it, checked with
    `scripts/smoke.mjs`.
  - The Docker image builds and boots.
- **Not verified here, because it needs your accounts:** live Claude API calls, live Stripe
  Checkout and Customer Portal, and a real email provider's deliverability.
