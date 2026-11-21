# COMVERA: handover for external testers (Release Candidate 01)

Testers use the **real COMVERA application**, not a copy. Everything they do runs on the same code that paying customers will use.

## 1. Before you invite anyone (owner checklist)
1. **Deploy** this release candidate from GitHub to Render. Migrations 030 and 031 run on start.
2. Set or confirm these environment variables in Render:
   - `PUBLIC_PRICING_ENABLED` unset or `false`, so prices stay hidden.
   - `ENFORCE_PLANS=true`, so trials are real.
   - No Stripe or Paystack keys, so no payments are possible.
   - `SMTP_URL` set, so confirmation and invitation emails arrive.
   - `REQUIRE_EMAIL_VERIFICATION=auto` (the default).
3. Smoke-check the live site: `COMVERA_URL=https://www.comvera.co.za npm run smoke`. Then sign up once yourself with a throwaway company and finish set-up.
4. Check that https://www.comvera.co.za/pricing says "Pricing is being finalised" and shows no amounts.

## 2. Access for testers
- **Link:** https://www.comvera.co.za. Testers press **Start free trial** and register themselves. No accounts are prepared for them.
- **Trial:** every new organisation starts on the free trial of the full product. No card is asked for and no payment can be taken, because payments are switched off. If a tester needs longer, the platform admin can give a plan from the Manager portal, or issue a promo code. Do not change or reuse the existing live promo code.
- **Invited testers:** to test the contractor side, a tester who runs a site invites a second tester by email from the site (Invite a contractor), or shares the site code.

## 3. What data testers may use
- Use **made-up companies and people** (for example "Test Rigging (Pty) Ltd").
- **Do not upload real employee documents, ID copies, medical certificates or anything confidential** in this first round. Use blank or sample PDFs instead.
- Use a real email address you can open, because confirmation links and requests arrive by email.

## 4. Tasks (give testers this list, then do not help on the first attempt)
1. Register on your own from the homepage.
2. Complete "About you".
3. Set up your company (or join one, if you were invited).
4. Open the workspace. Without help, say out loud what the app suggests you do next.
5. Create a site (site owner) or join a site, or start a safety file (contractor).
6. Find out which documents are required.
7. Upload a document, or request one from someone.
8. Review a document: approve it, or send it back with a reason. Or correct one that was sent back to you.
9. Find where things stand (readiness or status), then return to the dashboard.
10. Sign out, sign back in, and find what is still outstanding.

**What to measure:**
- Was it completed without help?
- How long did it take?
- Where did the tester hesitate or go the wrong way?
- What wording confused them?

## 5. How testers report problems
- **In the app:** More, then **Report a problem or suggest an idea**. It goes straight to the COMVERA team, together with the page they were on.
- **Defects:** say what you were trying to do, what you clicked, what you expected and what happened. Add a screenshot if possible, and never one that shows a real person's documents.

## 6. Short questionnaire (after the session)
1. Could you set up your account and company without help? (yes / with some help / no)
2. After signing up, did you know what to do next? (1–5)
3. Which step took longest or felt unnecessary?
4. Was anything confusing or worded strangely?
5. Did anything not work?
6. How likely are you to keep using COMVERA for real work? (0–10) Why?
7. What would make you pay for it?

## 7. What testers will not see yet
- Public prices: they are hidden until they are final.
- Online card payments: these are off.
- Real virus scanning and hosted storage: confirm these are configured on Render before real documents are used.
