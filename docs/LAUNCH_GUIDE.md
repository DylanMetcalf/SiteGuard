# Launch guide: from this repository to a live app you can sell

This guide is written for a founder, not a developer. It takes you from nothing to SiteGuard
running on your own web address, sending real emails, and (optionally) using AI, in about an
afternoon. You never need to edit code.

**The big picture.** SiteGuard needs four things around it:

| # | What | Plain-language job | Who we use | Cost to start |
|---|---|---|---|---|
| 1 | Hosting | The computer in a data centre that runs the app and stores its data | **Render** | ≈ R260/month |
| 2 | Email | Sends invitations, password resets and reminders so they don't land in spam | **Resend** | Free to start |
| 3 | Domain | Your address, e.g. `siteguard.co.za` | **domains.co.za** | ≈ R99/year |
| 4 | Cloudflare | Extra protection and cheaper file storage later | **Cloudflare** | Optional — skip at launch |
| + | AI key | Makes the assistant and drafting "think" rather than use built-in rules | **Anthropic (Claude)** | Pay as you go, start with ≈ R200–R400 |

Everything works **without** the AI key: the assistant answers from SiteGuard's built-in rules and
starter packs, and document drafting uses templates tailored to the work described. Adding the key
upgrades both, with no other change.

Do the steps in this order: **1 Hosting → 3 Domain → 2 Email → AI key → 4 Cloudflare (optional)**.
The domain comes before email because email providers need to check you own the domain.

---

## Free try-out first (optional, ≈ 15 minutes, R0)

To click through SiteGuard before paying for anything, deploy the free demo version:

1. Sign up at **render.com** with your GitHub account.
2. Click **New → Blueprint** and choose the `SiteGuard` repository.
3. In **Blueprint Path**, type `render.free.yaml`. There is nothing else to fill in.
4. Click **Apply** and wait 5–10 minutes. Open the `https://siteguard-demo-xxxx.onrender.com` link.
5. Choose how to try it:
   - **Explore the demo**: a sample mine with contractors and documents already in it.
   - **Or start fresh with no sample data**: type your mine's name, a contractor's name and your
     name. You get an empty mine and an empty contractor, both yours, and switch between them with
     the company name in the top bar (add a second contractor to see several on one site). It's
     kept for 30 days. Start as the mine: tap **+ Add site**, keep the general safety file ticked,
     create it and note the **site code**. Switch to a contractor, tap **Join a site with a code**
     and follow the safety file guide. Switch back to the mine and open the site: contractors by
     trade, the review queue, and the requirements.

The free version is for trying it out only. It sleeps after 15 minutes without visitors (the next
visit waits about a minute), Render deletes its database after 30 days, uploaded files are lost
when it restarts, and it sends no emails. When you're ready for customers, delete it (Render →
the blueprint → Settings → Delete) and follow Step 1 below.

## Step 1 — Hosting on Render (≈ 20 minutes)

Render runs the app, the database and file storage for you, and redeploys automatically whenever the
code on GitHub changes. This repository contains a `render.yaml` "blueprint" that tells Render
exactly what to create.

1. Go to **render.com** and sign up with your **GitHub** account (the one that owns this repository).
2. Add a payment card under **Billing**. The blueprint uses small paid plans because the free plans
   sleep when idle and delete the database after 30 days.
3. Click **New → Blueprint**, choose the `SiteGuard` repository, and click **Apply**.
4. Render asks for a few values. **Leave them all blank for now** and continue. You'll fill them in
   during steps 2, 3 and the AI step.
5. Wait for the first deploy to finish (5–10 minutes). Render shows a link like
   `https://siteguard-xxxx.onrender.com`. Open it: you should see the SiteGuard sign-in page. Click
   **Explore the demo** to check everything works.

What Render created:

- **siteguard** (web service): the app. Its region is Frankfurt, Render's closest region to South
  Africa (pages load in a blink; uploads take a moment longer than they would from Johannesburg).
- **siteguard-db** (Postgres database): all your customers' records. Render backs it up.
- **uploads** (a 5 GB disk attached to the app): uploaded documents. Render snapshots it daily.
  You can grow it later with one click, but never shrink it.

> Where to change settings later: open the **siteguard** service → **Environment**. Every change
> there restarts the app with the new value (about a minute).

## Step 3 — Domain from domains.co.za (≈ 15 minutes + waiting)

1. On **domains.co.za**, search for your name (e.g. `siteguard.co.za`) and buy it. A `.co.za` is
   about R99 a year. (The registry fee increases slightly from 1 October 2026, so the price may
   rise a little.) You don't need their web hosting — Render is your hosting.
2. Decide the app's address. We recommend **`app.yourdomain.co.za`**, which leaves the main address
   free for a marketing website later.
3. In Render: **siteguard → Settings → Custom Domains → Add**, type `app.yourdomain.co.za`. Render
   shows a **CNAME** record, e.g. `app` → `siteguard-xxxx.onrender.com`.
4. In domains.co.za: log in → **My Domains → your domain → DNS / Manage DNS**. Add a record:
   - Type: `CNAME`, Name/Host: `app`, Value/Target: the `…onrender.com` address Render showed you.
5. Back in Render, click **Verify**. It can take from a few minutes to a few hours for the new
   record to spread. Render then issues the padlock (HTTPS certificate) automatically.
6. In Render: **siteguard → Environment**, set `APP_URL` to `https://app.yourdomain.co.za` and save.
   This makes the links in emails point to your address.

## Step 2 — Email with Resend (≈ 20 minutes + waiting)

Invitations, email confirmations and reminders need a proper sending service, or they end up in
spam. Resend is free for up to 3,000 emails a month (100 a day), which covers a pilot comfortably;
the next plan is about $20/month for 50,000.

1. Sign up at **resend.com**.
2. **Domains → Add Domain**, enter `yourdomain.co.za`. Resend shows 3–4 DNS records (a mix of
   `TXT` and `MX` records, for SPF and DKIM — the "this email really is from you" checks).
3. Add each record in domains.co.za's DNS manager exactly as shown (copy and paste the values). Then
   click **Verify** in Resend. Wait until it says **Verified**.
4. Also add this `TXT` record, which tells mail servers what to do with fakes (DMARC):
   Name `_dmarc`, Value `v=DMARC1; p=none; rua=mailto:you@yourdomain.co.za`.
5. In Resend: **API Keys → Create API key** (permission: *Sending access*). Copy it — it starts
   with `re_`.
6. In Render: **siteguard → Environment**, set:
   - `SMTP_URL` = `smtps://resend:re_YOUR_KEY_HERE@smtp.resend.com:465`
   - `EMAIL_FROM` = `SiteGuard <no-reply@yourdomain.co.za>`
   - `SUPPORT_EMAIL` = your own address. When a user taps **More → Report a problem**, it lands here.
7. Test: create a real account on your site. The confirmation email should arrive within a minute.
   (Check spam the first time and mark it "not spam".)

Until `SMTP_URL` is set, emails aren't sent: they are written to Render's log (**siteguard →
Logs**), which is handy for testing but not for customers.

**Your own mailbox** (e.g. `you@yourdomain.co.za` to receive replies) is separate from Resend,
which only sends. If you want one, domains.co.za sells email hosting (from about R69/month), or use
Google Workspace or Microsoft 365. Their setup adds `MX` records for the main domain; Resend's
records don't clash with them.

## Loading the AI key (≈ 10 minutes)

1. Go to **console.anthropic.com** and sign up.
2. **Billing**: add a card and buy credits. Start with **$10–$20** (≈ R180–R360). Under
   **Limits**, set a monthly spend limit so a bill can never surprise you.
3. So the assistant can research a specific mine's published requirements: in the console, make sure
   **web search** is allowed for your organisation (under the organisation's settings/privacy
   controls). Without it, the assistant still works; it just relies on built-in knowledge.
4. **API Keys → Create Key**, name it `siteguard-production`, and copy it (starts with `sk-ant-`).
5. In Render: **siteguard → Environment**, set `ANTHROPIC_API_KEY` to that key and save.
6. Check: open **More → Organisation settings**; the AI section says *AI drafting and expiry-date
   detection are on*. The assistant's header now shows an **AI** badge instead of *Built-in rules*.

**Keep the key secret.** It is like a bank card for AI usage. Only ever paste it into Render's
Environment page. Never put it in the code, a document, WhatsApp, an email, or the browser. The
app is built so the key stays on the server — browsers never see it. If it leaks, delete it in the
Anthropic console and create a new one.

**What it costs to run.** Pay-per-use, roughly:

| Action | Rough cost |
|---|---|
| Drafting one document | ≈ R1–R2 |
| One assistant question (with site lookups) | ≈ R1–R3 |
| One assistant question that searches the web | add ≈ R0.20 per search (it does up to 5) |
| Expiry-date scan of an uploaded certificate | well under R1 |

Each organisation is capped at 300 AI requests a month by default (`AI_MONTHLY_REQUEST_LIMIT`),
so one busy customer can't run up your bill. To save money, you can set `ANTHROPIC_MODEL` to a
cheaper model, such as `claude-sonnet-5`; Anthropic's pricing page lists the options. The server
automatically retries a declined request on Anthropic's recommended fallback model (the
*server-side fallback* option), so users rarely see an AI error.

## Step 4 — Cloudflare (optional; skip at launch)

You do not need Cloudflare to launch. It becomes worthwhile when:

- **You want your DNS in one friendlier place with extra protection.** Cloudflare is free: you
  point your domain's name servers at Cloudflare (in domains.co.za) and manage DNS there instead. If
  you do, keep the `app` record **"DNS only" (grey cloud)** at first so Render's certificate keeps
  renewing.
- **Documents outgrow the disk** or you want to run more than one app server. Then move file
  storage to **Cloudflare R2** (S3-compatible, no download fees): create a bucket and an API token,
  and set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
  `S3_SECRET_ACCESS_KEY` (see [DEPLOYMENT.md](DEPLOYMENT.md#storage)). Existing files then need
  copying across; ask your developer for that migration.

## Payments (not needed to launch)

Billing through Stripe is built in but **optional**. With no Stripe keys, every organisation has
full access and no limits, so you can sell your first customers on a simple invoice (EFT) and
switch Stripe on later. Stripe does support South African businesses, but check your company is
eligible before relying on it. A local option such as Paystack or PayFast is in the parking lot.

**Who pays (once Stripe is on).** Everyone starts with a 14-day trial of the full product. After that:
contractors pay for their own company (Contractor Starter or Pro); mines and sites pay for theirs, and
their subscription **sponsors** each contractor's file on their own sites, so a contractor invited by a
paying mine can finish that mine's safety file without paying. A sponsorship never covers the
contractor's other clients. Nothing is deleted when a trial ends; it becomes read-only until a plan is chosen.

**Prices on the website.** More → Platform → *Pricing page*. The prices there are only what the public
pricing page shows; what customers are charged is the Stripe price for each plan
(`STRIPE_PRICE_CONTRACTOR_STARTER`, `STRIPE_PRICE_CONTRACTOR_PRO`, `STRIPE_PRICE_HOST_STARTER`,
`STRIPE_PRICE_HOST_PRO`), so keep them in step. The starting prices are a proposal (see `docs/DECISIONS.md`).

**Free access for family, testers or partners.** More → Platform → *Promo codes* → *Create a code*, e.g.
`FAMILYFREE`, plan Contractor Pro, 100% off, blank "lasts for" (no end date), and "how many
organisations" = the number of people you'll give it to. They type the code under **More → Plan &
billing → Have a promo code?**. Switch a code off at any time. For a mining group on an agreed contract,
use *Give a plan* to set them to Enterprise until a date.

---

## What it costs to start

At roughly R18 to the US dollar (check today's rate); prices verified September 2026.

| Item | Monthly | Once / yearly |
|---|---|---|
| Render web service (Starter, 0.5 CPU / 512 MB) | $7 ≈ R126 | |
| Render Postgres (smallest paid plan) | $6 ≈ R108 | |
| Render disk, 5 GB | ≈ $1.25 ≈ R23 | |
| Render workspace (Hobby) | free | |
| Domain `.co.za` at domains.co.za | | ≈ R99/year |
| Resend email (free tier: 3,000/month) | free | |
| Cloudflare | free (optional) | |
| Claude API credits (pay as you go) | usage-based | start with ≈ R180–R360 |
| GitHub (code and uptime checks) | free | |
| **Total to go live** | **≈ R260/month** | **≈ R100 + R180–R360 AI credit** |

**Under R700 gets you live for the first month.**

When you grow (say 10+ paying mines): bigger app server ($25 ≈ R450), bigger database
($19–$55 ≈ R340–R990), Resend Pro ($20 ≈ R360), Render's Professional workspace if you add team
members ($25 ≈ R450). Budget roughly **R1,500–R2,500/month** at that stage, which one customer
covers.

**Business costs outside the app** (not required to switch it on, but before you take money):

- Company registration with CIPC, if you haven't already (about R175 online).
- **Terms of service and a privacy policy (POPIA)** reviewed by an attorney. SiteGuard holds personal
  information (worker names, medical fitness, contact details), so you are a *responsible party*
  under POPIA. Register your Information Officer with the Information Regulator (free).
- Your data is hosted in Germany (EU). POPIA allows this where the other country has adequate
  protection, which the EU's GDPR generally provides. Say so in your privacy policy. If a mining
  house insists on South African hosting, see option B in [DEPLOYMENT.md](DEPLOYMENT.md).
- Professional indemnity insurance is worth pricing, since customers rely on the compliance record.

---

## Keeping an eye on it

- **Uptime check.** In GitHub: **Settings → Secrets and variables → Actions → Variables → New
  repository variable**, name `SITEGUARD_URL`, value `https://app.yourdomain.co.za`. GitHub then
  checks the site every 30 minutes and emails you if it's down.
- **Logs.** Render → **siteguard → Logs** shows what the app is doing, including any emails
  written to the log while email isn't set up.
- **Compliance agent.** Runs inside the app every 15 minutes on every customer's sites, and emails
  each customer's admins a summary on Monday mornings. Nothing to set up.
- **Problems users hit.** *Report a problem* messages arrive at `SUPPORT_EMAIL`. Errors in users'
  browsers are written to Render's log automatically (search the log for `browser error`).
- **Library updates.** Every Monday GitHub (Dependabot) opens a pull request updating the app's
  libraries. The automatic tests run on it; if they're green, merge it and Render redeploys.
- **Backups.** Render backs up the paid database and snapshots the disk daily. Once a month, try a
  restore of the database into a new one to prove it works.

- **Your platform overview.** In Render → **siteguard → Environment**, set `PLATFORM_ADMIN_EMAILS` to
  your own email address. Sign up with that address and confirm it from the email. **More → Platform**
  then shows sign-ups, plans, usage, failed emails and the latest feedback. Nobody else can see it.
- **Privacy notice and terms.** `/privacy` and `/terms` are drafts that describe what SiteGuard does.
  Before the first paid customer, ask an attorney to finish them. The pages list what is missing:
  your company details, Information Officer, retention periods and governing law.
- **Enquiries.** The public contact page (`/contact`) saves each enquiry to More → Platform and emails
  `SUPPORT_EMAIL`. Set `CONTACT_PHONE` in Render if you want a phone number shown there.
- **Customers' own data.** An organisation's admin can download all of its data under **More →
  Organisation settings → Download our data**. Point customers there if they ask for a copy.
  See `docs/OPERATIONS.md` for backups and recovery.

## Sharing SiteGuard with testers

Send people your app's address (for example `https://siteguard.onrender.com`). They land on a page
that explains SiteGuard, with three ways in:

- **Create a free account**: they choose "We run a site or mine" or "We're a contractor", then
  confirm their email address from the link SiteGuard sends. Email needs Step 2 (Resend) to be
  set up; until then, confirmation links only appear in Render's log.
- **Watch the 2-minute tour**: a private demo with sample data that plays the walkthrough by
  itself. Nothing they do there touches real accounts, and it is deleted after three days.
- **Sign in**, once they have an account.

Tips for a test round:
- Ask one tester to be a mine and one to be a contractor, so they can try the site code, reviews
  and Site Ready together.
- Contractors who work for clients outside SiteGuard can try **Sites → + Project**.
- Testers send feedback from **More → Report a problem or suggest an idea**; it is emailed to the
  `SUPPORT_EMAIL` address you set in Step 2.
- Until you switch on payments, everything is free and no limits apply.

## Your 10-minute demo on site

**Hands-free option:** open SiteGuard, then **Walkthrough** on the dashboard (or More →
Walkthrough) and tap **Auto-play**. It moves through every page by itself, about 7 seconds per
step, and you can talk over it. Back and Next take over at any point. Sending someone a link that
ends in `?tour=1` starts the walkthrough as soon as they sign in.

Use a phone or tablet. Open your site and tap **Explore the demo**: a private sandbox with a sample
mine and three contractors, deleted automatically after three days.

1. **The problem (1 min).** "How do you know today, without phoning anyone, whether every
   contractor on this site has a valid COID letter, medicals and appointments?"
2. **Dashboard (1 min).** Show the **Compliance agent**: it has already found an expired
   document, a worker with an expired medical, and a review that's been waiting. "This checks
   every site every 15 minutes, so nothing expires unnoticed."
3. **Ask SiteGuard (2 min).** Type the prospect's real job, e.g. *"Safety file for electrical work
   and welding on the conveyor at [their mine]"*. It lists the requirements, permits and hazards,
   and offers **Start this site**. Tap it: the site is ready with the right document list.
4. **The contractor's side (3 min).** Switch persona (top bar) to Sipho, a contractor. Open the
   Leeuwpan risk assessment the mine sent back for correction and tap **Create it in Document
   Studio**. Describe the job, tap **Create document**, and open the PDF: a numbered, branded risk
   assessment with a risk register and sign-off blocks. Tap **Attach and submit for review**. (Upload
   a logo under More → Organisation settings first to show the company's own branding.)
   Even faster: on the contractor's site page tap **Continue my safety file** (the safety file
   guide), then **Write them now**: answer the questions once, watch SiteGuard write every missing
   document it can, then **Submit all for review**.
5. **Review and Site Ready (2 min).** Switch back to the mine persona and open the bell: the new
   submissions are there. Open one, approve a section, highlight a sentence and tap **Needs
   changes** with a note, then **Send back**. Switch to the contractor: the bell shows the feedback;
   edit the section, save, resubmit. Back as the mine: only the edited section needs review.
   Finish with **Download the safety file** (one PDF with cover and contents), the Site Ready
   verification and a share link a safety auditor can open without an account.
6. **Close (2 min).** "Contractors use it free. You pay per user after a 14-day trial. Can we set up
   your first site together now?" Create a real account on the spot and use **Ask SiteGuard** to
   start their first site.

### Show the mine's oversight tools (2 minutes, add to either demo)

1. On the mine's site page open **Gate**: who may enter today, and the reason for anyone who
   can't. Open a contractor's file → **People** → **Print gate cards (QR)** and scan one with a
   phone: the gate check page opens without a login.
2. **Site activity → Audit this contractor**: tap Yes / No through the checklist, type a note on
   one "No", save. Switch to the contractor: the finding is on their to-do list; they say what was
   fixed; back as the mine, **Close** it.
3. **More → Organisation settings → Validity rules**: set medicals to 12 months from issue.
4. **Contractors → a company → Suspend on all my sites** (then lift it): Site Ready, permits and
   the gate all stop at once.

### The same demo from a clean start (best for a mine's SHE manager)

Tap **Or start fresh with no sample data**, name the prospect's mine and two of their contractors.

1. As the mine: **+ Add site** → keep **General safety file — mine** ticked, add the electrical
   list if relevant → **Create site and get its code**. Show the requirements tab: "This is your
   standard, researched and editable."
2. Switch to the first contractor → **Join a site with a code** → the safety file guide opens:
   submit company documents, add a worker with a medical, **Write them now**. Do the same quickly
   for the second contractor.
3. Back as the mine: open the site. Contractors grouped by trade, **Review queue** with everything
   waiting, vet one document section by section, and export one contractor's safety file.
   "One site, one code, every contractor's file in one place."

## Updates and maintenance

- **Nobody reinstalls anything.** SiteGuard is a website. When a change is merged on GitHub, Render
  rebuilds and redeploys it automatically (a minute or two of downtime at most), and every user
  gets the new version the next time the page loads. Database changes (migrations) apply
  themselves on start-up.
- **Making a change or fixing a bug:** describe it to Claude Code (for example in a session on this
  repository). It makes the change, runs the tests, and opens a pull request. You check the
  summary, and merging it deploys it.
- **Safety net:** CI runs the tests on every pull request, so a change that breaks something is
  flagged before you merge it. Render marks a deploy as failed if the app doesn't pass its health
  check, and **siteguard → Events → Rollback** returns to the previous version with one click.

## Branding your documents

Each company sets its own document branding under **More → Organisation settings → Document
branding**: logo (PNG or JPG), brand colour and document number prefix (e.g. `ABC` gives
`ABC-RA-001`). Every document created in **Document Studio** uses them. Documents are yearly
controlled documents: the compliance agent reminds the company when a review is due, and **New
revision** re-issues it under the same number.

## Connecting a contractor to a site

Two ways, both from the site's page on the mine side: the **email invitation** (sent when the site
is created) or **Get a join code**, an 8-character code valid for 14 days that you can read out,
WhatsApp or print for the site office. The contractor taps **Join a site with a code** in the app.
Either way the contractor then sees the site's document list, and the mine is notified when they
join.

## When something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Emails don't arrive | `SMTP_URL` not set, or domain not verified in Resend | Check Render → Environment, then Resend → Domains shows *Verified* |
| Email links point to `localhost` or `onrender.com` | `APP_URL` not set to your domain | Set `APP_URL` in Render |
| "AI drafting isn't configured" / *Built-in rules* badge | `ANTHROPIC_API_KEY` missing | Add it in Render → Environment |
| Assistant says the AI service is busy | Anthropic rate limit or outage | It falls back to built-in rules automatically; try again later |
| Site shows an error page | Deploy failed | Render → siteguard → Events shows the failed deploy and its log |
| Custom domain stuck on *Verifying* | DNS still spreading, or a typo in the CNAME | Re-check the record in domains.co.za; wait a few hours |
| "That code isn't valid or has expired" | Code older than 14 days, a newer code was made, or the contractor already joined | Tap **Get a join code** again on the site and give them the new one |
| A document in the bound safety file shows "not merged" | It's a Word file or a password-protected PDF | Upload a PDF version, or open the original in SiteGuard |
