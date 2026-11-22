// The one next step: a small card at the top of the dashboard, worked out from what is actually in the workspace
// (sites, requirements, contractors, submissions, documents) and the person's role. It never stores a status and never
// offers an action the person cannot take; once a step is done it simply moves on to the next one.
import { S, ICONS, on, render, isHost, isOrgAdmin, canReview, readOnly, effectiveStatus, libraryReqId, myContractorId, LIBRARY_TYPES } from './core.js';

const card = (title, why, button) => '<div class="card next-step" role="region" aria-label="Your next step"><div class="next-step-label">Your next step</div>'
  + '<div class="next-step-row"><div style="flex:1;min-width:0;"><h2>' + title + '</h2><p class="site-card-sub">' + why + '</p></div>' + button + '</div></div>';
const btn = (label, action, extra) => '<button class="btn primary" data-action="' + action + '"' + (extra || '') + '>' + label + '</button>';

/** Returns the card, or '' when nothing is outstanding (the Today card then shows the day's work). */
export function nextStepCard(){
  if(readOnly() || !S.state) return '';
  const st = S.state, me = S.boot.me || {};
  const sites = Object.values(st.sites || {}), wps = Object.values(st.workplaces || {}).filter((w) => !w.archivedAt);
  const docs = st.documents || {};
  const invited = sites.filter((s) => s.status === 'invited');

  if(isHost()){
    const files = sites.filter((s) => s.status !== 'declined');
    const waiting = files.reduce((n, s) => n + (st.requirements[s.id] || []).filter((r) => effectiveStatus(docs[r.id]) === 'awaiting_review').length, 0);
    if(canReview() && waiting) return card(waiting + ' document' + (waiting === 1 ? '' : 's') + ' waiting for your review', 'Contractors have submitted evidence. Approve it, or send it back with a reason.', btn('Review now', 'open-tasks', ' data-filter="all"'));
    if(!isOrgAdmin()) return me.purpose === 'review' && canReview() ? card('No reviews waiting', 'When a contractor submits a document for one of your sites, it appears here first.', btn('See sites', 'nav', ' data-nav="sites"')) : '';
    if(!wps.length && !files.length) return card('Create your first site', 'A site is where contractors file their safety documents. Name it, and choose what every contractor must provide.', btn(ICONS.plus + ' Create site', 'new-site'));
    const bare = wps.find((w) => !(w.requirements || []).length);
    if(bare) return card('Set what contractors must provide at ' + bare.name, 'Choose the documents every contractor’s safety file needs. Start from a researched South African list and change anything.', btn('Set requirements', 'ns-open-wp', ' data-id="' + bare.id + '" data-tab="requirements"'));
    const withoutContractors = wps.find((w) => !files.some((s) => s.workplaceId === w.id));
    if(withoutContractors) return card('Invite your first contractor to ' + withoutContractors.name, 'Share the site code, or invite a contractor by email. Each contractor gets its own file for your site.', btn('Invite a contractor', 'ns-open-wp', ' data-id="' + withoutContractors.id + '" data-tab="contractors"'));
    return '';
  }

  // Contractor or consultant
  if(invited.length) return card('Open the site you’ve been invited to', invited[0].hostName + ' invited ' + S.boot.org.name + ' to ' + invited[0].name + '. Accept to see what they need from you.', btn('Open invitation', 'open-site', ' data-site="' + invited[0].id + '"'));
  if(S.boot.org.isConsultant) return '';
  const cid = myContractorId();
  const hasLibrary = cid && LIBRARY_TYPES.some((t) => { const d = docs[libraryReqId(cid, t.id)]; return d && d.version; });
  if(isOrgAdmin() && !hasLibrary) return card('Add your company’s compliance documents', 'Registration, COID letter, insurance and policies are kept once and reused in every safety file, with expiry reminders.', btn(ICONS.upload + ' Upload a document', 'upload-document'));
  const files = sites.filter((s) => s.status !== 'invited' && s.status !== 'declined');
  if(isOrgAdmin() && !files.length) return card('Create your first safety file', 'For a site on COMVERA (with its code) or for a client who isn’t on COMVERA.', btn(ICONS.passport + ' Create safety file', 'sfb-start'));
  return '';
}

on('ns-open-wp', (el) => { S.nav = 'sites'; S.activeSiteId = null; S.activeWorkplaceId = el.dataset.id; S.wpTab = el.dataset.tab || 'contractors'; render(); window.scrollTo(0, 0); });
