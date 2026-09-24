# Decisions

A short log of product and technical decisions, so we don't revisit them without a reason.
Newest first.

---

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
