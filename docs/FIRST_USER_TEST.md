# First-user test: one sitting, no coaching

Use this for your mom, a consultant, or a site contact. It takes about 30 minutes. The point is to learn where a stranger hesitates, so **do not explain the screens, do not point, do not rescue**. If they are stuck for more than two minutes, write down where, then say "what would you do if I weren't here?".

## Before they arrive (you)
- [ ] The app is deployed and `COMVERA_URL=… npm run smoke` passes.
- [ ] Decide the account. First session: let them use **Explore the demo** (made-up data, kept for 30 days, nothing real at risk). For a real second session: a fresh sign-up with their own work email.
- [ ] Have a phone and a laptop available; ask which they would normally use and start there.
- [ ] Have a notepad. You are only writing, not talking.
- [ ] Do **not** give them real certificates, ID numbers or medicals until the privacy notice and terms have been approved by the lawyer.

## What you say
"This is a tool for safety files on mines. I'd like you to try a few things and think out loud. You can't break anything, and nothing here is being judged except the tool. I'm not going to help, because I want to see what a new person sees."

## The eight tasks (read one at a time; never show the list)
| # | Task (say it in these words) | Done when | Watch for |
|---|---|---|---|
| 1 | "Without clicking anything, tell me what you think this is for." | They describe contractor safety files, in their own words, in under 20 seconds | Do they mention contractors, mines or documents? Do they ask "is this for me?" |
| 2 | "Create an account for your company." (consultant: "…for your consulting business.") | They reach the dashboard | Which type card do they pick? Do they finish set-up or give up? Time taken |
| 3 | "Add a mine you work with, or a client company you look after." (contractor: join a site with the code you gave them; consultant: add a client company) | A site or client is on screen | Confusion between "create", "join" and "add" |
| 4 | "Find out what that mine needs from you." | They open a site and read its requirements | Do they find the list? Do they understand required vs optional? |
| 5 | "Add a document that answers one of those." | A document is uploaded against a requirement | Where they look for the upload; any error message wording |
| 6 | "The mine has sent something back. What does it want?" (use a prepared correction on a demo document) | They read the comment and respond | Do they understand the status words (Missing, In review, Approved)? |
| 7 | "How ready is this file? What's still missing?" | They find readiness or the Today card | Do they trust the number? What do they check it against? |
| 8 | "You're stuck. Where would you go for help?" | They find Oscar, the walkthrough or Report a problem | Do they look for help at all? Do they find it? |

Then, once, at the end: "Would you use this next week? What would stop you?"

## Capture (write while they work)
- **Confusion**: the exact words they said or the screen they stared at, and the task number.
- **Errors**: the message on screen (a photo is fine).
- **Missing**: things they reached for that were not there.
- **Delight**: anything they said "oh nice" about.
- **Time per task** and whether they finished it alone.
- Three numbers: tasks finished without help (out of 8), the one screen that confused them most, and "would use next week" (yes / maybe / no, and why).

## Feedback inside the product
They can use **More → Report a problem** at any time; it attaches the screen they were on. Ask them to use it once at the end even if nothing is wrong, so you can see the whole path works.

## After
Within 24 hours: write the three numbers and the top five confusions in one place. Fix anything that stopped a task before the next tester. If two people stumble on the same screen, it is a product problem, not a user problem.

## What a good result looks like (targets to aim for, not facts)
- 6 of 8 tasks finished without help.
- Task 1 understood in under 20 seconds.
- Sign-up to dashboard in under 5 minutes.
- At least "maybe, if…" with a reason you can act on.
