# COMVERA: next steps

Updated 28 October 2026.

## Done on this branch (`claude/siteguard-multitenant-saas-04lxw0`)

1. **Plan limits match the commercial model.** One site per site subscription; contractor tiers of 5 / 10 / 20 connected
   sites (new Contractor Business); sponsored sites are free. Counted in one place: `src/lib/limits.ts`.
2. **Paystack payments** for South Africa. Monthly subscriptions, a once-off safety file, signed and verified webhooks,
   grace on failed renewals, cancellation that keeps paid time, and payment history under Plan & billing.
   Files: `src/routes/paystack.ts`, `src/lib/paystack.ts`, `src/db/migrations/021_paystack_payments.sql`.
3. **Site templates.** A mine attaches its own form to a requirement; contractors download, complete and upload it
   for review; versions kept. Files: `src/routes/templates.ts`, `src/db/migrations/022_site_templates.sql`, plus the
   screens in `public/js/workplaces.js` and `public/js/sheets.js`.
4. **Docs:** `COMVERA_LAUNCH_AUDIT.md`, `docs/ACCOUNT_RECOVERY.md`, plus updates to `docs/DECISIONS.md`,
   `docs/LAUNCH_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/PARKING_LOT.md`, `README.md` and `.env.example`.

Other files changed: `src/lib/plans.ts`, `src/lib/pricing.ts`, `src/lib/entitlements.ts`, `src/config.ts`,
`src/lib/authz.ts`, `src/app.ts`, `src/routes/{billing,bootstrap,sites,workplaces,projects,files,legal}.ts`,
`public/js/{views,platform}.js`, and the tests `test/{billing,sponsorship,paystack,templates}.test.ts`,
`test/paystack-env.ts` and `test/helpers.ts`.

**Test results (actual):** typecheck clean; every browser script passes `node --check`; `npm test`: **213 passed, 0 failed**.

## Your steps, in order

1. **Merge the pull request** for this branch. Render redeploys by itself, and the two new database changes apply on start.
2. **Domain.** In Render → comvera → Settings → Custom Domains, add `comvera.co.za` and `www.comvera.co.za`. At your
   domain host, set the A record for `@` to the address Render shows, and a CNAME for `www` to `comvera.onrender.com`.
   **Leave the `mail` and `MX` records alone.** Then set `APP_URL=https://comvera.co.za` in Render → Environment.
3. **Email.** Create a mailbox such as `no-reply@comvera.co.za`. In Render → Environment set
   `SMTP_URL=smtps://no-reply%40comvera.co.za:PASSWORD@mail.comvera.co.za:465` (the `@` in the username is written
   `%40`) and `EMAIL_FROM=COMVERA <no-reply@comvera.co.za>`. Test it with *Forgot password* on your own account.
4. **Paystack.** Sign up, add the **test** secret key as `PAYSTACK_SECRET_KEY`, and set the webhook URL to
   `https://comvera.co.za/api/billing/paystack/webhook`. Do one test purchase and one cancel. After Paystack
   approves the business, swap in the live key.
5. **Prices.** More → Platform → Pricing page. Confirm or change Contractor Business (R1,699) and the once-off file
   (R1,299), or switch them off until you decide.
6. **Legal.** Have a lawyer read `/privacy` and `/terms`. Register an Information Officer with the Information Regulator.

## Blockers I could not clear from here

- Paystack account, domain DNS and mailbox all need you (they are accounts in your name). I did not change anything on the
  live service or in Render settings.
- A real Paystack test purchase can't be done until a test key exists. The code is tested against a simulated Paystack.

## Exact next action

Approve and merge the pull request, then do step 2 (domain) and step 3 (email). Those two make the site usable by real
people tonight.
