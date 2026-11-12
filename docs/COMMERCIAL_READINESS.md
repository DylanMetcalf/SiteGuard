# Commercial readiness: baseline, what changed, what is left (2026-11-12)

Plain language. Everything marked "verified" was run in this repository against a local copy with made-up data. Nothing here has been tested on the live site, with real email, with a real card, or with a real customer.

## 1. Baseline audit
| Area | Status | Evidence |
|---|---|---|
| Features and navigation | Working | 15-test contractor journey, design audit at four screen sizes: no layout or script errors |
| Sign-in, sessions, two-step | Working | Session, logout, lock-out, two-step guessing probes; 51 security probes |
| Organisation and site access control | Working | 2,224 cross-organisation requests with real leaked ids on 254 routes: no leaks; read-only staff cannot write |
| Tenancy, files, downloads | Working (local storage) | Private downloads, safe-upload checks, hostile-file probes. Hosted storage **unverified** |
| Site and project creation | Working | Journey tests, unit tests |
| Document centre, folders, portfolios | Working | Uploads (including 300 documents), visibility rules, folders |
| Request, submit, review, correct, approve | Working | Journey T05/T11, review tests, Today card test |
| Expiry tracking and reminders | Working in code and tests | Reminder tests. **Email delivery unverified** (no real provider) |
| Notifications and invitations | Working in tests | Bulk invite, caps, tokens. **Real email unverified** |
| Billing and subscriptions | Built, not activated | Plan, entitlement and promo tests. **No live payment tested**; keys not set |
| Existing browser tests | Passing | Journey, landing, Today, consultant, and the two-browser flow below |
| Onboarding and help | Working, partial | Guided set-up (about 4 seconds in tests), walkthrough, Oscar, Report a problem. No standalone help centre |
| Production deployment | **Unverified** | Not touched; deploy and smoke check still to do |

## 2. What was improved in this pass
- **Consultant plans**: Solo (5 clients, R1,299), Practice (15, R2,499), Firm (40, R4,999). Each client is its own organisation, covered live by the consultant's plan. Free trial allows 5 clients. Rules: locked unique registration number, slots freed only by archiving, used clients archivable only after 90 quiet days, no cycling, no clones of independent companies, staff lose client access when they leave or lose admin rights, client seats are not used by consultant staff, a covered client cannot buy its own plan.
- **Pricing page**: one toggle, three plans per audience, "Most popular" marked, price per client for consultants.
- **First-time experience**: consultants see "Add my first client company" (not a contractor's safety-file prompt); Today card first; the safety contact is pre-filled; "Join a site" on the Sites tab.
- **Recurring value**: Today card (do today, this week, this month, urgent first), per-mine counts for contractors, weekly summary and expiry reminders (already built), monthly activity CSV.
- **Oscar without an AI key** answers "what do I still need to submit?" from the person's own sites.
- **Analytics**: milestone events (site created, document requested, review and approval completed, client added, subscription cancelled) and `npm run activation` for the funnel and median time from sign-up.
- **Exchange**: invited contractors can already submit without paying (free sponsored participation; the Exchange portal creates no accounts). Covered by the existing Exchange tests; not changed.

## 3. Test results (this pass)
Last full run, in order, all on a fresh local database:

| Suite | Result |
|---|---|
| Typecheck and `node --check` on every browser file | Pass |
| `npm test` (backend, tenancy, billing, consultants, hygiene, assistant, Oscar) | **340 pass, 0 fail, 0 skipped** |
| `test:journey` (15 contractor-first browser tests) | 44/44 |
| `test:landing` (homepage copy and 10 browser checks) | 18/18 |
| `test:today` (Today card) | 9/9 |
| `test:consultant` (pricing toggle and consultant journey) | 21/21 |
| `test:bots` (19 bots) | 105/105, 0 server errors |
| `test:bots:security` (every route, headers, sessions, chaos, integrity) | 51/51, 0 server errors |
| `test:bots:shared-address` (a shift behind one router) | 30/30 invited sign-ups, 30/30 sign-ins |
| `test:bots:ux` (four screen sizes, accessibility audit) | No layout or script problems. Two notes remain, both false alarms: decorative walkthrough cards, and Oscar example buttons that sit scrolled out of view |
| `test:e2e` (older two-browser script) | **Stale**: fails at the first screen after sign-up because guided set-up is now mandatory. Not in CI. Superseded by `test:journey`. Marked in the file |

**Not covered by any test:** the Stripe/Paystack checkout of the three consultant plans (payments are switched off; the guards that decide who may choose a plan are unit-tested), real email delivery, the real virus scanner, hosted storage, Oscar with a real AI key, and a covered client trying to start its own checkout (the guard is in code and was reviewed, but needs Stripe configured to test).

## 4. Remaining risks (be honest with yourself about these)
**Security and data**
- Medium: alert counters and rate-limit counters live in memory per server instance. With more than one instance they are per instance.
- Medium: production backups and a hosted restore are untested (the drill passes locally).
- Low: company registration numbers are not verified against CIPC (they are public). A determined person could register a number they do not own; the consultant limit still applies.
- Low: a consultant's client list does one readiness calculation per site; fine for a normal portfolio, slow for a very large one.
- Low: sole proprietors without a 12-digit company number cannot be added as consultant clients yet.
**Functionality**
- Oscar was tested without an AI key only.
- No standalone help centre; help is the walkthrough, Oscar and Report a problem.
- Per-contractor fees for mines, WhatsApp reminders and offline pages are not built.
**Commercial**
- No customer has used it. Pricing is a hypothesis.
- Privacy notice and terms are drafts awaiting a lawyer.
- No support process yet; email deliverability and the "unsolicited marketing" rules need checking before any bulk email.

## 5. Gaps before charging
1. Deploy and run the smoke check on the live site.
2. Staging run with real email and the real virus scanner (`docs/STAGING.md`).
3. Lawyer sign-off on privacy and terms (`docs/LEGAL_REVIEW_BRIEF.md`).
4. One supervised pilot (`docs/PILOT_PLAN.md`) and one first-user test (`docs/FIRST_USER_TEST.md`).
5. Switch on payments only after you approve: add the Stripe or Paystack keys and the three consultant price ids (`STRIPE_PRICE_CONSULTANT_SOLO`, `_PRACTICE`, `_FIRM`), then test one real card.

## 6. Recommendation
**CONDITIONAL GO for a controlled external trial** (your mom, Spanjaard, a few consultants): free trial, made-up or low-risk documents first, you watching. **NO-GO for bulk marketing** until items 1 to 4 above are done.
