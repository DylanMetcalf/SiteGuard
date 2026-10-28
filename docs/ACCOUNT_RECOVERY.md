# Getting back into COMVERA: account and admin recovery

COMVERA has **no master password, no secret admin page and no way around sign-in**. Every way back in
goes through an email address you control, or through the server's own settings that only the
person with the Render account can change. This page says what to do in each situation.

## 1. Someone forgot their password
On the sign-in page choose **Forgot password**. COMVERA emails a one-time link that expires. Nobody at
COMVERA can see or set anyone's password.
If the email doesn't arrive: check spam, then check email sending is working (Render → the comvera
service → Logs, look for email errors; `SMTP_URL` must be set).

## 2. A team member left, or lost access to their email
An **owner or admin** of the same organisation opens **More → Team & roles** and removes them or
changes their role, then invites the new person. The organisation's documents belong to the
organisation, not the person, so nothing is lost.

## 3. The only owner of an organisation can't get in
1. If they still control their email: use *Forgot password* (section 1).
2. If not: the customer contacts COMVERA support from a company address. Verify who they are outside
   COMVERA (a call to the number on their company letterhead or CIPC record, or a letter on company
   letterhead signed by a director). Do not act on an email alone.
3. Once verified, the platform operator changes the owner's email address directly in the database
   (one SQL statement, recorded below). The customer then uses *Forgot password* on the new address.
   Record what was done, who asked, and how they were verified, in a support log.

```sql
-- Run in Render → comvera_db → Shell (psql). Check the result says UPDATE 1.
update users set email = 'new.owner@company.co.za', email_verified_at = null where email = 'old.owner@company.co.za';
```

## 4. You (the platform operator) lost access to the COMVERA platform admin
Platform admin is whoever's email is listed in the `PLATFORM_ADMIN_EMAILS` setting on Render. It is not
a separate password.
1. Use *Forgot password* on that address.
2. If you lost that mailbox: sign in to **Render** (protect it with two-factor authentication), open the
   comvera service → *Environment*, change `PLATFORM_ADMIN_EMAILS` to an address you control, save
   (the service restarts), sign up or reset the password with that address.
3. Losing the Render account itself is recovered through Render's own support. Keep its two-factor
   recovery codes somewhere safe and offline.

## 5. Payment provider access
Paystack and Stripe accounts are recovered through their own support. COMVERA stores only customer and
subscription codes, never cards, so nothing in COMVERA needs to change. If a secret key may have leaked,
roll it in the provider's dashboard and paste the new one into Render (`PAYSTACK_SECRET_KEY`); the service
restarts and carries on. Do this at a quiet time and check a test payment afterwards.

## Never
- Never share one login between people. Invite each person.
- Never paste passwords or secret keys into chat, email or a document.
- Never add a "backdoor" account or a hard-coded password to the code.
- Never delete an organisation to "fix" access. Its records are compliance history.
