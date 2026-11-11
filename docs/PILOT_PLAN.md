# First-mine pilot: a supervised shift with a real contractor and real documents

## Before the day (about a week ahead)
- [ ] Staging checks in `STAGING.md` passed; production backup restore drill passed in the last month (`OPERATIONS.md`).
- [ ] The privacy notice and terms are the lawyer-approved text, or the mine has signed a pilot agreement that says the drafts apply.
- [ ] The mine's safety officer and one contractor administrator have accounts; nobody else yet.
- [ ] The mine has chosen **one** site and **three** documents it wants contractors to submit (for example: induction form, risk assessment, medical certificate register).
- [ ] The contractor has chosen **two** real workers and their real certificates (scans or photos).
- [ ] Alert emails go to a monitored address (`PLATFORM_ADMIN_EMAILS`), and someone is on call during the shift.
- [ ] Agree what "success" means (below) and how feedback is captured.

## The day
1. **Morning (30 min):** walk the mine's safety officer through the interactive walkthrough (`/walkthrough`), then have them sign up, finish guided set-up, create the site and upload the three documents, marking them as required.
2. **Contractor (30 min):** the contractor joins with the site code, downloads each required form, fills it in, uploads the completed copy with the worker certificates, and submits.
3. **Review (20 min):** the safety officer reviews the submissions, approves one, asks for a correction on another.
4. **Gate (15 min):** use the public gate check page for one of the two workers; confirm it shows no ID numbers or certificates.
5. **Shift change test (10 min):** have 10+ people on site sign in within a minute from the site network (this is what the shared-address limits were changed for).
6. **Wrap-up (20 min):** ask the five questions below. Download the audit trail as a spreadsheet and check it matches what happened.

## What we measure
- Time from "contractor joins" to "first submission reviewed".
- Number of times someone got stuck and asked for help (write down where).
- Any error message shown to a user, and whether the host's log has a matching line.
- Whether the audit export reads sensibly to an inspector.
- Slow pages (anything over 3 seconds), on the site's actual phones and network.

## Five questions for the participants
1. What did you expect to see that was not there?
2. Where did you hesitate?
3. What would you not trust yet with real documents?
4. What did you do on paper or WhatsApp instead that COMVERA should do?
5. Would you use it next week? What would stop you?

## After
Write down findings the same day; fix anything that blocked a task before the second site; delete nothing the mine uploaded without their say-so. Review alert emails and the host's logs for the day. Decide go / fix first / stop with the mine's safety officer.

## Needed from the mine (cannot be done for them)
A named safety officer and a contractor willing to take part; permission to use real documents; a signed pilot agreement; agreement on who may see which documents (internal, restricted, contractors).
