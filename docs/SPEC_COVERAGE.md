# Spec coverage: the Master Evolution Specification against SiteGuard

The owner's *Master Evolution, Compliance & Product Upgrade Specification* (117 points, 30 Sep 2026)
asks for an audit of what exists before anything is built, and for SiteGuard to be extended, not
rebuilt. This page is that map. It says, point by point, what SiteGuard already does, what update 2
added, and what is deliberately parked (with the reason in `PARKING_LOT.md`).

**Key:** ✅ in place before update 2 · 🆕 added in update 2 · 🟡 partly in place · ⏸ parked

## The core product (spec 1–16)

| Spec | Status | Where it lives / what it does |
|---|---|---|
| 1 Central idea: document intelligence, not storage | ✅ | Every requirement has a live status (missing, awaiting review, complete, expiring, expired, correction required); the compliance agent answers "what needs attention". |
| 2 Full system audit first | ✅ | This page, plus `ARCHITECTURE.md`. Two independent audits (update 1 and update 2) with fixes. |
| 3 Preserve what works | ✅ | Update 2 adds screens and tabs; no existing flow was replaced. The one behaviour change (the safety file's name now carries its revision) is covered by an updated test. |
| 4 Layered architecture | ✅ | Contractor library (layer 1), sites and requirements (2), bound safety file (3), Document Studio (4), readiness and agent (5), permits, incidents, toolbox talks and 🆕 audits and gate clearance (6), feedback loop (7, see below). |
| 5 Contractor master profile | ✅ | The contractor organisation owns its details, logo, colours and document numbering. Once linked, a mine can't edit them. |
| 6 Master document library | ✅ | *Documents* (company documents) with type, expiry, version, status, uploaded by; reused on any site with one tap (`use-library`). |
| 7 Requirement tick-lists (required, optional, conditional) | 🟡 | Requirement packs are shown as individual documents with tick-boxes, and each is labelled by source. There is no "optional" or "conditional" flag yet: a requirement on a site is required. |
| 8 Site-specific requirement sets | ✅ | Each site has its own list; the contractor's library copy is referenced, not duplicated. |
| 9 Invite by email | ✅ | One-off email invitation plus site codes; an existing account is linked, not duplicated. |
| 10 Contractor ↔ site relationship as its own entity | ✅ | One file (`sites` row) per contractor per site, with its own requirements, approvals, workers, permits, history and safety file. |
| 11–13 Safety File Builder, design, merge | ✅ | Builder writes the missing documents; the bound PDF has a branded cover, contents with page numbers, section structure, footers, and missing items listed so gaps stay visible. |
| 14 Safety file versioning | 🆕 | Revisions (Rev 1, Rev 2…) recorded when the contents change: who, when, and every document's version, expiry and status. |
| 15 Guided onboarding with upload now / skip | ✅ | The six-step safety file guide; skipping never marks anything complete. |
| 16 Create a missing document | ✅ | "Create it in Document Studio" → attach → submit, in one flow. |

## Keeping files current (spec 17–27)

| Spec | Status | Notes |
|---|---|---|
| 17 Site-wide document update requests | 🆕 | *Request from contractors* on the mine's site page: one request to all or selected contractors, linked to the matching requirement, with a due date. |
| 18 Expiry management | ✅ | Expiring (30 days) and expired statuses everywhere; 🆕 mine-set **validity rules** make expiry a site rule rather than whatever date is typed. |
| 19 Configurable reminder stages | 🟡 | Reminders at 30 days, 7 days and expiry, once each (no spam). Per-organisation timing is parked. |
| 20–21 Compliance dashboard and contractor status | ✅ | Counts with the evidence behind them ("Why 78%?"); Site Ready only when every requirement is approved and nothing serious is open. |
| 22–23 Compliance card with QR, verification page | 🆕 / ✅ | 🆕 per-worker **QR gate cards** and a public gate page; ✅ Site Ready verification page per company. Both say they show status held in SiteGuard, not proof of legal compliance. A company-branded card is parked. |
| 24 Induction management | ✅ / 🆕 | Inductions are worker certificates with issue and expiry dates; 🆕 the mine's rule ("valid 12 months from the induction") drives gate clearance. |
| 25 Shared-device (iPad) field mode | 🟡 | Toolbox talks already pass one device round for signatures. A locked big-button kiosk mode is parked. |
| 26–27 Attendance registers and toolbox talks | ✅ | Topic, date, presenter, attendees, signatures, printed in the safety file's registers. |

## Documents that think (spec 28–37)

| Spec | Status | Notes |
|---|---|---|
| 28–30 Tool/activity library for risk assessments and method statements | 🆕 | Tick-box work activities (10 profiles, each with hazards, controls, PPE, permits) in the risk assessment and method statement. The library is in `lib/knowledge.ts`; customer-editable libraries are parked. |
| 29 AI drafts need human review | ✅ | Studio drafts go to the site for review; the Walkthrough and docs say drafts are for a competent person to check and sign. |
| 31–32 Download, print, site access | ✅ | Individual downloads, merged PDFs, document packs, printable registers; the site sees only what was submitted to it. |
| 33 POPIA | ✅ | Last 4 ID digits only, append-only audit trail, scoped share links, 🆕 the gate page shows no ID numbers or certificates. |
| 34 Requirements knowledge base (legal vs site vs best practice) | ✅ | Each requirement carries its source (legal, client, site, project, company, best practice, platform) shown as a label. |
| 35 Compliance intelligence agent | ✅ / 🆕 | Rule-based agent every 15 minutes; 🆕 overdue audits, overdue findings, suspensions and "safety file changed since Rev n". It never invents requirements. |
| 36–37 Document reading and smart matching | 🟡 | Expiry-date detection with an AI key; requirement names are matched to library types and Studio blueprints. Wider extraction is parked (risk of wrong compliance data). |

## Platform, business and operations (spec 38–57)

| Spec | Status | Notes |
|---|---|---|
| 38 Multi-tenant SaaS, roles | ✅ | Mines and contractors are separate tenants; owner, admin, reviewer and staff roles; every route enforces them. |
| 39 Either side can subscribe | ✅ | Plans in `lib/plans.ts`, Stripe billing; workflows don't hard-code prices. |
| 40 One master profile, many site files | ✅ | Exactly how files work. |
| 41–42 Standalone contractor mode (own projects) | 🆕 (update 3) | *My projects*: a contractor builds a safety file for any client that isn't on SiteGuard. It uses a starter list, a copy of another file's list or its own items, files documents from its library or Document Studio, and sends a PDF or a secure link. The client needs no account. |
| 43–46 Export engine, index, numbering, completeness | ✅ / 🆕 | Contents generated from the file; Studio numbering uses the company's own prefix; the cover states approved / awaiting / outstanding counts. 🆕 A *safety file check* before every download shows required, in the file, missing and expired items, with names, and says the PDF lists every gap. |
| 47, 87, 89 Change impact and rebuild | 🆕 | "Revisions and what changed" on every file, and a to-do item when a file has changed since its last revision. |
| 48 "What needs my attention?" | ✅ | Dashboard, To-do list and agent findings. |
| 49 Notification centre | ✅ | In-app inbox plus email; SMS/WhatsApp are parked. |
| 75 Compliance timeline | 🆕 (update 3) | *Timeline* on each file's Site activity: the dated history from both companies. |
| 50 Audit trail | ✅ | Append-only, filterable and exportable; 🆕 audits, findings, suspensions, validity rules and new safety file revisions are recorded. |
| 51 Search | ✅ | A search box on every list, plus 🆕 the gate list. |
| 52–55 Dashboards, mobile-first, visual design, field use | ✅ | Phone-first layout; 🆕 44-pixel Yes/No/N/A buttons on the audit checklist for gloved hands. |
| 56–57 Useful, constrained AI | ✅ | Server-side only, works without a key, and the assistant is read-only (you confirm every action). |

## The evolution loop (spec 58–98)

SiteGuard doesn't change itself. The spec asks for a controlled loop, and this is how it runs today:

1. **Observe.** In-app *Report a problem or suggest an idea* (stored in `feedback`), client error
   reports (`/api/client-errors`), and the compliance agent's findings across tenants.
2. **Identify and propose.** Ideas go into `PARKING_LOT.md` with *why not now* and *revisit
   when*. That is the evolution backlog.
3. **Prioritise, implement and test.** Each change is a pull request with tests (`npm test`, e2e
   and a browser run-through), then an independent read-only audit whose findings are fixed
   before merging.
4. **Approve and deploy.** The owner merges; Render deploys; migrations run under a lock.
   Rollback is a revert of the pull request (migrations only add, never drop).
5. **Learn.** `DECISIONS.md` records why, so nothing is re-litigated without new evidence.

⏸ An automated research agent that proposes changes (for example to legal content) as reviewed
pull requests is parked until there is usage data to prioritise from.

## Final audits (spec 99–117)

Journeys B (site invites contractor), C (one contractor, many sites), D (expiry → renewal →
affected files), E (new requirement → request → upload → review) and G (toolbox talk) run end to
end today. Journey A (a new contractor's own project) runs end to end since update 3, and Journey F (field induction on a shared
device) is partly covered: inductions are recorded as certificates, and signatures happen through
toolbox talks. See *What was verified, and how* in `ARCHITECTURE.md` for the tests behind each one.
