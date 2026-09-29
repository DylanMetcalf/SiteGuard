# Decisions

A short log of product and technical decisions, so we don't revisit them without a reason.
Newest first.

---

**DECISION** A site that many contractors join is a new `workplaces` record; each contractor's file for it stays an ordinary `sites` row.
**REASON** Mines run one site with many contractors, each with its own safety file. Keeping the per-contractor file as the existing site record means review, the builder, exports, permits, readiness and every permission check keep working unchanged, and the change is purely additive (no existing data moves). Single emailed invitations still work.
**DATE** 2026-09-29

**DECISION** The general safety file lists follow published sources (Construction Regulations 2014, OHS Act, MHSA, a mining house's published contractor procedure) and cite a regulation only where it is certain.
**REASON** Customers rely on the list; a wrong regulation number would undermine trust. Everything else is labelled best practice or client requirement, and every item stays editable per site.
**DATE** 2026-09-29

**DECISION** Once a contractor has joined, its company details are read-only to the mine and come from the contractor's own account.
**REASON** The contractor is responsible for its own registration, COID and contact details; letting the mine overwrite them would make the record unreliable and blur accountability. The mine can still correct the name or email it invited with until the contractor joins.
**DATE** 2026-09-29

**DECISION** Company documents (COID, insurance, CIPC, tax, policies) are uploaded once and submitted to sites from there.
**REASON** Contractors were uploading the same letter to every site, and a copy saved only in the library looked "done" while the site still showed it missing. Matching by requirement name keeps it automatic; each site still reviews and approves its own copy.
**DATE** 2026-09-29

**DECISION** Approving a single section doesn't notify the author; changes do, and so does the last approval.
**REASON** One review produced a notification per section, burying the ones that need action.
**DATE** 2026-09-29

**DECISION** Only never-submitted Studio documents can be deleted.
**REASON** Anything a site has seen is part of its record; a new revision replaces it instead.
**DATE** 2026-09-29

**DECISION** Section approvals are keyed by a hash of the section's content, not by revision.
**REASON** When an author fixes one section, the reviewer should only re-read that section. Hashing the content means unchanged sections keep their approval automatically, with no diffing or manual carry-over.
**DATE** 2026-09-27

**DECISION** Notifications are in-app only (plus the existing emails); no push notifications yet.
**REASON** The inbox covers "the person on site knows" without app-store apps or push-service accounts. Browser push can be added once people use the app daily on site.
**DATE** 2026-09-27

**DECISION** Join codes live on the site's invitation, not as a separate way to link companies.
**REASON** One acceptance path (email link or code) means the same checks, audit and notifications, and a code can't connect a contractor to a site that never invited anyone.
**DATE** 2026-09-27

**DECISION** The Safety File Builder runs in the browser, calling the existing endpoints one document at a time.
**REASON** No new server surface to secure; every rule (roles, limits, tenancy) still applies, and one failed document never undoes the others.
**DATE** 2026-09-27

**DECISION** The bound safety file uses pdf-lib to merge PDFs.
**REASON** Small, dependency-free, MIT-licensed and widely used; pdfmake can create PDFs but not merge existing ones.
**DATE** 2026-09-27

**DECISION** Rebrand to deep navy and sage with softer, card-based UI and self-hosted fonts (Onest, JetBrains Mono).
**REASON** Orange/grey is common among competitors; navy signals trust and professionalism to mining buyers, sage gives a distinctive, calm accent. Self-hosting fonts removes a third-party request (privacy, speed, reliability). Colours are tokens, so the palette can still change in one place.
**DATE** 2026-09-27

**DECISION** Document Studio writes documents from our own blueprints (original content) plus AI tailoring, not by copying published templates.
**REASON** Other companies' templates are copyrighted and of unknown quality. Our blueprints follow the structure SHE departments expect, cite only legal references we are sure of, and are reviewed in code; the AI tailors them to the job and can research a site's published requirements at generation time.
**DATE** 2026-09-27

**DECISION** Documents are generated server-side as PDF (pdfmake, standard fonts) and Word (docx) from one document model.
**REASON** PDF is what gets submitted and printed; Word lets SHE managers edit. One model keeps both identical, avoids a headless browser on the server, and lets the AI's output be validated before rendering.
**DATE** 2026-09-27

**DECISION** Launch on Render (Frankfurt) from the `render.yaml` blueprint, with uploads on an attached disk instead of S3/R2.
**REASON** A non-technical founder can deploy it in one click with no code; one bill, daily disk snapshots and managed Postgres backups. The trade-off is a single app instance and no zero-downtime deploys, which is fine for a pilot. Move files to R2 (`STORAGE_DRIVER=s3`) and scale out when customers need it; Fly.io Johannesburg or AWS Cape Town remain the options for in-country hosting.
**DATE** 2026-09-27

**DECISION** AI features degrade to built-in rules and templates when no API key is set, instead of being hidden.
**REASON** The product must be demo-able and sellable before the founder has an AI account, and must keep working during an AI outage or once an organisation's monthly allowance is used. The same starter packs and work-type knowledge (`src/lib/knowledge.ts`) back both modes.
**DATE** 2026-09-27

**DECISION** The assistant is read-only: it proposes (site, checklist, draft) and the user confirms through the normal, permission-checked endpoints. Its tools can only read the caller's own organisation's data.
**REASON** Keeps every write under the existing authorisation and audit rules, and means a prompt injection in a web page can't change customer data.
**DATE** 2026-09-27

**DECISION** The compliance agent is rule-based and deterministic, not AI-driven.
**REASON** Findings about expiries, reviews and incidents must be exact and explainable, cost nothing to run every 15 minutes, and work without an AI key.
**DATE** 2026-09-27

**DECISION** Assistant conversations are not stored on the server; the browser tab holds the conversation.
**REASON** No new personal data to secure or retain under POPIA until customers show they want chat history.
**DATE** 2026-09-27

**DECISION** Requirement templates ship as built-in, editable starter packs; a site copies a pack at creation.
**REASON** A new mine otherwise types every requirement by hand — the slowest step in onboarding. Copying (rather than linking) keeps each site's requirements stable when a pack changes.
**DATE** 2026-09-24

**DECISION** The prototype-only `main` was merged into the SaaS branch; the prototype lives on in `reference/artifact-mvp/`.
**REASON** The branches had no shared history, which GitHub can't review as a pull request. The files were byte-identical to the reference copy.
**DATE** 2026-09-24

**DECISION** Built-in email/password auth rather than a hosted provider (Clerk, Auth0).
**REASON** No third-party account needed to run or test it; sessions are revocable server-side. SSO/2FA can be added on the same session layer when a customer needs them.
**DATE** 2026-09-23

**DECISION** Keep the prototype's UI (vanilla JS, no build step); the server sends each user a view shaped like the prototype's state.
**REASON** Reuses the finished UX and design system instead of a rewrite. Revisit a UI framework only if the front end becomes hard to change.
**DATE** 2026-09-23

**DECISION** Node/TypeScript + Fastify + Postgres (raw SQL), one deployable image.
**REASON** Simple to run and host; Postgres also provides live-update notifications and job locking, so no Redis or queue is needed yet.
**DATE** 2026-09-23

**DECISION** Contractors are separate tenants; a host's contractor record links to the contractor's organisation when it accepts an invitation.
**REASON** One contractor company serves many mines and must see only its own sites at each.
**DATE** 2026-09-23

**DECISION** Contractors use SiteGuard free; mines pay per seat after a 14-day trial.
**REASON** Contractor adoption is what makes the product useful to the paying mine. (Pricing to be validated in the pilot.)
**DATE** 2026-09-23
