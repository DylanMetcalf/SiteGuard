# Parking lot

Ideas we are deliberately **not** building yet. Each gets revisited when there is customer evidence for it.

| Idea | Why not now | Revisit when |
|---|---|---|
| SAP integration (push readiness, pull diary/workforce) | Needs a customer running SAP and a defined data contract | A pilot mine asks for it |
| InspectX integration beyond deep links | No API available yet | InspectX exposes an API |
| Native iOS/Android apps | The web app works on phones; install as a PWA | Pilot shows offline or camera needs a PWA can't meet |
| Offline mode | Unknown whether connectivity is a real blocker | Pilot feedback from underground/remote sites |
| SSO / SAML | No enterprise buyer requirement yet | A buyer's IT policy requires it |
| Analytics dashboards (trends, benchmarks) | Needs real data volume | After several months of pilot data |
| AI beyond drafting and expiry detection (e.g. auto-reviewing documents) | Accuracy and liability questions | Drafting is proven useful in the pilot |
| Multiple languages | English is the working language on sites so far | A customer needs it |
| Saved assistant conversations and chat history | Nothing stored keeps POPIA scope small | Users ask to return to earlier answers |
| Streaming assistant replies (word by word) | A full reply in a few seconds is acceptable for now | Users find the wait too long with web research |
| AI-written summary of the compliance agent's findings (e.g. a weekly email) | The rule-based list is clear and free | Customers want a weekly management summary |
| Paystack / PayFast billing | Invoicing by EFT works for the first customers; Stripe is built in | Card payments become a sales blocker |
| Terms of service and privacy policy pages in the app | Needs an attorney's text first | Before the first paid customer |
| More Document Studio types (lift plan, traffic management plan, environmental management plan, incident investigation report, induction record) | The first 14 cover the starter packs; add by customer demand using the `add-document-blueprint` skill | Customers ask for them |
| Background research agent that refreshes blueprints from new legislation | Legal content changes need a person's review, not automatic edits | A monthly reviewed routine proposes changes as a pull request |
| Custom fonts in generated documents | Standard PDF fonts render everywhere and keep files small | A customer's brand guide requires it |
| Customer-editable template library (org-level templates) | Built-in packs + "copy from existing site" cover the need | Customers keep rebuilding the same custom lists |
