# COMVERA — go-live checklist

Written for the owner, not a developer. It covers everything needed to put COMVERA online for a
small beta (you, your parents, one or two friends, a few testers). Everything inside the code is
done; what's left are accounts and settings that only you can create. Allow about **2 hours**,
plus waiting time for the domain and email checks.

Status labels used below:
**[READY]** built and tested · **[ALREADY CONFIGURED]** set in the repository · **[NEEDS ACCOUNT]**
you create an account · **[NEEDS API KEY]** you copy a key from a provider · **[NEEDS MY ACTION]**
a few clicks by you · **[NEEDS DECISION]** your choice · **[OPTIONAL]** can wait.

---

## 1. What is needed, at a glance

| Item | Status | What it is | Provider |
|---|---|---|---|
| Application code | [READY] | COMVERA itself, 195 automated tests passing | this repository |
| Hosting | [ALREADY CONFIGURED] + [NEEDS ACCOUNT] | The computer that runs COMVERA | Render (`render.yaml` describes everything) |
| Database | [ALREADY CONFIGURED] | Where records live (Postgres, created by Render) | Render |
| File storage | [ALREADY CONFIGURED] | Uploaded documents (a 5 GB disk, created by Render) | Render |
| SSL (the padlock) | [ALREADY CONFIGURED] | Render issues and renews certificates automatically | Render |
| Domain | [NEEDS ACCOUNT] + [NEEDS DECISION] | Your address, e.g. `comvera.co.za` | domains.co.za (or any registrar) |
| DNS | [NEEDS MY ACTION] | Points your address at Render, and proves email is yours | your registrar |
| Email | [NEEDS ACCOUNT] + [NEEDS API KEY] | Sends confirmations, resets, invitations, reminders | Resend |
| Sign-in / accounts | [READY] | Built in: passwords, email confirmation, lock-out, resets | — |
| 14-day trial and lifetime codes | [READY] | Switched on by `ENFORCE_PLANS=true` in `render.yaml` | — |
| AI drafting | [OPTIONAL] + [NEEDS API KEY] | Smarter drafts and assistant; works without it using templates | Anthropic (Claude) |
| Card payments | [NEEDS DECISION] | Not needed for the beta. Stripe is built in; check it serves your business | Stripe (or later Paystack/PayFast) |
| Monitoring | [READY] + [NEEDS MY ACTION] | Health check, uptime check every 30 min, error log | Render + GitHub (free) |
| Error tracking | [READY] | Server errors and errors in users' browsers go to Render's log | Render |
| Backups | [NEEDS MY ACTION] | Render backs up the paid database daily; you test a restore monthly | Render (see `OPERATIONS.md`) |
| Platform admin (you) | [NEEDS MY ACTION] | Your email in `PLATFORM_ADMIN_EMAILS` | — |
| Privacy notice and terms | [NEEDS MY ACTION] | Drafts at `/privacy` and `/terms`; an attorney finishes them before paying customers | — |

## 2. Accounts you need

1. **GitHub**: you already have it (it holds the code).
2. **Render** (render.com): hosting, database, file storage. Needs a card.
3. **A domain registrar**, e.g. **domains.co.za**: to buy `comvera.co.za` or similar.
4. **Resend** (resend.com): sends email. Free to start.
5. Optional: **Anthropic** (console.anthropic.com) for AI. Prepaid credit.
6. Later: **Stripe** (stripe.com) when you want card payments.

## 3. Keys and secrets you will copy

| Setting in Render | Where it comes from | Looks like |
|---|---|---|
| `SMTP_URL` | Resend → API Keys | `smtps://resend:re_XXXX@smtp.resend.com:465` |
| `EMAIL_FROM` | you type it | `COMVERA <no-reply@comvera.co.za>` |
| `APP_URL` | your domain | `https://app.comvera.co.za` |
| `SUPPORT_EMAIL` | your own email | `you@gmail.com` |
| `PLATFORM_ADMIN_EMAILS` | your own email (the one you'll sign up with) | `you@gmail.com` |
| `CONTACT_PHONE` (optional) | your number | `+27 82 000 0000` |
| `ANTHROPIC_API_KEY` (optional) | console.anthropic.com → API Keys | `sk-ant-...` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (later) | Stripe dashboard | `sk_live_...`, `whsec_...` |

Never paste these anywhere except Render's **Environment** page. They are never sent to anyone's
browser.

---

## 4. Step by step

### STEP 1 — Put the latest COMVERA on GitHub's main branch
1. Open the pull request for this work on GitHub and click **Merge pull request**, then **Confirm merge**.
2. You should see a purple **Merged** label.

### STEP 2 — Create the Render account
1. Go to **render.com** → **Get Started** → **Sign up with GitHub**. Allow access to your repository.
2. **Billing** (left menu) → add your card.

### STEP 3 — Create COMVERA on Render (one click)
1. In Render, click **New +** → **Blueprint**.
2. Choose your repository (on GitHub it is still called `SiteGuard` unless you renamed it).
3. Render reads `render.yaml` and lists: **comvera** (web service), **comvera-db** (database) and a disk.
4. It asks for some values. Fill in only these now and leave the rest blank:
   - `PLATFORM_ADMIN_EMAILS` → your email address.
   - `SUPPORT_EMAIL` → your email address.
5. Click **Apply**. Wait 5–10 minutes until **comvera** shows **Live** (green).
6. Click the link Render shows, like `https://comvera-xxxx.onrender.com`.
   **You should see:** the COMVERA home page with the new logo.

### STEP 4 — Create your own account and check you are the platform admin
1. On that page click **Start free trial**. Choose **contractor** (or mine), and fill in your name,
   the email you put in `PLATFORM_ADMIN_EMAILS`, a password of 10+ characters, and a company name.
2. Emails aren't set up yet, so to confirm your email open Render → **comvera** → **Logs**, find
   the line with `/verify-email?token=`, copy that whole link into your browser.
   **You should see:** "Email confirmed".
3. In COMVERA open **More**. **You should see:** a **Platform** item. If not, check the email in
   `PLATFORM_ADMIN_EMAILS` exactly matches and that you confirmed it.

### STEP 5 — Make the lifetime code for family and friends
1. **More → Platform → Promo codes → Create a code**.
2. Code: `COMVERA-LIFETIME` (or any name you like). Plan: **Contractor Pro** (or **Site
   Professional** for a mine account). Discount: `100`. "Lasts for": **leave blank** (no end date).
   "How many organisations can use it": `4`. Note: who it is for.
3. Click **Create code**. **You should see** it listed with "used 0 of 4".
4. Each person signs up themselves with their own email and password, opens **Have a promo
   code?** on the sign-up form and types the code. Or send them a link that fills it in:
   `https://YOUR-ADDRESS/?code=COMVERA-LIFETIME`.
5. To stop it working, click **Switch off** next to the code. Anyone who already used it keeps
   access until you remove it under **Give a plan** (choose **No plan** → **Save**).

### STEP 6 — Buy the domain
1. On **domains.co.za**, search `comvera.co.za` (or your choice) and buy it (about R99/year).
2. In Render: **comvera → Settings → Custom Domains → Add Custom Domain**, type `app.comvera.co.za`.
   Render shows a **CNAME** value like `comvera-xxxx.onrender.com`.
3. In domains.co.za: **My Domains → DNS → Add record**: Type `CNAME`, Name `app`, Value = what Render
   showed. Save.
4. Wait (10 minutes to a few hours). In Render the domain changes to **Verified** and a certificate
   is issued automatically.
5. In Render: **comvera → Environment → APP_URL** = `https://app.comvera.co.za` → **Save Changes**.
   **You should see:** `https://app.comvera.co.za` opens COMVERA with a padlock.

### STEP 7 — Email
1. Sign up at **resend.com**. **Domains → Add Domain** → `comvera.co.za`.
2. Resend shows 3–4 records. Add each one in domains.co.za DNS exactly as shown, then click **Verify**.
3. Also add: Type `TXT`, Name `_dmarc`, Value `v=DMARC1; p=none; rua=mailto:you@yourdomain`.
4. Resend: **API Keys → Create API key** (Sending access). Copy it (starts with `re_`).
5. Render: **comvera → Environment**:
   - `SMTP_URL` = `smtps://resend:re_PASTE_HERE@smtp.resend.com:465`
   - `EMAIL_FROM` = `COMVERA <no-reply@comvera.co.za>`
   - **Save Changes** (the app restarts in about a minute).
6. Test: **Sign out**, click **Forgot password**, enter your email.
   **You should see:** a COMVERA email within a minute (check spam the first time).

### STEP 8 — AI (optional; everything works without it)
1. **console.anthropic.com** → sign up → **Billing** → buy $10–$20 credit → **API Keys → Create Key**.
2. Render → **comvera → Environment** → `ANTHROPIC_API_KEY` = the key → **Save Changes**.
   **You should see:** in Document Studio the forms mention AI tailoring, and **More → Organisation
   settings** says AI drafting is on.

### STEP 9 — Uptime check (free)
1. GitHub → your repository → **Settings → Secrets and variables → Actions → Variables → New
   repository variable**. Name `COMVERA_URL`, value `https://app.comvera.co.za`.
2. GitHub now checks the site every 30 minutes and emails you if it's down.

### STEP 10 — Backups
1. Render → **comvera-db** → **Recovery** (or **Backups**): confirm daily backups are listed. Note the
   retention period Render shows for your plan.
2. Once a month do the 15-minute restore test in `docs/OPERATIONS.md`.
3. The documents disk is snapshotted by Render; check **comvera → Disks** shows snapshots.

### STEP 11 — Before charging anyone (not needed for the beta)
1. Ask an attorney to finish `/privacy` and `/terms` (the pages list exactly what's missing).
2. Decide on payments: create a Stripe account, check it can pay out to your South African business,
   create the four prices and add the keys (see `LAUNCH_GUIDE.md` → Payments).
3. Set real prices under **More → Platform → Pricing page**.

---

## 5. What it costs (estimates; usage varies; about R18 to the US dollar)

**Required for the beta**

| Item | Per month |
|---|---|
| Render web service (Starter) | $7 ≈ R126 |
| Render Postgres (smallest paid, includes daily backups) | $6 ≈ R108 |
| Render disk 5 GB (documents, snapshotted daily) | ≈ $1.25 ≈ R23 |
| Domain `.co.za` (≈ R99/year) | ≈ R8 |
| Email (Resend free tier: 3,000/month) | R0 |
| Monitoring, uptime check, error log (Render + GitHub) | R0 |
| **Total** | **≈ R265/month** |

**Optional**

| Item | Cost |
|---|---|
| AI (Claude API, pay as you go) | ≈ R50–R400/month for a small beta; you set the credit |
| Card payments (Stripe) | no monthly fee; a percentage per transaction |
| Your own mailbox (e.g. you@comvera.co.za) | from ≈ R69/month |
| Cloudflare (extra protection) | free |
| Larger plans when you grow (10+ paying sites) | ≈ R1,500–R2,500/month in total |
| Desktop app signing later (Apple developer) | ≈ $99/year |

## 6. Known gaps (honest list)

- **Email is not sending until Step 7.** Until then emails appear in Render's log.
- **Card payments are not live.** Trials and lifetime codes work; paid customers would be invoiced
  by hand or given a plan in Platform until Stripe (or another provider) is connected.
- **Privacy notice and terms are drafts** awaiting an attorney.
- **Backups are Render's.** COMVERA doesn't make its own copies; test a restore monthly.
- **No virus scanning of uploads yet** (files are type-checked and kept private). Recommended
  before opening sign-ups to the public. This matters more with **Exchanges**, where people
  without an account upload files.
- **Exchanges depend on email.** The secure link and the one-time code both arrive by email, so
  Exchanges only work for outside people once Step 7 is done.

## 7. First test with your parents

Do this yourself first on your phone, then sit with them.

1. Send each of them the link `https://app.comvera.co.za/?code=COMVERA-LIFETIME`.
2. They tap **Start free trial**, choose **We're a contractor**, enter their own name, email, a
   password (10+ characters) and a company name. The promo box is already filled in. Tap **Create
   my organisation**.
3. They open the confirmation email and tap **Confirm email**.
4. **You should see** on their dashboard: "Welcome to COMVERA — what would you like to do first?" and
   no trial countdown under **More → Plan & billing** (it shows "Contractor Pro — given by COMVERA, no
   end date").
5. They tap **Set up my company**, type the company details, and **upload a logo**.
6. Back on the dashboard: **Build my first safety file → A client who isn't on COMVERA**. Client:
   any name. Tick the **General** list. **Create**.
7. The guide opens. In step 1, tap a company document (e.g. COID letter) → **Attach file** → choose a
   photo or PDF → **Save to library**.
8. In step 3 tap **Write them now** → answer the questions → **Create** → read one document →
   tick the confirmation → **Submit**.
9. Step 6: **Check and build the PDF** → **Preview**, then **Download**. Open the PDF.
   **You should see:** a cover page, contents, section dividers and page numbers.
10. On a phone: Share → **Add to Home Screen**; open COMVERA from the new icon.
11. Try an **Exchange** with them: in their account, **Documents → Share securely**, tick the COID
    letter, enter *your* email, **Share securely**. Open the email on your phone, type your email,
    then the 6-digit code. **You should see:** the document, and in their account under
    **More → Exchanges** that you opened and viewed it. Then tap **Revoke access** and reload your
    page: it says the exchange was withdrawn.
12. Ask them: what was confusing? Where did they hesitate? Send notes with **More → Report a
    problem or suggest an idea** so you see them under **More → Platform**.
