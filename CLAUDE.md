# SiteGuard — notes for Claude sessions

Multi-tenant contractor compliance and site-safety SaaS for South African mines. Read
`README.md`, `docs/ARCHITECTURE.md` (tenancy, permission matrix, security) and
`docs/DECISIONS.md` before changing behaviour. `docs/PARKING_LOT.md` lists what we deliberately
haven't built.

## Commands

- `npm run dev` — server with reload on :3000 (needs Postgres; `docker compose up -d postgres mailpit`)
- `npm test` — integration tests against real Postgres (`siteguard_test`, schema is dropped and recreated)
- `npm run typecheck`, `for f in public/js/*.js; do node --check "$f"; done` — what CI runs besides tests and build
- `npm run test:e2e` — two-browser Playwright flow against a running server (`BASE_URL`, `PLAYWRIGHT_CHROMIUM_PATH`)
- `SITEGUARD_URL=… npm run smoke` — synthetic check of a deployed app

## Rules that matter here

- Every site-scoped route goes through `loadSite()` (`src/lib/authz.ts`); anything outside the caller's
  tenant returns 404. Add a tenant-isolation test for any new data access.
- Writes: server-side role checks (`requireHostAdmin`, `requireReviewer`, `requireWritable`), then
  `audit(...)` and `publishChange(...)` inside the same transaction (`withTx`).
- Schema changes are new numbered files in `src/db/migrations/` (never edit an applied one); they run
  on start under an advisory lock.
- Frontend is vanilla ES modules, no build step, CSP `script-src 'self'`: no inline handlers — use
  `data-action` + `on(name, fn)`. Bootstrap data is HTML-escaped on arrival (`deepEscape`); escape
  anything else from the server with `escapeHtml` before inserting it.
- Secrets only via environment variables (`src/config.ts`); never in code or sent to the browser. AI
  calls stay server-side (`src/lib/ai.ts`, `src/lib/assistant.ts`) and must work without a key
  (template/rules fallback).
- Document Studio: new document types go through the `add-document-blueprint` skill in
  `.claude/skills/`; every blueprint must render with empty answers (tested).
- Review workspace visibility lives in `resolveForUser` (`src/lib/review.ts`); section approvals are keyed by
  content hash. Notify the other side with `notifyOrg` (`src/lib/notify.ts`) inside the write's transaction.
- Gate clearance is computed live in `lib/gate.ts` (never stored); the public `/gate/:token` page shows no ID numbers
  or certificates. Suspension, audits and validity rules live in `routes/oversight.ts`; a mine's validity rules only
  ever shorten an expiry (`lib/validity.ts`). Safety file revisions are recorded only when the contents change.
- Contractor projects (`routes/projects.ts`) are ordinary files for a private client record (`organisations.managed_by_org`);
  `loadSite` sets `site.project`. Never add memberships to a client record; archive projects, never delete them.
- The Walkthrough (`public/js/tour.js`) only navigates: when a screen changes, check its step's `target` selector still exists.
- Who pays: `hasOwnAccess` (plan, trial or grant) vs site sponsorship (`lib/sponsorship.ts`). A contractor
  without own access may only change sponsored files; `loadSite` enforces it for writes. Never hard-code
  prices: the pricing page reads `plan_settings` (`lib/pricing.ts`); grants come from promo codes or the admin.
- Plan checks go through `lib/entitlements.ts` (`can` / `requireFeature`), never plan names in routes.
  Readiness counts an optional requirement only once filed (`countsTowardReadiness`, mirrored in `core.js`).
- The platform overview (`routes/admin.ts`) is read-only, counts only, 404 unless `isPlatformAdmin`.
  The service worker (`public/sw.js`) must never cache `/api`. `/privacy` and `/terms` are drafts:
  describe real behaviour, never invent legal commitments.
- The assistant is read-only: new abilities are tools that read the caller's own org or return cards
  the user confirms through existing endpoints.
- Keep changes small, preserve existing behaviour, update docs (README/ARCHITECTURE/LAUNCH_GUIDE) and
  the decisions log when behaviour or operations change. The owner is non-technical: explain outcomes
  in plain language.
