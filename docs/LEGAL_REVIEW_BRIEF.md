# Brief for the South African lawyer: privacy notice and terms of use

**Status:** the pages at `/privacy` and `/terms` are drafts that describe what the software really does. They make no legal commitments and are marked for legal review. This brief gives the lawyer the facts so the review is quick. It was written from the code and the existing drafts; nothing in it is legal advice.

## The service in one paragraph
COMVERA is a multi-tenant web service for South African mines and their contractors. Mines (and other principal employers) ask contractors for safety-file documents; contractors upload them; the mine reviews them. Each organisation sees only its own records. The operator hosts the service and processes the information on behalf of each organisation.

## Personal information handled (from the code)
| Who | What | Notes |
|---|---|---|
| Users | Name, email, job title, phone (optional), hashed password; sessions with IP address and browser | Optional second sign-in step (authenticator app); recovery codes stored hashed |
| Workers (entered by employers) | Name, employee number, occupation, phone; **only the last four digits** of an ID number; medicals, inductions, training certificates, attendance signatures | Special personal information (health) may appear in medical certificates uploaded as documents |
| Companies | Registration, COID and VAT numbers, address, trade | Business information |
| Documents | Whatever the organisation uploads or generates for a site | Reviewed history kept |
| Activity | Append-only audit trail (who did what and when) | Cannot be edited, which matters for deletion requests |
| Server logs | IP address, security events (no emails, tokens or codes) | Kept by the hosting provider |

## Operators and sub-processors
Hosting and database provider; file storage provider; email delivery provider; payment provider (Paystack or Stripe; card numbers never reach COMVERA); Anthropic (AI drafting and expiry-date reading, called from the server only, and only when someone uses an AI feature). Please confirm: where each processes data (cross-border transfer rules, POPIA section 72), and what contract terms are needed with each.

## What the product already does
Role-based access with tenant isolation (tested); email confirmation; optional two-step sign-in; sign-out-everywhere; rate limits and lock-outs; uploads checked for type and viruses; data export for an organisation (`/api/org/export`); audit export as CSV; account deletion by the platform owner is scheduled (14 days), needs password plus a fresh code plus the typed name, and keeps a permanent ledger of what was deleted (without personal content).

## Questions for the lawyer
1. **Roles:** is each customer the responsible party and COMVERA an operator? Does the terms of use need a data processing agreement as an annexure? Who answers a worker's access or deletion request: the employer or COMVERA?
2. **Retention:** what retention periods apply to safety files, medical certificates, training records and attendance registers under the Mine Health and Safety Act, the OHS Act and related regulations? What should the product do at the end of a period (delete, archive, ask)? Today the audit trail is append-only and documents stay until the customer deletes them.
3. **Deletion requests:** how should the append-only audit trail (names of actors) and the permanent deletion ledger be treated? Is "keep for legal and security purposes" enough?
4. **Special personal information:** do uploaded medical certificates need explicit consent, or is the employer's legal obligation sufficient? Any extra safeguards?
5. **Cross-border transfers:** hosting, email and AI providers may process outside South Africa. What notice and contractual terms are needed?
6. **Security-compromise notification:** wording and timing of the notice to customers and the Information Regulator. We have alerting for error and sign-in spikes but no documented breach procedure yet.
7. **Terms of use:** liability limits, the statement that COMVERA records status and does not certify legal compliance, acceptable use, suspension, payment, cancellation and refund terms, governing law, the information officer's details.
8. **Cookies and storage:** the app uses one essential session cookie and no advertising or analytics cookies. Is a cookie notice needed?
9. **Marketing email:** the product sends only service email (invitations, reminders, notices). Confirm no marketing consent is needed for that.

## What to send back
Final text for `/privacy` and `/terms` (the pages are generated in `src/routes/legal.ts`; the owner can paste the approved text and we remove the draft banner), a data processing agreement template, and a retention schedule we can turn into settings.
