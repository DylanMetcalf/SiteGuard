# COMVERA launch audit and readiness report

Date: 28 October 2026. Branch `claude/siteguard-multitenant-saas-04lxw0`. Live service: https://comvera.onrender.com
(Render, Postgres, 5 GB disk). Domain bought: comvera.co.za (DNS not yet pointed at Render).

**In one sentence:** COMVERA works end to end and is safe to put real customers on. Three things stand between it
and taking money: the domain, a business email for sending, and a Paystack account.

---

## 1. What COMVERA is, technically

- **One server, one database.** Node/TypeScript (Fastify) with Postgres. Database changes are numbered migrations that run
  automatically on start (latest: 022). Files go to private storage. The browser app has no build step and a strict
  content-security policy.
- **Tenancy.** Every organisation (a mine/site owner, or a contractor company) is a separate tenant. Every
  site-scoped read and write goes through one check (`loadSite`), and anything outside your organisation returns
  "not found". The automated tests check this for every feature (32 test files, 213 tests, all passing on this branch).
- **Audit trail.** An append-only history of every change, per organisation.
- **Deployed on Render.** Auto-deploys from `main`. Health check and a synthetic smoke test every 30 minutes (GitHub Actions).

## 2. Features: what works, what's partial, what's missing

| Area | Status |
|---|---|
| Sign-up, sign-in, email confirmation, password reset, team invites, roles | **Works** |
| Mine sites (workplaces) with site codes, requirement lists, review queue, Site Ready | **Works** |
| Contractor workspace: company document library reused across sites, projects for own clients, history | **Works** |
| Document review: approve / correction required, version history (old versions never rewritten) | **Works** |
| Document Studio (professional safety documents, AI or template fallback) | **Works** (AI needs `ANTHROPIC_API_KEY`) |
| Gate clearance, QR cards, audits, suspension, validity rules, permits, incidents | **Works** |
| COMVERA Exchange (request/share documents with people without an account) | **Works** |
| **Site templates** (mine's own forms per requirement; download, complete, upload) | **New on this branch: works** |
| **Plans as the owner described** (1 site per site subscription; contractor 5/10/20 connected sites) | **New: works** |
| **Paystack payments** (subscriptions, once-off safety file, webhooks, history) | **New: works in tests**. Needs a Paystack account to go live |
| Stripe payments | Works, but Stripe does not onboard South African companies directly, so it stays off |
| Email sending | Works when `SMTP_URL` is set. **Not yet set on the live service.** Emails go to the log until it is |
| Interactive walkthrough (`/walkthrough`) and demo sandbox | **Works** |
| Internal areas within one site (departments/shafts) | **Missing** (parked: one workplace = one site) |
| Automatic filling of templates from field mappings | **Missing** (parked deliberately: contractors complete templates themselves) |
| PayFast | **Missing** (parked: Paystack covers cards and EFT) |

### Document statuses (consistent everywhere)
Missing → Attached (not submitted) → Awaiting review → **Approved** or **Correction required** → (Expired when past its
expiry date). Optional requirements count toward readiness only once filed. **Nothing is ever approved automatically.**
A person at the site approves every document.

## 3. Security and data-integrity review

Checked on this branch (code reading plus the tests named):

| Check | Result |
|---|---|
| Tenant isolation on new code (templates, payments) | 404 across tenants; tested (`templates.test.ts`, `paystack.test.ts`) |
| Payment trust | A payment counts only after a **signed** webhook (HMAC-SHA512, constant-time compare) **and** re-fetching the transaction from Paystack with a matching amount, currency and reference. The browser coming back proves nothing. Tested, including a wrong amount and a bad signature |
| Duplicate webhooks | Processed once (body hash table); failures are forgotten so Paystack retries |
| Card data | Never touches COMVERA (Paystack's hosted page) |
| Billing failures | Never delete data: grace (past due), then read-only. Cancelling keeps paid time |
| Secrets | Only in environment variables; never sent to the browser; none in code |
| Admin access | No master password, no hidden admin URL, no bypass. Platform admin = emails in `PLATFORM_ADMIN_EMAILS`. Recovery: `docs/ACCOUNT_RECOVERY.md` |
| Uploads | Type checked by content (magic bytes), stored privately, served with a sandboxing policy |
| CSRF | Tokens on every write; only the two payment webhooks are exempt (they are signed instead) |

**Risks still open** (none blocks a careful launch):
- **HIGH: email not configured live.** Password resets, invites and exchange codes won't reach people. Fix: set
  `SMTP_URL` and `EMAIL_FROM` (see next steps).
- **MEDIUM: POPIA paperwork.** The app is built privacy-first (tenant isolation, audit trail, no personal data in
  statistics, data export). The legal side is not done: an Information Officer registration with the Information
  Regulator, operator agreements with Render, Paystack and the email provider, and a lawyer's review of `/privacy` and
  `/terms`, which are drafts. **COMVERA must not claim POPIA compliance or "compliant safety files" until then.**
- **MEDIUM: backups.** Render's Postgres has daily backups on paid plans. Do one manual restore test before taking money
  (`docs/OPERATIONS.md`).
- **LOW: a Paystack plan change is "new subscription, then stop the old one".** The customer pays the new plan in full
  that day with no proration. This is acceptable at launch; say it on the billing page (it does).

## 4. Billing and auth status

- **Auth:** complete (scrypt hashes, httpOnly cookies, CSRF, lockout, rate limits, verified email for sensitive actions).
- **Billing model now in the code:**
  - **A. Site subscription:** one site each. Site Starter R2,499/month; Site Professional R5,999/month (adds AI and share
    links). More sites: one subscription each, or Enterprise (custom).
  - **B. Contractor tiers:** Starter R399 (5 connected sites), Pro R899 (10), Business R1,699 (20, *new, proposal*).
    Sites that sponsor the contractor don't count.
  - **C. Invited guest:** free. A contractor invited by a paying site completes that site's file at no cost, and a
    COMVERA Exchange recipient never needs an account.
  - **D. Once-off safety file:** R1,299 (*proposal*, inside the R1,200–R1,500 range you gave). One site or project,
    paid once, workspace open 60 days (`ONCE_OFF_DAYS`), readable afterwards. No subscription.
  - **Trial:** 14 days, no card.
- All prices are editable in More → Platform → Pricing page and are **not hard-coded**. *Owner approval needed* for the
  Business and once-off prices before they are shown publicly. Hide either with the "visible" switch until decided.

## 5. Research (sources; facts kept separate from guesses)

**Verified from the source:**
- Stripe's global availability page lists South Africa under "Extended network", reached through Paystack, not as a
  country where a local company can open a Stripe account. → Use Paystack. (stripe.com/global)
- Paystack (official docs, paystack.com/docs): plans (`POST /plan`, amounts in cents); subscriptions via
  `/transaction/initialize` with a plan; events `charge.success`, `subscription.create`, `invoice.payment_failed`,
  `invoice.update`, `subscription.not_renew`, `subscription.disable`; webhook signature = HMAC-SHA512 of the body with
  the secret key; transaction verification endpoint; card-update "manage" link; **failed subscription charges are not
  retried automatically** (hence the grace state and the "Update card" button). Paystack has a Cape Town office.
  Check current fees on paystack.com/za/pricing before setting prices; I have not quoted them here.

**Secondary sources (competitor websites; treat as indicative):** contractor-compliance tools seen in or selling into
South Africa include Decision Inc (hiDocs / Contractor Management on SharePoint), HSEC Online, ContractorManage,
SafetyLoop, SiteDocs and ISN. Most are sold to the mine or principal contractor on quote. Few publish prices, and few
give the contractor a reusable workspace of its own. That gap is where COMVERA sits.

**Hypotheses (not verified, test in the pilot):**
- Contractors will pay roughly the cost of one professionally prepared safety file per month for a reusable workspace.
- Mines will pay per site if their contractors arrive with ready files, so sponsorship is the sales hook.
- Mine-specific templates are the feature mines ask about first (from your industry contacts, not measured).

## 6. Launch blockers (in order)

1. **CRITICAL:** point **comvera.co.za** at Render and set `APP_URL=https://comvera.co.za` (links in emails depend on it).
2. **CRITICAL:** set **`SMTP_URL` and `EMAIL_FROM`** from the business mailbox, and send yourself a password reset to prove it.
3. **HIGH (to take money):** open a **Paystack** account, add `PAYSTACK_SECRET_KEY` (test key first) and the webhook URL,
   and do one test purchase and cancel (steps in `docs/LAUNCH_GUIDE.md`).
4. **HIGH:** approve or change the proposed prices (Business, once-off) in More → Platform → Pricing page.
5. **MEDIUM:** have a lawyer read `/privacy` and `/terms`; register an Information Officer.

## 7. Prioritised plan

| Priority | Item | Who |
|---|---|---|
| CRITICAL | Domain to Render, `APP_URL` | You (Render + domain DNS) |
| CRITICAL | Business email + `SMTP_URL`/`EMAIL_FROM` | You |
| HIGH | Paystack account, test key, webhook, test purchase | You, then a check together |
| HIGH | Confirm prices | You |
| HIGH | Merge this branch (Render redeploys on its own) | You (approve the pull request) |
| MEDIUM | Backup restore test | You, using `docs/OPERATIONS.md` |
| MEDIUM | Legal review of privacy/terms; Information Officer | Lawyer |
| LOW | Remove the old free `siteguard-demo` service on Render | You |
| LATER | PayFast, internal site areas, template pre-filling, proration on plan changes | Build when a customer asks |

## 8. Keep as it is / deliberately not built yet

**Keep:** tenant isolation via `loadSite`, the append-only audit trail, people approve documents (never automatic),
sponsorship (a mine's invitation never costs the contractor), the Exchange portal rules, the Stripe code (other markets).

**Not built yet, on purpose** (`docs/PARKING_LOT.md`): PayFast, internal areas within a site, automatic template
filling, bulk actions across many sites, proration on Paystack plan changes.

## 9. Launch readiness

| | Ready? |
|---|---|
| Product works end to end (tests, plus a browser check of templates and billing) | **Yes** |
| Safe for real customer data | **Yes**, with the POPIA paperwork to follow |
| Can people sign up and receive emails on the live site | **Not yet** (email setting) |
| Can you take payments | **Not yet** (Paystack account) |
| Is anything claimed that isn't true | No. The walkthrough and pricing describe real features; nothing promises a compliant file |

**Verdict:** ready for a **free pilot** as soon as the domain and email are set (tonight is realistic). Ready to
**charge** once Paystack approves the account and one test payment has gone through.

*What was actually verified for this report:* `npm run typecheck`, `node --check` on every browser script, and the full
`npm test` suite (213 passing, 0 failing) on this branch. A headless-browser run against a local server confirmed the
template upload/download screen and the Paystack billing screen render without errors. The live site was **not**
changed or re-tested for this report. Its earlier health was confirmed through Render's logs.
