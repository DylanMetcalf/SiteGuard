# SiteGuard 2.0: audit and implementation plan

This responds to the owner's 96-point "SiteGuard 2.0" brief (30 Sep 2026). The brief asks for an
audit of what exists before anything is built. This page is that audit, and the plan built from it.
It complements `SPEC_COVERAGE.md` (the earlier 117-point spec) and `PARKING_LOT.md` (what we
deliberately haven't built).

## 1. Current architecture (as audited)

| Layer | What it is |
|---|---|
| Server | Node 22, TypeScript, Fastify. One process serves the API, the web app and the background jobs. |
| Database | Postgres 16 with raw SQL and numbered migrations (001–013), run on start under an advisory lock. The audit trail is append-only at database level. |
| Tenancy | Organisations (mine or contractor) are the tenant. A site belongs to a mine, and a contractor company is linked to it. Every site route goes through `loadSite()`, and anything outside the tenant returns 404. Contractor projects use a private client record (`managed_by_org`), so the same rules apply. |
| Auth | Built in. scrypt hashes, httpOnly session cookies, CSRF tokens, email confirmation, lockout, rate limits, and multi-organisation membership. |
| Files | S3-compatible private storage, magic-byte type checks and short-lived signed downloads. |
| Documents | pdfmake and docx (Document Studio: 14 blueprints). pdf-lib builds the bound safety file: cover, contents, registers, page numbers, stamped footers and revisions. |
| AI | Claude, server-side only and plan-gated. Every feature falls back to templates or rules without a key. The assistant is read-only. |
| Billing | Stripe Checkout, the customer portal and webhooks. Hosts get a 14-day trial; a lapsed account is read-only and never deleted. |
| Web app | Vanilla ES modules with no build step. CSP `script-src 'self'`. Navy and sage design system, with light and dark themes. |
| Deploy | Docker image, Render blueprint (`render.yaml`), uptime workflow and smoke check. CI runs typecheck, syntax checks, 128 integration tests and the build. |

## 2. The brief against what exists

**Key:** ✅ works today · 🟡 partly · ❌ missing · 🆕 built in this round

| Brief | State before this round | This round |
|---|---|---|
| 4–5, 8 Safety File Builder, site-specific files, guided creation | ✅ Every site has its own file. There is a six-step guide per file (company documents, people, documents SiteGuard writes, certificates, extras, check and download). *Build my safety file* writes every missing document. | Keep. Make "Build safety file" more obvious (dashboard and file page). |
| 6 Individual documents, required vs optional | 🟡 Documents can be picked individually from starter lists, but every requirement is mandatory. | 🆕 Optional requirements. Missing optional items don't block readiness or Site Ready. |
| 7 Document states | 🟡 Missing, awaiting review, complete, expiring, expired and correction required. There is no *optional* or *not applicable*. | 🆕 Optional. Not applicable is handled by making an item optional or removing it (a site decision). |
| 9 Studio returns to the file | ✅ "Create it in Document Studio" → attach → submit, in one flow. | — |
| 10 Controlled AI generation | ✅ Drafts are marked AI-drafted, versioned, and go to human review. | — |
| 11, 62 Jurisdiction-aware knowledge | 🟡 Requirement packs are structured data with a *source* per item (legal, client, site, best practice…). They are all South African, and jurisdiction is implicit. | 🆕 Packs carry jurisdiction, references and review status, and the UI says "confirm with your SHE advisor". |
| 12 Site requirement builder | ✅ Add, remove, request, approve and reject; validity rules. | 🆕 Mandatory/optional. |
| 13 Invite by email | ✅ Email invitations and site codes. | — |
| 14 Contractor workspace | ✅ Library, sites, projects, workforce and Studio, with no fixed site. | — |
| 15–16 Library and file versions | ✅ Library reused across sites; safety file revisions record what changed. | — |
| 17–18 Professional PDF; choose documents | ✅ Professional PDF. ❌ You can't choose what goes in. | 🆕 Tick the documents to include before building. |
| 19 Site downloads | ✅ View, download or print individual documents; selected-document packs; the whole file. | — |
| 20 Document update requests | ✅ To one contractor or every contractor on a site. | — |
| 21–22 Expiry reminders | 🟡 Fixed at 30 days, 7 days and expiry, sent once each, with opt-in digests. | 🆕 Each organisation sets its own reminder days (for example 60/30/14/7/1). |
| 23 Induction management | 🟡 Inductions are worker certificates, and the mine can set an induction validity rule. | 🆕 Induction *sessions* the site runs: attendance and signatures on one device. Attending one at a site clears the induction for that site's gate. |
| 24–26 Toolbox talks, attendance, training | ✅ Toolbox talks with signatures on one device, printed in the file. | 🆕 One register for toolbox talks, inductions, awareness training, briefings, safety meetings and training. |
| 27–30 Tools, risk assessments, method statements | 🟡 Ten work activities drive hazards, controls, PPE and permits. | 🆕 A tool and equipment picker (grinders, drills, welding, ladders, scaffolds, generators, compressors, cranes, vehicles…), each adding its own hazards and controls. |
| 31 Compliance access card | ✅ Worker QR gate cards and a public gate page with no personal details; Site Ready verification codes. | — |
| 32 Letter of Good Standing | ✅ A company document with expiry, a validity rule, reminders and gate/readiness effects. | — |
| 33–34 Compliance dashboard; "why?" | ✅ Readiness with "Why 78%?", the agent's findings and gate reasons. | — |
| 35, 67–68 POPIA, legal pages, footer | 🟡 Privacy by design (last 4 ID digits, tenant isolation, append-only audit, scoped links), but no privacy/terms pages and no data export. | 🆕 Privacy and terms pages describing what SiteGuard actually does, marked for legal review; footer links; an organisation data export. |
| 36 Security | ✅ Tested tenant isolation, CSRF, rate limits, magic-byte uploads and a CSP. Two independent reviews per round. | Review again. |
| 37–38 Multi-tenant, roles | ✅ Owner, admin, reviewer and staff roles on each side, with multi-organisation users. | — |
| 39–43 Self-service billing, entitlements | 🟡 Stripe works, but plan checks are scattered through the code. | 🆕 One central list of what each plan includes. |
| 44–46 Onboarding, walkthrough, demo | ✅ Landing page, sign-up by type, getting-started card, walkthrough with auto-play, sample demo and clean demo. | Walkthrough covers the new pieces. |
| 47 Mobile / PWA | 🟡 Phone-first layouts and an install manifest. There is no offline shell. | 🆕 A service worker: installable, with an offline page. |
| 48 UI | ✅ Keep the identity. | 🆕 Slightly wider desktop layout. |
| 52–53 Search, assistant | ✅ Search on every list; a read-only assistant over the user's own data. | — |
| 54–56 Suggestions, evolution, regulatory updates | 🟡 In-app feedback is emailed to support. The evolution loop is a reviewed-PR process (`SPEC_COVERAGE.md`). | Automated regulatory monitoring stays parked: changes need a person's review. |
| 57–59, 64–65 Backups, observability, admin, analytics | 🟡 Render backups, logs, client error reports and an uptime check. There is no admin area. | 🆕 A platform admin control centre (usage, trials, conversions, feedback, health). 🆕 `OPERATIONS.md` (backups, RPO/RTO, recovery). |

## 3. What we are deliberately not building now (and why)

- **Automatic regulatory monitoring or rewriting.** Legal content must be changed by a person; see brief 56 and the AI safety rule 92.
- **A configurable role builder.** The fixed roles cover every workflow today; custom roles add risk without a customer asking.
- **Multi-currency and international regulations.** The data now carries jurisdiction, so these can be added as packs and prices later without rebuilding.
- **Native apps.** The PWA covers install and offline needs first.
- **Usage-based billing and one-off file purchases.** The entitlement layer makes them possible later; Stripe prices decide.

## 4. Phases for this round

1. Optional requirements (data, readiness, Site Ready, UI).
2. Choosing documents before building the PDF.
3. Configurable reminder schedule.
4. Session types, with site induction sessions counting at the gate.
5. The tool and equipment picker in risk assessments and method statements.
6. Central entitlements; privacy and terms pages; footer; organisation data export.
7. Platform admin control centre.
8. Jurisdiction metadata, PWA shell, desktop width.
9. Tests, browser run-through, independent security review, fixes, docs.

Each phase adds tests (including tenant isolation for new data access), keeps existing behaviour
and ships as its own commit.
