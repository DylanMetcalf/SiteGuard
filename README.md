# SiteGuard

Contractor compliance, safety files and site operations for mining and industrial sites, as a
multi-tenant SaaS.

Mines and site owners (**hosts**) and contractor companies (**contractors**) each get their own
isolated account. A host invites a contractor onto a site by email. From then on, both companies see
the same live record for that site: requirements, submitted documents and their versions, reviews,
Site Ready approval, permits, incidents, inspections, diary, workforce, toolbox talks and the audit
trail. Neither company sees anything else the other owns.

This is the hosted successor to the single-file MVP, which is kept for reference in
[`reference/artifact-mvp/`](reference/artifact-mvp/). The UI, data model and workflows come from
that MVP. What's new is the backend underneath them.

## What's in the box

| Brief item | Status |
|---|---|
| **Data model & backend.** Organisations are the tenant; everything is scoped to one. | Postgres with numbered SQL migrations, Node/TypeScript/Fastify API |
| **Real authentication.** Email/password, invite-by-email, password reset, sessions. | Built in: scrypt hashes, httpOnly cookies, CSRF tokens, email confirmation, lockout, rate limits. The role switcher is now a demo-only persona picker. |
| **Server-enforced permissions.** | Every read and write is checked against the caller's organisation and role. Another tenant's records return 404. Covered by tests. |
| **File storage.** | S3-compatible (AWS S3, Cloudflare R2, MinIO), private objects, 60-second presigned downloads, magic-byte type checks |
| **AI drafting via a backend proxy.** | Server-side Claude API calls, plan-gated with a monthly allowance, plus expiry-date detection on uploaded certificates. No key in the browser. Without a key, drafting uses built-in templates tailored to the described work. |
| **Billing.** Plans, seats, trials, upgrade/downgrade. | Stripe Checkout + Customer Portal + webhooks. 14-day trial for hosts, free tier for contractors, per-seat plans. A lapsed account becomes read-only. |
| **Email notifications.** | Transactional outbox with retries. Invites, corrections, requests, permit requests, serious incidents, and a reminder digest for expiring docs/certificates, unclosed permits, open incidents and overdue requests. |
| **Secure external sharing.** | Expiring, revocable, audited read-only links (readiness summary or full safety file), plus public `/verify/<code>` pages |
| **Real-time sync.** | Server-Sent Events + Postgres LISTEN/NOTIFY. Colleagues and the other company see changes without refreshing. |

Onboarding: a new site owner gets a short **Getting started** checklist. Sites are created from
**requirement starter packs**: a contractor baseline plus electrical, heights & lifting, hot work &
confined space, and civil & plant add-ons, defined in `src/lib/templates.ts`. Every item stays
editable per site.

**SiteGuard Assistant**: a chat that answers "what does the safety file need for this site or
job?", checks how your sites are doing, and offers to **start the site** with the right starter
packs (or gives contractors a checklist and drafts). With an AI key it uses Claude with read-only
tools over your own data plus web search for site-specific research; without one it answers from
built-in rules. It never changes anything itself: you confirm every action.

**Document Studio**: professional, branded safety documents as **PDF and editable Word**. Pick a
document type, answer a few questions, and SiteGuard writes the full document with the company's
logo, colour, document number, revision history, review date, page numbers and sign-off blocks.
Fourteen types in seven categories: Health & Safety policy, contractor SHE plan, site-specific risk
assessment (HIRA, 5×5 matrix), method statement, hot work, confined space, lock-out/isolation and
fall protection procedures, emergency response plan, legal appointment letters, section 37(2)
agreement, toolbox talk, PPE register and equipment inspection checklists. With an AI key, Claude
tailors each document to the job and can research the site's published requirements. A
requirement that a blueprint can produce shows **Create it in Document Studio**, and the result is
attached and submitted for review in one step. Documents due for review are flagged by the
compliance agent. See `src/lib/studio/`.

**One site, many contractors**: a mine creates a **site** once (name, location, emergency
details) and ticks what every contractor's safety file must contain, starting from a researched
**General safety file** list for mines (MHSA) or construction (Construction Regulations 2014).
It gets a **site code** to share by WhatsApp, email or the notice board. Every contractor that
types the code gets **its own safety file for that site**. The mine's site page shows the site
code, the contractors grouped by trade, **one review queue** for everything waiting to be vetted,
and the site's requirements; a new requirement reaches every contractor's file at once. Sign-up
asks whether you run a site or are a contractor. (Inviting one contractor by email for a single
job still works.)

**Landing page**: someone opening the link without an account sees what SiteGuard is, who it's
for and how it works, with *Create a free account*, *Sign in*, and *Watch the 2-minute tour* (a
private demo that opens straight into the auto-playing walkthrough).

**Contractor projects**: a contractor can build a safety file for any client or site that isn't on
SiteGuard (*Sites → + Project*). It picks the client, starts from a starter list (or copies another
file's list), adds its own items, files documents from its library or Document Studio, and sends
the client the bound PDF or a secure link. The client needs no account. Filed documents count
straight away, and the PDF says the file was prepared by the contractor and not reviewed by the
client. Free contractors get 2 active projects (when billing is on); Contractor Pro is unlimited.

**Safety file check**: before the PDF downloads, SiteGuard shows what is required, what is in the
file, what is missing or expired (by name), and which workers lack a valid medical. The PDF lists
every gap rather than presenting the file as complete.

**Timeline**: each file's *Site activity* ends with its dated history from both companies — who
submitted, reviewed, approved, audited or changed what, and when.

**Walkthrough**: *More → Walkthrough* (or the button on the dashboard) is a guided tour of every
page for the mine or the contractor. It moves through the real screens, highlights each part and
explains it in a sentence or two, with Back, Next and **Auto-play** for demos. Add `?tour=1` to the
app's address to start it straight away (`?tour=1&autoplay=1` to play it hands-free). New users are
offered it once.

**Gate clearance and QR gate cards**: every worker assigned to a site gets a live gate status:
**cleared** only when their company's safety file is Site Ready, the company isn't suspended, and
their medical and induction are valid under the mine's rules; otherwise it says exactly why not.
The mine's site page has a **Gate** tab (search, filter, print today's gate list); both sides can
print **QR gate cards**. Security scans a card and sees CLEARED / NOT CLEARED with the reasons,
without logging in and without ID numbers.

**Monthly site audits**: the mine walks the contractor's work area with a 13-point checklist
(Yes / No / N/A, own items can be added). The score is Yes ÷ (Yes + No). Every "No" becomes a
**finding** with a due date that the contractor fixes and answers; the mine closes it or sends it
back. The compliance agent reminds the mine when a contractor hasn't been audited for 30 days and
flags overdue findings; audits print in the safety file's registers.

**Suspend a contractor**: from a contractor's profile, a mine admin can suspend the company on all
the mine's sites at once, with a reason the contractor sees. Site Ready is withdrawn, permits and
Site Ready approval are refused, and nobody from that company is cleared at the gate until the
suspension is lifted.

**Validity rules**: under Organisation settings the mine decides how long it accepts medicals and
inductions (from their issue date) and COID letters and liability insurance (from submission).
The earlier of the rule and the document's own date applies; the contractor is told when a rule
shortened an expiry.

**Safety file revisions**: each time the safety file PDF is compiled with different contents,
SiteGuard records a new revision (Rev 1, Rev 2…) with what was in it. *Revisions and what changed*
on the file shows the history and exactly what has changed since the last revision, and the
contractor's to-do list says when a file needs rebuilding. Downloading again with nothing changed
does not create a revision.

**Requests to every contractor at once**: on the mine's site page, *Request from contractors*
sends one document request (e.g. "Updated Letter of Good Standing by 30 November") to every
contractor on the site, or the ones you tick, linked to the matching requirement.

**Work activities in risk assessments and method statements**: tick the activities (electrical,
heights, lifting, hot work, confined space, excavation, mobile plant, machinery, underground,
chemicals) and their hazards, controls, PPE and permits are written in. Drafts are for the
contractor's competent person to check and sign.

**Safety file guide**: straight after joining, the contractor gets a six-step guide for that
site: company documents (submitted in one tap if already held), people and medicals, documents
SiteGuard writes, certificates to upload, anything else they want to add (typed in; Document
Studio offers to write it where it can), then check and download the safety file PDF.

**Safety File Builder**: on a contractor's site page, *Build my safety file* writes every
document the site still needs that Document Studio can produce (typically 7 of the 14 in the
baseline pack) in one go. Tick the documents, answer the shared questions once, watch each one
being written, then submit them all for review with one tap. What it can't write (COID letter,
insurance, CIPC and tax certificates, medicals) is listed so the contractor knows what to upload.

**Review workspace**: the site reads a submitted document on screen, section by section, and
approves each section or asks for changes (with a note, optionally quoting highlighted text).
Either side can comment. The author edits the flagged sections in the app, saves a new revision
(same number, Rev 1, 2, …) and resubmits; sections that didn't change keep their approval, so the
reviewer only re-checks what changed. The author can also send a **review link** to someone
without an account (e.g. the client's SHE manager), who can read, comment and approve sections
until the link expires or is withdrawn.

**Inbox**: the bell shows in-app notifications for new submissions, section feedback, comments,
approvals, corrections and contractors joining a site. Tapping one opens the exact document.

**Join codes**: besides the email invitation, a site can give a contractor an 8-character code
(valid 14 days). The contractor taps *Join a site with a code*, and the site is connected.

**Bound safety file**: *Export → Complete safety file* (or *Download the safety file*) on a site
(both sides, and on safety-file share links) produces one PDF: branded cover, contents with each
item's status and page number, the site registers (workforce, permits, incidents, toolbox talks),
then every submitted document, the site's appointment letters and the assigned workers'
certificates, merged in order. Photos become pages; Word files and protected PDFs get a page
saying where to find them; every page is stamped with the site and page number. Contractors can
also tick any of their documents and export them as one **document pack** PDF.

**Company documents, reused**: a contractor keeps one current COID letter, insurance, CIPC
registration, tax compliance status and policies under *Your Documents → Company documents*. Any
site requirement they satisfy shows **Submit my company copy**; saving one offers to send it to
every site that needs it; and the Safety File Builder submits them along with what it writes.

**Finding things**: every list (sites, contractors, documents, Document Studio, safety centre,
workforce, appointments, audit trail, team, share links) has a search box and status filters.
The mine's *Contractors* page lists contractors first, with trade filter and sort, and a
read-only profile: once a contractor has joined, its company details come from its own account
and the mine can't change them.

**Clean start**: *Or start fresh with no sample data* on the sign-in page creates an empty mine
and an empty contractor, both yours, switchable from the top bar and kept for 30 days: a safe
place to try every function from a true first-time start.

**Compliance agent**: a background check every 15 minutes across every organisation's sites.
It keeps a prioritised list of what needs attention (expired or expiring documents, reviews
waiting, stale invitations, sites ready to approve, overdue requests, serious incidents, permits
past expiry, lapsed worker medicals) on the dashboard, and items clear themselves once dealt with.

Ask the assistant **"What needs my attention today?"** and it answers from the agent's findings.
Owners and admins also get a **Monday summary email** (switchable in Organisation settings).

**Built for low-maintenance running:** in-app *Report a problem* (stored, and emailed to
`SUPPORT_EMAIL`), browser errors reported to the server log automatically, a health check, a
30-minute uptime check, CI on every change, and weekly Dependabot update pull requests.

Product gaps from the last audit, also built:

- **Safety Centre**: open incidents and permits across every site (More → Safety Centre).
- **Per-worker records**: medical fitness, inductions, competency and training certificates per person,
  with expiry reminders. The host sees the workers a contractor assigns to its site. Only the last 4
  characters of ID numbers are stored.
- **Legal appointments register**: e.g. OHS Act s16(1)/(2), Construction Regulations 8(1)/(7), MHSA
  appointments, with signed letters.
- **Toolbox talk attendance**: each attendee signs on the device. AI can draft the talk.
- **Dashboard customisation**: each user chooses and orders their dashboard sections.

## Going live

Non-technical? Start with **[docs/LAUNCH_GUIDE.md](docs/LAUNCH_GUIDE.md)**: one-click deploy on
Render with [`render.yaml`](render.yaml) (or a free try-out with [`render.free.yaml`](render.free.yaml)), email, domain, the AI key, costs in rands, and a demo
script for selling on site.

## Quick start (local)

Requirements: Node 20+ and Postgres 14+. Docker is optional.

```bash
cp .env.example .env
docker compose up -d postgres mailpit   # or use your own Postgres
npm install
npm run dev                             # http://localhost:3000, runs migrations on start
```

Or run everything, app included, with Docker: `docker compose up --build`.

Open http://localhost:3000 and either **Create an account** or **Explore the demo**. The demo is a
private sandbox with the MVP's sample mine, three contractor companies and personas you can switch
between. It is deleted automatically after 3 days.

Without `SMTP_URL`, emails (confirmation links, invites) are printed to the server log. With
`SMTP_URL=smtp://localhost:1025`, they appear in Mailpit at http://localhost:8025.

## Scripts

| | |
|---|---|
| `npm run dev` | API + web app with reload |
| `npm test` | Integration tests against a real Postgres (`siteguard_test` database; drops and recreates its schema) |
| `npm run test:e2e` | Two-browser Playwright flow against a running server (see the file header) |
| `npm run typecheck` | TypeScript |
| `npm run build && npm start` | Production build and server |
| `npm run migrate` / `migrate:prod` | Apply migrations manually (they also run on start) |
| `npm run smoke` | Synthetic check of a deployed app (`SITEGUARD_URL=… npm run smoke`); also runs every 30 min in GitHub Actions |
| `npm run worker:prod` | Email + reminder jobs as a separate process (optional; `RUN_JOBS_IN_WEB=false`) |

## Layout

```
src/
  app.ts, server.ts        Fastify app (security headers, CSRF, sessions) and entry point
  config.ts                Environment (validated)
  db/                      Pool, migration runner, SQL migrations
  lib/                     authz (permission model), sessions, security, plans, storage,
                           email outbox, AI proxy, assistant, compliance agent, work-type
                           knowledge + template drafts, realtime, readiness rules, audit,
                           review workspace, notifications, bound safety file (bundle)
  routes/                  auth, org/team, bootstrap (per-user view), sites, documents,
                           safety (incidents/permits/diary/inspections), requests, files,
                           workforce, share links, billing, ai, events (SSE), demo,
                           studio, review (+ review links, inbox), join codes
  jobs/                    Email delivery, reminder digests, housekeeping
  demo/seed.ts             Demo sandbox data
public/                    The web app: original design system + ES modules, no build step
test/                      Integration tests (node:test) and the Playwright e2e
reference/artifact-mvp/    The original single-file MVP
docs/                      Architecture and deployment guides
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): tenancy model, permission matrix, how the UI gets its
  data, security measures, and known limits.
- [docs/LAUNCH_GUIDE.md](docs/LAUNCH_GUIDE.md): plain-language launch steps, costs and demo script.
- [docs/SPEC_COVERAGE.md](docs/SPEC_COVERAGE.md): the owner's 117-point evolution spec, point by point:
  what exists, what update 2 added, and what is parked and why.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): recommended hosting, Stripe/email/storage setup, and a
  go-live checklist.
