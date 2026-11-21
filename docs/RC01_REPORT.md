# COMVERA Release Candidate 01: audit, changes, tests and release decision (2026-11-21)

Plain language. **Verified** means it was run in this repository, against the real application code, on an isolated local server with made-up data. Nothing below was run against the live site, apart from read-only page checks. Nothing was tested with real email, real payments or real customers.

## 1. Executive summary
COMVERA was already functionally broad and well protected, with mandatory guided set-up. This round made four changes:
- Sign-up and set-up now form one experience: account, terms, about you, your company, then your first step.
- Every dashboard shows one data-driven next step.
- Public prices are hidden behind a reversible switch.
- A 30-scenario browser acceptance suite was added.

The live site responds (`/healthz` 200). **Until this release is deployed, the live `/pricing` page and `/api/pricing` still show draft prices.** That is the one P0 left open, and deploying closes it.

## 2. Baseline audit (before this round → now)
| Area | Status | Evidence |
|---|---|---|
| Account creation, sign-in, sessions, email confirmation | PASS | S1, S27; `bots2` 51/51 security probes; 372 backend tests |
| Initial onboarding | PARTIAL → **PASS** | Before: no personal step and no terms acceptance. Now: S1–S6 |
| Individual profile | PARTIAL → **PASS** | First and last name, job title, phone, purpose, product-news consent: S2, S21. Photo upload: **MISSING** (initials avatar), deferred |
| Organisation profile | PASS | S3 and set-up tests |
| Roles and permissions (server side) | PASS | S21, S25, S26; tenancy tests |
| Organisation and site creation | PASS | S3, S7 |
| Contractor invitations | PASS | S9, S10 |
| Document requirements | PASS | S8 |
| Document requests (replacement, signed copy, other) | PASS | S11; request journey 46/46 |
| Upload, review, comments, correction, approval | PASS | S12–S16 |
| Version history | PASS | S15 |
| Expiry management | PASS in app; email reminders **UNVERIFIED** | S17; reminder tests (no real mail server) |
| Notifications | PARTIAL | In-app works. Email delivery **UNVERIFIED** without SMTP |
| Dashboards | PARTIAL → **PASS** | One next step: S5, S8, S13, S20 |
| Document centre, folders, portfolios, Studio | PASS | Existing tests. AI drafting with a real key **UNVERIFIED** |
| PDF and exports | PASS | S18 |
| Audit trail | PASS | S16, audit tests |
| Knowledge base and help | PARTIAL | Walkthrough, Oscar (rules mode) and in-app "Report a problem". No help centre |
| Navigation, menus, forms, search | PASS | S19, S23, S24 |
| Plans, entitlements, trials, promo codes | PASS | Billing, promo, enforce and sponsorship tests; S29 |
| Payments | Built, **OFF** | No keys set. Live checkout never run |
| Mobile | PASS | S22 at 375, 768 and 1280 px; no sideways scroll |
| Accessibility | PARTIAL | No serious or critical axe findings on the dashboard, request form, portal or menu. No screen-reader session |
| Persistence and recovery | PASS | S6 (refresh, sign out and in), S23 (failed send, then retry), S30 |
| Browser coverage | Chromium PASS; Firefox and WebKit **UNVERIFIED** | Only Chromium is installed here |
| Integrations (SMTP, virus scanner, hosted storage, AI) | **UNVERIFIED** here | Need the production environment variables |

## 3. Changes in this round
- **One sign-up and set-up flow:**
  - Sign-up asks for first and last name, email, password and **required acceptance of the terms and privacy notice**. The server enforces this and records the date and version.
  - Set-up starts with **About you**: name (pre-filled), optional job title, optional phone, "How would you like to use COMVERA?" (role-appropriate choices, never a permission), and an optional product-news opt-in that is off by default.
  - Your company follows, and the workspace opens only when required steps are done.
  - Files: `public/js/auth.js`, `public/js/profile.js`, `public/js/onboarding.js`, `src/routes/auth.ts` (`PUT /api/me/profile`), `src/lib/onboarding.ts`, migration `031_personal_profile.sql`.
- **Invited people:** they answer About you once, on a short page, before the app opens (`renderProfileGate`). Existing users were marked complete in the migration, so they are never pushed through it.
- **Your next step:** one card on the dashboard, worked out from real data (`public/js/nextstep.js`). The order is: create a site, then set requirements, then invite a contractor, then review what was submitted. Contractors see open invitations, then company documents, then the first safety file. It never offers an action the role cannot take.
- **Public pricing switch:** `PUBLIC_PRICING_ENABLED` (default off).
  - `/api/pricing` returns 404 for everyone except platform admins.
  - The Pricing link and "View pricing" buttons disappear, and `/pricing` says "Pricing is being finalised" and offers the free trial.
  - Inside the app, plans and features stay but each price reads "Price to be confirmed". Once online payments are switched on, prices always show, so nobody is charged without seeing one.
  - Plans, entitlements, `plan_settings`, promo codes and billing code are untouched.
- **Account settings** uses the same About you form (purpose and consent editable). The organisation's details stay in Organisation settings for owners and admins only.

## 4. Registration and onboarding: how it handles each case
| Case | What happens |
|---|---|
| New person, new company | Sign up, confirm email, set-up (About you, company, contact, site or services, documents), then the workspace with one next step |
| Invited to an existing organisation | The invitation link fixes the email address. Sign up, confirm, About you once, then the workspace with the invited role. No second organisation is created (S4) |
| Contractor invited to a site | Site-invite link, sign up, set-up, then sees only that site (S10) |
| Interrupted | Every step saves. Refreshing or signing out and back in resumes at the next unfinished step, with earlier answers kept (S6) |
| Existing users | Not affected. Marked complete in migration 031 |
| Joining someone else's company without an invitation | Not possible. Membership only ever comes from an invitation. Sign-up does not reveal whether a company already uses COMVERA |

## 5. Profiles and privacy
- **Personal:**
  - Fields: first name, last name, job title, phone, purpose, product-news consent.
  - Each person edits only their own. The purpose never changes a role (tested).
  - No ID number and no photo are asked for.
- **Organisation:** name, registration, address, phone, contact, trade and logo. Only owners and admins can change them; the server refuses others (S21).
- **Marketing:** consent is stored separately from account email (`marketing_consents`, source `profile`). Account and compliance emails are not affected by opting out.
- **Audit:** audit events keep the person's id, so a later name change does not break history.

## 6. Pricing
- **Hidden publicly:** the pricing page, the Pricing links, the public API and the in-app prices while payments are off.
- **Kept:** all plans, limits, features, promo codes and the pricing administration in the Manager portal (platform admins can still see prices).
- **To publish later:** set `PUBLIC_PRICING_ENABLED=true` in Render and redeploy. There are no code changes. `test/pricingflag.test.ts` shows the "off" behaviour; `test/promos.test.ts` shows the "on" behaviour.

## 7. Automated tests (last full run, 2026-11-21, Chromium, isolated local server)
| Suite | Result |
|---|---|
| `npm test` (backend, tenancy, billing, documents, onboarding, profile, pricing switch) | **373 pass, 0 fail, 0 skipped** |
| `scripts/rc01.mts` (30 acceptance scenarios, 150 checks) | **30/30 scenarios, 150/150 checks**, on two consecutive runs. 0 server errors, 0 script errors |
| Contractor journey | 44/44 |
| Document-request journey | 46/46 |
| Landing (published-pricing mode) | 18/18 |
| Today card | 9/9 |
| Consultant and pricing toggle (published-pricing mode) | 21/21 |
| Bot swarm (19 bots) | 105/105 |
| Security probes | 51/51 |

- **Test fixes, not product defects:** the first rc01 run passed 13 of 30. The failures were test-script mistakes (a set-up helper bug, a session expired too widely, wrong expectations) plus one real defect, the name fields' layout, which was fixed. A later run had one intermittent failure, a race in the test while confirming the email; fixed by waiting for the confirmation, as a person would.
- **Friction measured:** the contractor journey's sign-up threshold moved from 6 to 7 actions, because the terms checkbox adds one click.
- **Not covered:** Firefox, WebKit, real email, real payments, the live site, AI with a key.
- **Report:** `RC01_REPORT=… npx tsx scripts/rc01.mts` writes JSON with the name, browser, status, duration, console errors and network failures for each scenario, plus a screenshot on failure.

## 8. Security
- **Server-side checks:** every new route sits behind the existing role, tenancy and CSRF checks.
- **Terms enforcement:** acceptance is enforced on the server, not only on screen.
- **Purpose:** it is a fixed list, stored only, and never read by permission checks.
- **Abuse tests:** cross-organisation access, wrong roles, a missing CSRF token, an expired session, a revoked invitation, program and HTML uploads, HTML in names and over-long fields were all exercised (S25–S28) and refused.
- **Earlier work still in place:** findings register `docs/security/COMVERA_SECURITY_FINDINGS.md`; 2,224 cross-organisation probes; two independent reviews.
- **Independent review (an agent that did not write the code):** no security defects found in sign-up, the profile route, the migration, escaping, or price hiding. Fixed after its findings:
  - People with one name could not save their profile; last name is now optional.
  - "About you" showed stale values after saving; fixed without redrawing the page.
  - The older name route now keeps first and last name in step.
  - Members who cannot review no longer see "No reviews waiting".
  - Plan text on the pricing page is now escaped, as a precaution.
- **Accepted:** people who signed up before migration 031 have no recorded terms acceptance; ask them at the next terms change.
- **Still open:** production backup restore, an external penetration test, the hosted virus scanner and hosted storage are unverified. A test alone does not establish security.

## 9. UX: top friction points
1. **Set-up length:** about 5 required steps for a site owner. Each is short and saved, but a person new to safety files may still hesitate on "Safety contact". Improved: the contact is pre-filled from the signer.
2. **Sign-up takes 7 actions** (the terms checkbox adds one). Accepted.
3. **Email confirmation** stops the flow until the link is opened. This is required; the page explains it and lets the person resend the link.
4. **"What happens next" after set-up** was unclear. Improved: one next-step card.
5. **Prices could look final.** Improved: hidden until confirmed.
6. **Invited people saw no welcome.** Improved: short About you page with the company named.
7. **Many More-menu items for new users.** Not changed; needs human testing.
8. **No standalone help centre.** The walkthrough and Oscar cover it. Deferred.
9. **No profile photo.** Initials only. Deferred (P3).
10. **Unknown:** whether non-technical users understand "requirements", "Site Ready" and "safety contact" without help. Measure in the tester sessions.

These scores are subjective until real people are observed:

| Workflow | Clarity | Discoverability | Navigation | Task completion | Feedback | Error recovery | Accessibility | Mobile |
|---|---|---|---|---|---|---|---|---|
| Sign-up and set-up | 8 | 8 | 8 | 9 | 8 | 8 | 7 | 8 |
| Request, upload, review | 8 | 7 | 7 | 9 | 8 | 8 | 7 | 8 |

## 10. Tester handover
See `docs/TESTER_HANDOVER.md`: access, trial, safe data, the ten tasks, the feedback route and the questionnaire.

## 11. Release scores (out of 10, evidence-based)
| Area | Score | Why |
|---|---|---|
| Security confidence | 8 | Strong server-side controls and extensive probes. No external penetration test; hosted scanner, storage and backups unverified |
| Core functionality | 8.5 | Every core workflow passes end to end. Email delivery unverified |
| Navigation | 7.5 | Consistent tabs and back links. The More menu is long |
| Onboarding | 8.5 | One guided, resumable flow with server-side gates |
| User intuitiveness | 7 | Not yet measured with real people |
| Mobile usability | 8 | All critical journeys pass at 375 px |
| Product-led activation readiness | 7.5 | Next step and milestone tracking are in place. Pricing, payments and the help centre come later |
| Overall external trial readiness | 8 | Ready for supervised testing once deployed |

## 12. Release decision: **CONDITIONAL GO** for supervised external acceptance testing
**Conditions:**
1. Deploy this release, which also closes the live pricing exposure.
2. Set `SMTP_URL` and keep payments off.
3. Run the smoke check and one real sign-up on the live site.
4. Testers use made-up data only.

**NO-GO** for paid launch or marketing until real email, payments, legal sign-off on the terms and privacy notice, and a production restore test are done.
