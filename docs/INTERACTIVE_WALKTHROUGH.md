# Interactive walkthrough (`/walkthrough`)

A single public page that explains, in about six minutes, the problem COMVERA solves and how
it works. Anyone can open it from one link; nobody needs an account.

- **Address:** `https://YOUR-ADDRESS/walkthrough` once COMVERA is online (e.g.
  `https://app.comvera.co.za/walkthrough`). Linked from the home page and the site footer.
- **Files:** `public/walkthrough.html` (structure and copy), `public/walkthrough.css` (look),
  `public/js/walkthrough-page.js` (behaviour). The server route is in `src/app.ts`.
- **Test:** `test/walkthrough.test.ts`.

## The story

One fictional example runs through every chapter: Voltrix Electrical Contractors preparing its
safety file for Highveld Mining Group's Shaft 3 conveyor job.

| Chapter | What the visitor does |
|---|---|
| Opening | Sees the safety file scattered across an email, WhatsApp, a shared folder, a tracker and an expired-certificate alert. |
| 01 Recognise the problem | Opens each of the five places; each shows a short insight. The pattern summary appears after two. |
| 02 Current process | Clicks the eight stages of the usual email-and-folders process, or plays it and watches it loop back twice. |
| 03 Meet COMVERA | Watches the scattered pieces sort themselves into one file with statuses; sees the overview. |
| 04 The workflow | Works the file as the mine's reviewer: open the file, read requirements, inspect statuses, find the expired Working at Heights certificate, ask for a new copy, see it uploaded, approve it. |
| 05 Handle an issue | Decides what to do with a medical certificate that's outside the site's 12-month rule: ignore, send back, or check the rule first. |
| 06 Outcome | Switches between Before and With COMVERA; the "after" list shows the statuses from what the visitor did. |
| 07 Business value | Visibility, Organisation, Follow-through and Coordination, each shown on the same file. |
| 08 Next step | Contact, restart, or explore COMVERA. Shows which chapters were seen. |

## What is real and what is illustrative

Everything shown matches a real COMVERA feature: requirements per site with their source, the
statuses (Missing, Awaiting review, Complete, Expired, Correction required), review and
send-back with a note, requests to the contractor with email and in-app notices, the compliance
agent flagging expiries, mine validity rules (which only ever shorten an expiry), Site Ready as
a separate decision, the activity history, and requests to people without an account.

The screens are **simplified illustrations**, not the app itself. The companies, people, dates
and documents are fictional. Every click runs only in the visitor's browser; the page never
calls the server and cannot change real records. The page says this in its footer. It makes no
claims about time or money saved, and says COMVERA does not by itself make an operation compliant.

## Settings for the owner

At the top of `public/walkthrough.html`:

```html
<div id="wt-config" hidden data-contact-url="/contact" data-contact-email="" data-explore-url="/"></div>
```

- `data-contact-url`: where **Let's discuss your requirements** goes. Inside COMVERA it is the
  real contact page (`/contact`), which sends the message to `SUPPORT_EMAIL`.
- `data-contact-email`: used only if there is no contact URL; the address is also shown as text.
- `data-explore-url`: where **Explore COMVERA** goes (the home page, where visitors can open the
  demo). Leave it empty to hide the button.
- With both contact settings empty, the button shows a "contact details not added yet" note
  instead of a broken link.

## Run it locally

`npm run dev`, then open `http://localhost:3000/walkthrough`. It needs nothing else.

## Sharing it

It goes online with COMVERA (see `GO_LIVE.md`); no extra hosting or settings. Until then, a
hosted copy can be shared as a private claude.ai artifact link, which Claude can republish
after changes.
