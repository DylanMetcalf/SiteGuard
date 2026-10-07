# Parking lot

Ideas we are deliberately **not** building yet. Each gets revisited when there is customer evidence for it.

| Idea | Why not now | Revisit when |
|---|---|---|
| SAP integration (push readiness, pull diary/workforce) | Needs a customer running SAP and a defined data contract | A pilot mine asks for it |
| InspectX integration beyond deep links | No API available yet | InspectX exposes an API |
| Native iOS/Android apps | The web app works on phones; install as a PWA | Pilot shows offline or camera needs a PWA can't meet |
| Offline mode (working on records without signal) | The app now installs and shows an offline page, but keeps no records on the device (simpler for POPIA) | Pilot feedback from underground/remote sites |
| SSO / SAML | No enterprise buyer requirement yet | A buyer's IT policy requires it |
| Analytics dashboards (trends, benchmarks) | Needs real data volume | After several months of pilot data |
| AI beyond drafting and expiry detection (e.g. auto-reviewing documents) | Accuracy and liability questions | Drafting is proven useful in the pilot |
| Multiple languages | English is the working language on sites so far | A customer needs it |
| Saved assistant conversations and chat history | Nothing stored keeps POPIA scope small | Users ask to return to earlier answers |
| Streaming assistant replies (word by word) | A full reply in a few seconds is acceptable for now | Users find the wait too long with web research |
| AI-written summary of the compliance agent's findings (e.g. a weekly email) | The rule-based list is clear and free | Customers want a weekly management summary |
| Paystack / PayFast billing | Invoicing by EFT works for the first customers; Stripe is built in | Card payments become a sales blocker |
| Final, attorney-approved privacy notice and terms | Draft pages at /privacy and /terms describe what the software does and are marked for legal review | Before the first paid customer |
| More Document Studio types (lift plan, traffic management plan, environmental management plan, incident investigation report, induction record) | The first 14 cover the starter packs; add by customer demand using the `add-document-blueprint` skill | Customers ask for them |
| Background research agent that refreshes blueprints from new legislation | Legal content changes need a person's review, not automatic edits | A monthly reviewed routine proposes changes as a pull request |
| Custom fonts in generated documents | Standard PDF fonts render everywhere and keep files small | A customer's brand guide requires it |
| Customer-editable template library (org-level templates) | Built-in packs + "copy from existing site" cover the need | Customers keep rebuilding the same custom lists |
| Phone push notifications for the inbox | In-app inbox and email cover it; push needs a service worker and user permission prompts | People use COMVERA daily on site and miss updates |
| Word files merged into the bound safety file | Converting .docx to PDF needs LibreOffice on the server; a placeholder page points to the file | Customers upload many Word documents |
| Tracked changes (redlines) in the review workspace | Section status + comments + revision history cover the need | Reviewers ask to see word-level changes |
| Inviting a project's client to take it over on COMVERA | Projects keep the client as a private record so this is possible later; it needs a claim flow and a decision on who owns the history | A client asks to review in COMVERA instead of by link |
| Inductions recorded by the mine itself (contractor-recorded site induction sessions already count at the gate) | Needs a mine-side induction register and a decision on who may record one; the mine's induction validity rule covers the risk for now | A mine wants to record its own inductions at the gate |
| Shared-device "field mode" (a locked, big-button screen for induction and attendance registers) | Toolbox talks already pass one device round for signatures; a separate kiosk mode needs a design for who is signed in on the device | A pilot site runs inductions on a tablet at the gate |
| Automatic document reading (extract type, dates, reference numbers with confidence) | Expiry-date detection exists with an AI key; wider extraction risks wrong compliance data without review | Uploads volume makes manual entry the main complaint |
| Contractor-branded compliance card (company-level, with logo) | Worker gate cards and the Site Ready verification page cover the gate and the auditor | A mine asks for a company card at the gate |
| An "evolution agent" that changes the product on its own | The owner's spec asks for a controlled loop, not self-modifying code. Today: in-app feedback, the compliance agent, and reviewed pull requests | Enough usage data to prioritise from |
| Guest reviewers editing a document | Only the author edits, which keeps ownership clear | Clients ask to co-author |
| Per-organisation data deletion on request (beyond removing members) | The audit trail is append-only; deleting needs a documented process for what must be kept | The first POPIA deletion request, or before the first paid customer |
| Platform admin actions (suspend a customer, extend a trial) | The overview is read-only on purpose; changes go through the database or Stripe for now | Running the service by hand becomes a burden |
| Platform-admin editable tool library (add tools, hazards and controls without a code change) | The 22 built-in tools cover common site work; editing hazard content needs review before it reaches documents | Customers ask for tools that aren't listed |
| One-off purchase of a single safety file, and usage-based pricing | Subscriptions and promo codes cover launch; the entitlement list makes per-file access possible later | Contractors ask to pay per file instead of monthly |
| Malware scanning of uploads | Uploads are type- and size-checked and served from access-controlled URLs; a scanner (e.g. ClamAV or the storage provider's) is an infrastructure add-on | Before opening uploads to the public at scale |
| AI research of a specific site (public information about a mine or project) | Public information is not authoritative and site hazards must not be invented; research today covers regulations and standards only, and the user reviews every draft | A customer supplies site documents to work from |
| Inviting workers to a scheduled induction by email/SMS | Sessions can be scheduled and are signed on the day; invitations need worker contact details and consent | A pilot site runs scheduled inductions |
| Separate staging environment | One production service is enough for the pilot; Render can clone the service and database when needed (see OPERATIONS.md) | Before the first paying customer's data is live |
| Exchange: pick files from a recipient's own COMVERA library when answering a request (instead of uploading) | Uploading works for everyone; linking libraries across workspaces needs its own consent design | Contractors with workspaces ask for it |
| Exchange: file an approved submission straight into the mine's records (e.g. as the worker's certificate on a site) | The mine keeps its copy in the exchange; automatic filing needs matching rules | Mines ask to skip re-filing |
| Exchange: SMS/WhatsApp delivery of the link or code | Email is the verified channel; phone numbers are stored for contact only | Recipients without reliable email |
| Exchange: plan limits or pricing for heavy exchange use | No evidence yet of how much it's used | Usage data from the platform overview |
