// Plans & billing page: what you are on, what you are using, and what each plan would change.
// Pure rendering from GET /api/billing (the server decides everything; this only explains it).
// Strings from the billing response are NOT pre-escaped, so everything goes through escapeHtml.

import { ICONS, escapeHtml, timeAgo } from './core.js';

const rands = (c) => 'R' + (c / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

/** True once the server itself shows the paid plan: never on the strength of a redirect alone. */
export function paymentConfirmed(b){
  return (b.hasSubscription && b.status === 'active') || (!!b.grant && !b.pendingPayment);
}

/** Plain-language status: { tone: ok|info|warn|bad, title, text }. */
export function describeStatus(b, isContractor){
  if(b.coveredByConsultant) return { tone: 'ok', title: 'Covered by your consultant', text: 'Your consultant\'s plan covers this company, so it needs no plan of its own.' };
  if(b.grant){
    return { tone: 'ok', title: 'Plan given by COMVERA', text: (b.grant.until ? 'Free until ' + timeAgo(b.grant.until) + '.' : 'No end date.') + ' No payment is needed while this lasts.' + (b.grant.until ? ' After that, choose a plan to keep making changes.' : '') };
  }
  if(isContractor && !b.ownAccess){
    return b.sponsored
      ? { tone: 'info', title: 'Sponsored files only', text: 'You have no plan of your own. You can work free on files of sites that sponsor you; your own projects and other clients need a contractor plan.' }
      : { tone: 'bad', title: 'No plan, and no site is sponsoring you', text: 'Everything stays readable, but you cannot make changes until you choose a plan or a site sponsors you.' };
  }
  if(b.status === 'trialing' && b.trialEndsAt){
    if(new Date(b.trialEndsAt) > new Date()){
      const n = daysLeft(b.trialEndsAt);
      return { tone: 'info', title: 'Free trial', text: 'Your trial ends on ' + timeAgo(b.trialEndsAt) + ' (' + plural(n, 'day') + ' left). Nothing has been charged. Choose a plan before then to keep making changes.' };
    }
    return { tone: 'bad', title: 'Trial ended', text: 'Your trial ended on ' + timeAgo(b.trialEndsAt) + '. Everything stays readable; choose a plan to make changes again.' };
  }
  if(b.status === 'past_due') return { tone: 'warn', title: 'Payment failed', text: 'We could not take your last payment. Update your card to avoid interruption.' };
  if(b.status === 'active' && (b.hasSubscription || b.currentPeriodEnd)){
    return { tone: 'ok', title: 'Active', text: b.currentPeriodEnd ? 'Renews on ' + timeAgo(b.currentPeriodEnd) + '.' : 'Your subscription is active.' };
  }
  if(b.status === 'active' || b.status === 'free') return { tone: 'ok', title: b.status === 'free' ? 'Free' : 'Active', text: 'Your plan is in good standing.' };
  if(b.status === 'canceled') return { tone: 'bad', title: 'Cancelled', text: 'Your subscription has ended. Everything stays readable; choose a plan to make changes again.' };
  if(b.standing === 'lapsed') return { tone: 'bad', title: 'Inactive', text: 'Your plan is not active. Everything stays readable; choose a plan to make changes again.' };
  return { tone: 'info', title: String(b.status || 'Not set'), text: '' };
}

/* ---------- Usage ---------- */
function meter(label, used, limit, hint, opts){
  opts = opts || {};
  const over = limit != null && used > limit, full = limit != null && limit > 0 && used === limit;
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const tone = over ? 'bad' : full || (limit && ratio >= 0.8) ? 'warn' : 'ok';
  const numText = limit == null ? escapeHtml(String(used)) + ' <span class="muted">(no limit)</span>' : used + ' of ' + limit;
  return '<div class="usage-row"><div class="usage-top"><span class="usage-label">' + label + '</span><span class="usage-num ' + tone + '">' + numText + (over ? ' · over' : full ? ' · full' : '') + '</span></div>'
    + (limit != null && limit > 0 ? '<div class="meter ' + tone + '" role="progressbar" aria-label="' + escapeHtml(opts.aria || label) + '" aria-valuemin="0" aria-valuemax="' + limit + '" aria-valuenow="' + Math.min(used, limit) + '"><span style="width:' + Math.round(ratio * 100) + '%"></span></div>' : '')
    + '<div class="usage-hint">' + hint + '</div></div>';
}

/** Every number is the account's own, from the server. Returns { html, pressure } where pressure lists limits at or near their cap. */
export function usageBlock(b, isContractor){
  const cur = b.plans.find((p) => p.id === b.plan) || {};
  const rows = [], pressure = [];
  rows.push(meter('Team logins (seats)', b.seatsUsed, b.seatLimit,
    'People who can sign in to ' + 'your organisation, including invitations not yet accepted. Worker records are separate and never use a seat.', { aria: 'Team logins used' }));
  if(b.seatLimit && b.seatsUsed / b.seatLimit >= 0.8) pressure.push({ kind: 'seats', used: b.seatsUsed, limit: b.seatLimit });
  if(b.activeSites != null){
    const lim = cur.siteLimit == null ? null : cur.siteLimit;
    rows.push(meter('Sites', b.activeSites, lim, 'Each active site counts once. A site\'s contractors are covered by the site\'s plan.'));
    if(lim && b.activeSites / lim >= 0.8) pressure.push({ kind: 'sites', used: b.activeSites, limit: lim });
  }
  if(b.connectedSites != null && !b.isConsultant){
    const lim = cur.connectedSiteLimit == null ? null : cur.connectedSiteLimit;
    const sp = b.sponsoredSites || 0;
    rows.push(meter('Connected sites', b.connectedSites, lim === 0 ? null : lim,
      'Safety files you pay for: your own projects and clients\' sites. '
      + (sp ? plural(sp, 'file') + ' at sites that sponsor you ' + (sp === 1 ? 'is' : 'are') + ' free and not counted.' : 'Files at sites that sponsor you are free and not counted.'), { aria: 'Connected sites used' }));
    if(lim && b.connectedSites / lim >= 0.8) pressure.push({ kind: 'connected', used: b.connectedSites, limit: lim });
  }
  rows.push('<div class="usage-row"><div class="usage-top"><span class="usage-label">Worker records</span><span class="usage-num ok">' + escapeHtml(String(b.workers || 0)) + ' <span class="muted">(no limit)</span></span></div><div class="usage-hint">People on your sites (medicals, inductions, training). They do not sign in and do not use a seat.</div></div>');
  return { html: '<div class="card usage-card">' + rows.join('') + '</div>', pressure };
}

/** A recommendation only when real usage is at or near a limit, with the reason in one sentence. */
export function recommendation(b, pressure){
  if(!pressure.length || b.grant) return null;
  const order = b.plans.filter((p) => p.paid && !p.once && p.priceCents != null).sort((a, c) => a.priceCents - c.priceCents);
  const cur = b.plans.find((p) => p.id === b.plan);
  const curIdx = order.findIndex((p) => p.id === b.plan);
  const higher = curIdx >= 0 ? order.slice(curIdx + 1) : order;
  for(const pr of pressure){
    let target = null, reason = '';
    if(pr.kind === 'seats'){
      // Seats can be added on the same plan; only point at a bigger plan when this plan's maximum is nearly reached.
      if(cur && cur.maxSeats && pr.used / cur.maxSeats >= 0.8){
        target = higher.find((p) => p.maxSeats > cur.maxSeats);
        if(target) reason = 'You use ' + pr.used + ' of the ' + cur.maxSeats + ' team logins ' + cur.name + ' allows; ' + target.name + ' allows ' + target.maxSeats + '.';
      }
    } else if(pr.kind === 'sites'){
      target = higher.find((p) => p.siteLimit == null || p.siteLimit > pr.limit);
      if(target) reason = 'You use ' + pr.used + ' of ' + pr.limit + ' ' + (pr.limit === 1 ? 'site' : 'sites') + '; ' + target.name + ' covers ' + (target.siteLimit == null ? 'every site' : 'up to ' + target.siteLimit) + '.';
    } else if(pr.kind === 'connected'){
      target = higher.find((p) => p.connectedSiteLimit == null || p.connectedSiteLimit > pr.limit);
      if(target) reason = 'You use ' + pr.used + ' of ' + pr.limit + ' connected sites; ' + target.name + ' covers ' + (target.connectedSiteLimit == null ? 'any number' : 'up to ' + target.connectedSiteLimit) + '.';
    }
    if(target) return { planId: target.id, reason };
  }
  return null;
}

/* ---------- Pieces ---------- */
export function returnNotice(b, ret, refreshing){
  if(!ret) return '';
  if(ret === 'failed') return '<div class="notice bad" role="alert"><strong>Your payment was not accepted.</strong> Nothing has been charged and your plan has not changed. You can try again below, or use another card.</div>';
  if(ret === 'cancelled') return '<div class="notice" role="status">Checkout cancelled. Nothing was charged and your plan has not changed.</div>';
  const latest = (b.history || [])[0];
  const failed = latest && ['failed', 'abandoned'].includes(latest.status) && Date.now() - new Date(latest.created_at).getTime() < 6 * 3600e3;
  if(paymentConfirmed(b)) return '<div class="notice ok" role="status"><strong>Payment confirmed.</strong> Your plan is now ' + escapeHtml((b.plans.find((p) => p.id === b.plan) || {}).name || b.plan) + '.</div>';
  if(failed) return '<div class="notice bad" role="alert"><strong>Your payment was not accepted.</strong> Nothing has been charged and your plan has not changed. You can try again below, or use another card.</div>';
  return '<div class="notice warn" role="status"><strong>Waiting for confirmation from your payment provider.</strong> Your plan has not changed yet; it switches as soon as the payment is confirmed. This usually takes under a minute.'
    + '<div style="margin-top:8px;"><button class="btn secondary small" data-action="billing-refresh"' + (refreshing ? ' disabled' : '') + '>' + (refreshing ? 'Checking…' : 'Check again') + '</button></div></div>';
}

function statusCard(b, isContractor, admin){
  const cur = b.plans.find((p) => p.id === b.plan);
  const st = describeStatus(b, isContractor);
  const price = cur && cur.priceCents != null && cur.paid ? rands(cur.priceCents) + (cur.once ? ' once-off' : ' / ' + escapeHtml(cur.per)) : '';
  let h = '<div class="card plan-now ' + st.tone + '"><div class="plan-now-top"><div><div class="plan-now-label">Current plan</div><div class="plan-now-name">' + escapeHtml(cur ? cur.name : b.plan) + '</div></div>'
    + '<span class="status-pill ' + st.tone + '">' + escapeHtml(st.title) + '</span></div>'
    + (st.text ? '<p class="plan-now-text">' + escapeHtml(st.text) + '</p>' : '')
    + (price ? '<div class="site-card-sub">' + price + '</div>' : '');
  if(admin){
    const btns = [];
    if(b.hasSubscription || b.paystackSubscription || b.hasCustomer) btns.push('<button class="btn secondary small" data-action="billing-portal">' + (b.provider === 'paystack' ? 'Update card' : 'Payment method &amp; invoices') + '</button>');
    if(b.status === 'past_due') btns.unshift('<button class="btn primary small" data-action="billing-portal">Update card</button>');
    if(btns.length) h += '<div class="row-actions" style="margin-top:12px;">' + btns.join('') + '</div>';
  }
  return h + '</div>';
}

function planCard(b, p, o){
  const isCur = p.id === b.plan && (b.ownAccess || b.status !== 'trialing' || !p.paid);
  const onTrial = p.id === b.plan && b.status === 'trialing' && !b.hasSubscription && !b.grant && p.paid;
  const cur = b.plans.find((x) => x.id === b.plan);
  const paystack = b.provider === 'paystack';
  const subscribed = paystack ? b.paystackSubscription : b.hasSubscription;
  const price = !p.paid ? '<span class="plan-price">Free</span>' : p.priceCents != null ? '<span class="plan-price">' + rands(p.priceCents) + '</span><span class="plan-per">' + (p.once ? 'once-off' : (b.provider === 'stripe' ? '/ seat / ' : '/ ') + escapeHtml(p.per)) + '</span>' : '<span class="plan-price sm">Contact us</span>';
  const facts = [];
  if(p.clientLimit) facts.push('Up to ' + p.clientLimit + ' client companies');
  else if(p.siteLimit != null) facts.push(p.siteLimit === 1 ? '1 site' : 'Up to ' + p.siteLimit + ' sites');
  else if(p.connectedSiteLimit != null && p.paid) facts.push(p.connectedSiteLimit === 1 && p.once ? '1 safety file' : 'Up to ' + p.connectedSiteLimit + ' connected sites');
  else if(!p.paid) facts.push('Sites that sponsor you, free');
  else facts.push('Every site in your group');
  if(p.paid) facts.push(paystack || p.once ? 'Up to ' + p.maxSeats + ' team logins' : 'Up to ' + p.maxSeats + ' team logins (seats)');
  else facts.push('Up to ' + p.maxSeats + ' team logins');
  let action = '', note = '';
  if(!o.admin){
    action = '';
  } else if(isCur && !onTrial){
    if(!paystack && b.hasSubscription && p.paid) action = '<button class="btn secondary small block" data-action="billing-choose" data-plan="' + p.id + '">Update seats</button>';
  } else if(p.paid){
    const up = cur && cur.priceCents != null && p.priceCents != null ? (p.priceCents > cur.priceCents ? 'Upgrade' : p.priceCents < cur.priceCents ? 'Downgrade' : 'Switch') : 'Switch';
    const verb = !subscribed || onTrial ? 'Subscribe' : up + ' to ' + escapeHtml(p.name);
    const label = p.once ? 'Pay once' : verb + (verb === 'Subscribe' ? ' to ' + escapeHtml(p.name) : '');
    if(p.once && paystack && b.paystackSubscription) action = '<div class="plan-note">A once-off file can\'t be bought while a subscription is active.</div>';
    else if(p.purchasable) action = '<button class="btn ' + (o.recommended || !subscribed ? 'primary' : 'secondary') + ' small block" data-action="' + (paystack ? 'paystack-checkout' : 'billing-choose') + '" data-plan="' + p.id + '">' + label + '</button>';
    else action = '<a class="btn secondary small block" href="/contact" target="_blank" rel="noopener">Contact us' + (b.payments ? '' : ' to subscribe') + '</a>';
    if(subscribed && !onTrial && p.purchasable && !p.once){
      note = up === 'Upgrade' ? 'Starts now. You pay only the difference for the rest of this period (prorated).'
        : up === 'Downgrade' ? 'Starts now. You must be within ' + escapeHtml(p.name) + '\'s limits first; if you are over, we will say what to archive.'
        : '';
      if(paystack) note = 'Starts the new plan and stops the old one.';
    }
  }
  return '<div class="plan-card2' + (isCur && !onTrial ? ' current' : '') + (o.recommended ? ' recommended' : '') + '">'
    + '<div class="plan-card2-top"><h3 class="plan-name">' + escapeHtml(p.name) + '</h3>'
    + (isCur && !onTrial ? '<span class="badge approved">Current plan</span>' : onTrial ? '<span class="badge sage">Your trial plan</span>' : o.recommended ? '<span class="badge expiring">Suggested</span>' : '') + '</div>'
    + '<div class="plan-price-row">' + price + '</div>'
    + '<ul class="plan-facts">' + facts.map((f) => '<li>' + ICONS.check + '<span>' + escapeHtml(f) + '</span></li>').join('') + '</ul>'
    + '<p class="plan-blurb">' + escapeHtml(p.blurb) + '</p>'
    + (p.features && p.features.length ? '<details class="plan-more"><summary>What\'s included</summary><ul>' + p.features.map((f) => '<li>' + escapeHtml(f) + '</li>').join('') + '</ul></details>' : '')
    + (action ? '<div class="plan-action">' + action + (note ? '<div class="plan-note">' + note + '</div>' : '') + '</div>' : '')
    + '</div>';
}

function glossary(b, isContractor){
  const li = (t, d) => '<li><strong>' + t + '</strong> ' + d + '</li>';
  const items = [
    li('Team logins (seats):', 'people who sign in to your organisation, plus invitations not yet accepted. You pay by seat' + (b.provider === 'paystack' ? ' limit of the plan' : '') + '.'),
    li('Worker records:', 'people on your sites whose medicals and inductions you track. They never sign in, so they never use a seat.'),
  ];
  if(isContractor && !b.isConsultant){
    items.push(li('Connected sites:', 'safety files you pay for: your own projects and clients\' sites. A site that sponsors your file pays for it, so that file is free and not counted.'));
    items.push(li('Sponsored sites:', 'sites that subscribe and cover your file there. If the site stops, that file moves onto your own plan (or becomes read-only).'));
  } else if(!isContractor){
    items.push(li('Sites:', 'each active site counts once. Contractors you sponsor are free to them and do not use your seats.'));
  }
  return '<details class="card glossary"><summary>What do these terms mean?</summary><ul>' + items.join('') + '</ul></details>';
}

function consequences(b){
  const ps = b.provider === 'paystack';
  return '<div class="card consequences"><div class="site-card-title" style="font-size:14px;">Before you change your plan</div><ul>'
    + '<li><strong>Upgrade:</strong> ' + (ps ? 'the new plan starts once Paystack confirms the payment.' : 'starts straight away; you pay only the difference for the rest of the period (prorated).') + '</li>'
    + '<li><strong>Downgrade:</strong> ' + (ps ? 'switching starts the new plan and stops the old one.' : 'starts straight away.') + ' Your usage must fit the smaller plan\'s limits. If it does not, the change is refused until you archive or remove enough, and your records are never deleted.</li>'
    + '<li><strong>Cancel:</strong> ' + (ps ? 'you keep what you paid for until the end of the month.' : 'from “Payment method &amp; invoices”.') + ' Your data stays readable; you just cannot make changes until you choose a plan.</li>'
    + '</ul></div>';
}

/** The whole page. `promo` is the promo-code card; `ret` is S.billingReturn; `refreshing` disables the refresh button. */
export function renderBillingPage(b, o){
  const { isContractor, admin, promo, ret, refreshing, orgName } = o;
  let html = '<div class="view-head"><h1>Plans &amp; billing</h1><p>' + orgName + ' · see what you are on, what you use, and what each plan changes.</p></div>';
  if(!b.enabled) return html + '<div class="card"><div class="site-card-sub">Billing isn\'t configured on this server, so every organisation has full access.</div></div>';
  html += returnNotice(b, ret, refreshing);
  if(!ret && b.pendingPayment && !paymentConfirmed(b)){
    html += '<div class="notice warn" role="status"><strong>A payment is waiting for confirmation from your payment provider.</strong> Your plan changes once it is confirmed.<div style="margin-top:8px;"><button class="btn secondary small" data-action="billing-refresh">Check again</button></div></div>';
  }
  if(b.coupon) html += '<div class="notice ok">Promo code ' + escapeHtml(b.coupon) + ' will be applied when you subscribe.</div>';
  html += statusCard(b, isContractor, admin);
  const usage = usageBlock(b, isContractor);
  html += '<div class="section-title">Your usage</div>' + usage.html;
  const rec = recommendation(b, usage.pressure);
  if(rec) html += '<div class="notice rec" role="note"><strong>Suggested: ' + escapeHtml((b.plans.find((p) => p.id === rec.planId) || {}).name) + '.</strong> ' + escapeHtml(rec.reason) + '</div>';
  else if(usage.pressure.some((x) => x.kind === 'seats') && admin && !b.paystackSubscription && b.provider !== 'paystack') html += '<div class="notice rec" role="note">You are close to your seat limit. You can add seats on your current plan below.</div>';
  html += glossary(b, isContractor);
  if(!(b.grant && !b.grant.until) && !b.coveredByConsultant){
    html += '<div class="section-title">' + ((b.provider === 'paystack' ? b.paystackSubscription : b.hasSubscription) ? 'Change plan' : 'Choose a plan') + '</div>';
    if(!admin) html += '<div class="notice">Only an owner or admin can change the plan. Ask one of them to make the change.</div>';
    if(admin && b.provider !== 'paystack' && b.payments !== false){
      html += '<div class="card seat-picker"><label class="field-label" for="billSeats" style="margin-top:0;">Team logins (seats) to pay for</label><input type="number" id="billSeats" inputmode="numeric" min="' + Math.max(1, b.seatsUsed) + '" value="' + Math.max(b.seatLimit, b.seatsUsed) + '"><div class="site-card-sub">Number of people who can sign in. You need at least the ' + b.seatsUsed + ' in use now. Worker records don\'t count.</div></div>';
    } else if(admin && b.provider !== 'paystack') {
      html += '<input type="hidden" id="billSeats" value="' + Math.max(b.seatLimit, b.seatsUsed, 1) + '">';
    }
    const cards = b.plans.filter((p) => !(p.id === 'contractor_free' && b.plan !== 'contractor_free'));
    html += '<div class="plan-grid">' + cards.map((p) => planCard(b, p, { admin, recommended: !!rec && rec.planId === p.id })).join('') + '</div>';
    if(!isContractor) html += '<div class="site-card-sub" style="margin-top:8px;">More than three sites, or a mining group? Enterprise is set up by COMVERA with an agreed contract. <a href="/contact" target="_blank" rel="noopener">Contact us</a>.</div>';
    if(b.payments === false) html += '<div class="site-card-sub" style="margin-top:8px;">Online payment is coming soon. <a href="/contact" target="_blank" rel="noopener">Contact us</a> to subscribe, or use a promo code below.</div>';
    html += consequences(b);
  }
  if(b.paystackSubscription && admin) html += '<div class="row-actions" style="margin-top:10px;"><button class="btn danger small" data-action="paystack-cancel">Cancel subscription</button></div>';
  if(b.history && b.history.length){
    html += '<div class="section-title">Payments</div><div class="card">' + b.history.map((p) => '<div class="kv"><span>' + escapeHtml(String(p.paid_at || p.created_at).slice(0, 10)) + ' · ' + escapeHtml(p.planName) + '</span><span>' + rands(p.amount_cents) + ' · ' + escapeHtml(o.payStatus[p.status] || p.status) + '</span></div>').join('') + '</div>';
  }
  html += '<div class="site-card-sub vat-note">' + escapeHtml(b.vatNote || 'Prices are shown as set by COMVERA. Confirm VAT on your invoice.') + (b.provider === 'paystack' ? ' You pay on Paystack\'s secure page; COMVERA never sees your card.' : '') + '</div>';
  return html + (admin ? promo : '');
}
