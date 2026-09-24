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
| **Data model & backend.** Organisations are the tenant; everything is scoped to one. | Postgres, 4 SQL migrations, Node/TypeScript/Fastify API |
| **Real authentication.** Email/password, invite-by-email, password reset, sessions. | Built in: scrypt hashes, httpOnly cookies, CSRF tokens, email confirmation, lockout, rate limits. The role switcher is now a demo-only persona picker. |
| **Server-enforced permissions.** | Every read and write is checked against the caller's organisation and role. Another tenant's records return 404. Covered by tests. |
| **File storage.** | S3-compatible (AWS S3, Cloudflare R2, MinIO), private objects, 60-second presigned downloads, magic-byte type checks |
| **AI drafting via a backend proxy.** | Server-side Claude API calls, plan-gated with a monthly allowance, plus expiry-date detection on uploaded certificates. No key in the browser. |
| **Billing.** Plans, seats, trials, upgrade/downgrade. | Stripe Checkout + Customer Portal + webhooks. 14-day trial for hosts, free tier for contractors, per-seat plans. A lapsed account becomes read-only. |
| **Email notifications.** | Transactional outbox with retries. Invites, corrections, requests, permit requests, serious incidents, and a reminder digest for expiring docs/certificates, unclosed permits, open incidents and overdue requests. |
| **Secure external sharing.** | Expiring, revocable, audited read-only links (readiness summary or full safety file), plus public `/verify/<code>` pages |
| **Real-time sync.** | Server-Sent Events + Postgres LISTEN/NOTIFY. Colleagues and the other company see changes without refreshing. |

Onboarding: a new site owner gets a short **Getting started** checklist. Sites are created from
**requirement starter packs**: a contractor baseline plus electrical, heights & lifting, hot work &
confined space, and civil & plant add-ons, defined in `src/lib/templates.ts`. Every item stays
editable per site.

Product gaps from the last audit, also built:

- **Safety Centre**: open incidents and permits across every site (More → Safety Centre).
- **Per-worker records**: medical fitness, inductions, competency and training certificates per person,
  with expiry reminders. The host sees the workers a contractor assigns to its site. Only the last 4
  characters of ID numbers are stored.
- **Legal appointments register**: e.g. OHS Act s16(1)/(2), Construction Regulations 8(1)/(7), MHSA
  appointments, with signed letters.
- **Toolbox talk attendance**: each attendee signs on the device. AI can draft the talk.
- **Dashboard customisation**: each user chooses and orders their dashboard sections.

## Quick start (local)

Requirements: Node 20+ and Postgres 14+. Docker is optional.

```bash
cp .env.example .env
docker compose up -d postgres mailpit   # or use your own Postgres
npm install
npm run dev                             # http://localhost:3000, runs migrations on start
```

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
| `npm run worker:prod` | Email + reminder jobs as a separate process (optional; `RUN_JOBS_IN_WEB=false`) |

## Layout

```
src/
  app.ts, server.ts        Fastify app (security headers, CSRF, sessions) and entry point
  config.ts                Environment (validated)
  db/                      Pool, migration runner, SQL migrations
  lib/                     authz (permission model), sessions, security, plans, storage,
                           email outbox, AI proxy, realtime, readiness rules, audit
  routes/                  auth, org/team, bootstrap (per-user view), sites, documents,
                           safety (incidents/permits/diary/inspections), requests, files,
                           workforce, share links, billing, ai, events (SSE), demo
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
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): recommended hosting, Stripe/email/storage setup, and a
  go-live checklist.
