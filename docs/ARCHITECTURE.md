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
| Appointments register | ✓ | | | ✓ | |
| Team, roles, billing, organisation settings | ✓ | | | ✓ | |

More rules the server enforces:

- A site can be marked Site Ready only when every requirement is complete (none expiring) and there
  is no open lost-time injury or fatality. Closing an incident requires a root cause and corrective
  actions.
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

- `npm test`: 69 integration tests, including every Document Studio blueprint rendered to PDF and
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
