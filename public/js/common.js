// Shared helpers for every page: API calls, session, header, modal, toasts.
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const TRADES = ['Plumber', 'Carpenter', 'Electrician', 'Mover', 'Painter', 'Mason', 'Cleaner', 'Helper'];
const ROLE_LABEL = { labourer: 'Labourer', poster: 'Job Poster', admin: 'Admin' };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const rupees = n => '₹' + Number(n).toLocaleString('en-IN');
const fmtDate = d => new Date(d.replace(' ', 'T')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const tradeOptions = (selected = '', list = TRADES) =>
  list.map(t => `<option ${t === selected ? 'selected' : ''}>${t}</option>`).join('');

// Labourers can have several trades, stored as 'Painter,Mason'.
const splitTrades = s => (s || '').split(',').filter(Boolean);
const tradeBadges = s => splitTrades(s).map(t => `<span class="badge">${esc(t)}</span>`).join(' ');
const tradeChecks = (selected = '') => `<div class="chips">${TRADES.map(t => `
  <label class="chip"><input type="checkbox" name="trades" value="${t}" ${splitTrades(selected).includes(t) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;

// Areas are managed by the admin.
async function areaOptions(selected = '', placeholder = 'Choose your area') {
  const { areas } = await api('/areas');
  if (selected && !areas.includes(selected)) areas.push(selected);
  return `<option value="">${placeholder}</option>` +
    areas.map(a => `<option ${a === selected ? 'selected' : ''}>${esc(a)}</option>`).join('');
}

const mapLink = address => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);

// Kept in step with PASSWORD_RULES in server/validate.js.
const PASSWORD_RULES = [
  [/^.{8,}$/, 'At least 8 characters'],
  [/[A-Z]/, 'One uppercase letter (A–Z)'],
  [/[a-z]/, 'One lowercase letter (a–z)'],
  [/\d/, 'One number (0–9)'],
  [/[^A-Za-z0-9\s]/, 'One special character (e.g. ! @ # $)'],
];

// Live checklist + strength bar under a new-password input. The form won't submit until every rule passes.
function passwordMeter(input) {
  const box = document.createElement('div');
  box.className = 'pw-meter';
  box.innerHTML = `<div class="pw-bar"><span></span></div>
    <ul class="pw-rules">${PASSWORD_RULES.map(([, label]) => `<li>${label}</li>`).join('')}</ul>`;
  input.closest('label').after(box);
  const update = () => {
    const passed = PASSWORD_RULES.map(([re]) => re.test(input.value.trim()));
    const score = passed.filter(Boolean).length;
    $$('li', box).forEach((li, i) => li.classList.toggle('ok', passed[i]));
    const bar = $('.pw-bar span', box);
    bar.style.width = (score / PASSWORD_RULES.length) * 100 + '%';
    bar.dataset.level = score === PASSWORD_RULES.length ? 'strong' : score >= 3 ? 'medium' : 'weak';
    input.setCustomValidity(score === PASSWORD_RULES.length ? '' : 'Your password does not meet all the rules yet.');
  };
  input.addEventListener('input', update);
  input.form?.addEventListener('reset', () => setTimeout(update));
  update();
}

function stars(avg, count) {
  if (!count) return '<span class="muted">No reviews yet</span>';
  return `<span class="stars">★ ${Number(avg).toFixed(1)}</span> <span class="muted">(${count})</span>`;
}

function pill(status) {
  return `<span class="pill pill-${status}">${status.replace('_', ' ')}</span>`;
}

// ---- Session ----
let currentUser;
async function getMe() {
  if (currentUser === undefined) {
    try {
      currentUser = (await api('/auth/me')).user;
    } catch {
      currentUser = null;
    }
  }
  return currentUser;
}

// Redirects to the right login page if the user is not one of `roles`.
async function requireLogin(...roles) {
  const me = await getMe();
  if (!me || (roles.length && !roles.includes(me.role))) {
    const back = encodeURIComponent(location.pathname + location.search);
    location.href = roles.includes('admin') ? '/admin-login' : `/login?next=${back}${roles.length === 1 ? '&role=' + roles[0] : ''}`;
    return new Promise(() => {}); // stop the page script while navigating
  }
  return me;
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  location.href = '/';
}

// ---- Header ----
async function renderHeader() {
  const header = $('#siteHeader');
  if (!header) return;
  const me = await getMe();
  // "Find Labourers" is for hiring, so labourers don't get it.
  const links = me?.role === 'labourer'
    ? [['/jobs', 'Browse Jobs'], ['/dashboard', 'Dashboard']]
    : [['/find', 'Find Labourers'], ['/jobs', 'Browse Jobs']];
  if (me?.role === 'poster') links.push(['/post_job', 'Post Job'], ['/dashboard', 'Dashboard']);
  if (me?.role === 'admin') links.push(['/admin', 'Admin Panel']);
  const here = location.pathname.replace(/\.html$/, '').replace(/^\/index$/, '/');
  header.className = 'site-header';
  header.innerHTML = `
    <a class="brand" href="/"><img src="/assets/logo.svg" alt="" width="32" height="32"><span>9 to 5</span></a>
    <button class="btn ghost small menu-btn" type="button" aria-label="Menu">☰</button>
    <nav class="nav" aria-label="Main navigation">
      ${links.map(([href, label]) => `<a href="${href}" class="${here === href ? 'active' : ''}">${label}</a>`).join('')}
      ${me
        ? `<span class="who">${esc(me.name)} <small>${ROLE_LABEL[me.role]}</small></span>
           <button class="btn small ghost" id="logoutBtn" type="button">Log out</button>`
        : `<a href="/login">Log in</a><a class="btn small" href="/signup">Sign up</a>`}
    </nav>`;
  $('.menu-btn', header).addEventListener('click', () => header.classList.toggle('open'));
  $('#logoutBtn')?.addEventListener('click', logout);
}

// ---- Modal ----
function openModal(title, html) {
  let m = $('#appModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'appModal';
    m.className = 'modal hidden';
    m.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true">
        <div class="modal-header"><div class="modal-title"></div>
        <button class="close" type="button" aria-label="Close">×</button></div>
        <div class="modal-body"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('.close')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }
  $('.modal-title', m).textContent = title;
  $('.modal-body', m).innerHTML = html;
  m.classList.remove('hidden');
  $('input, select, textarea, button:not(.close)', $('.modal-body', m))?.focus();
  return $('.modal-body', m);
}

function closeModal() {
  $('#appModal')?.classList.add('hidden');
}

// ---- Toasts ----
function toast(message, type = 'success') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Wires a <form> to an async handler: disables the button and shows errors in .form-error.
function handleForm(form, onSubmit) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const errBox = $('.form-error', form);
    if (errBox) errBox.textContent = '';
    btn.disabled = true;
    try {
      // Repeated names (e.g. several checked "trades" boxes) become arrays.
      const data = {};
      for (const [k, val] of new FormData(form)) data[k] = k in data ? [].concat(data[k], val) : val;
      await onSubmit(data);
    } catch (err) {
      if (errBox) errBox.textContent = err.message;
      else toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ---- Support centre (demo only: nothing is sent anywhere) ----
const SUPPORT_PHONE = '1800 000 0905';
const SUPPORT_EMAIL = 'support@9to5.demo';
const DEMO_NOTE = '<p class="demo-note">This is a demo feature: nothing is sent and no one will be contacted.</p>';

const FAQS = [
  ['How do I hire a labourer?', 'Sign up as a Job Poster, then either book a labourer directly from Find Labourers or post a job and pick from the people who apply.'],
  ['How do I find work?', 'Sign up as a Labourer and choose your trades and area. Browse Jobs shows open jobs for your trades, and posters can also book you directly.'],
  ['When do we see each other’s phone number and address?', 'Only after the labourer accepts a booking. Until then contact details stay private.'],
  ['How does payment work?', 'After the work is marked completed, the poster pays through the payment page. In this demo no real money moves.'],
  ['What does “Verified” mean?', 'Our team has checked the labourer’s identity and details.'],
];

const SUPPORT_VIEWS = {
  help: () => ['How can we help?', `
    <div class="support-grid">
      <button type="button" data-support="chat"><span>💬</span>Chat with us<small>Replies in minutes</small></button>
      <button type="button" data-support="call"><span>📞</span>Call helpline<small>${SUPPORT_PHONE}</small></button>
      <button type="button" data-support="email"><span>✉️</span>Email us<small>${SUPPORT_EMAIL}</small></button>
      <button type="button" data-support="faq"><span>❓</span>FAQs<small>Quick answers</small></button>
      <button type="button" data-support="ticket"><span>🎫</span>Raise a ticket<small>Track an issue</small></button>
      <button type="button" data-support="safety"><span>🛡️</span>Safety centre<small>Emergency help</small></button>
    </div>${DEMO_NOTE}`],
  chat: () => ['Chat with support', `
    <div class="chat-log" id="chatLog"><div class="bubble bot">Hi! I’m the 9 to 5 support assistant. How can I help you today?</div></div>
    <form class="chat-form" id="chatForm"><input name="msg" required placeholder="Type your message…" autocomplete="off" aria-label="Message">
      <button class="btn" type="submit">Send</button></form>${DEMO_NOTE}`],
  call: () => ['Call our helpline', `
    <p class="support-big">📞 ${SUPPORT_PHONE}</p>
    <p class="muted">Toll free · Monday to Saturday, 9 am to 9 pm · Hindi, Marathi and English</p>${DEMO_NOTE}`],
  email: () => ['Email support', `
    <p class="support-big">✉️ ${SUPPORT_EMAIL}</p><p class="muted">We usually reply within 24 hours.</p>${DEMO_NOTE}`],
  faq: () => ['Frequently asked questions', FAQS.map(([q, a]) =>
    `<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join('')],
  ticket: ctx => ['Raise a support ticket', `
    <form class="form-card" style="padding:0" id="ticketForm">
      <label>Topic <select name="topic" required>
        <option value="">Choose a topic</option><option>Booking problem</option><option>Payment issue</option>
        <option>Account or login</option><option>Report a user</option><option>Something else</option></select></label>
      <label>Describe the problem <textarea name="details" rows="4" required minlength="10">${ctx ? `Booking #${esc(ctx)}: ` : ''}</textarea></label>
      <div class="form-error"></div>
      <button class="btn" type="submit">Submit ticket</button>
    </form>${DEMO_NOTE}`],
  report: ctx => SUPPORT_VIEWS.ticket(ctx),
  safety: () => ['Safety centre', `
    <div class="sos-box">
      <strong>In immediate danger?</strong>
      <p>Call the national emergency number right away.</p>
      <a class="btn danger" href="tel:112">🆘 Call 112</a>
    </div>
    <ul class="safety-list">
      <li>Keep all communication and payments inside 9 to 5.</li>
      <li>Check the labourer’s <strong>Verified</strong> badge and reviews before hiring.</li>
      <li>Share your booking details with a friend or family member.</li>
      <li>Never share OTPs, card PINs or passwords with anyone.</li>
    </ul>
    <button class="btn ghost" type="button" data-support="report">Report a safety concern</button>${DEMO_NOTE}`],
  about: () => ['About 9 to 5', `<p>9 to 5 connects households and businesses with skilled local labourers:
    plumbers, electricians, carpenters, painters, movers and more. Fair rates, verified profiles and payments in one place.</p>${DEMO_NOTE}`],
  terms: () => ['Terms of service', `<p>These are placeholder terms for the demo version of 9 to 5.
    A real launch needs terms reviewed by a lawyer, covering bookings, cancellations, payments and disputes.</p>`],
  privacy: () => ['Privacy policy', `<p>This is a placeholder privacy policy. 9 to 5 only shares phone numbers and
    addresses between a job poster and a labourer once a booking is accepted. A real launch needs a full policy.</p>`],
};

function openSupport(view = 'help', ctx = '') {
  const [title, html] = (SUPPORT_VIEWS[view] || SUPPORT_VIEWS.help)(ctx);
  const m = openModal(title, html);
  const chat = $('#chatForm', m);
  if (chat) {
    handleForm(chat, async ({ msg }) => {
      const log = $('#chatLog', m);
      log.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(msg)}</div>`);
      chat.reset();
      await new Promise(r => setTimeout(r, 700));
      log.insertAdjacentHTML('beforeend', '<div class="bubble bot">Thanks! A support agent will join this chat shortly. (Demo: no one will actually reply.)</div>');
      log.scrollTop = log.scrollHeight;
    });
  }
  const ticket = $('#ticketForm', m);
  if (ticket) {
    handleForm(ticket, async () => {
      const id = 'TKT-' + Math.floor(100000 + Math.random() * 900000);
      openModal('Ticket created', `<p class="support-big">🎫 ${id}</p>
        <p>We’ve logged your issue and will get back to you within 24 hours.</p>${DEMO_NOTE}`);
    });
  }
}

// Any element with data-support="<view>" (and optional data-ctx) opens the support centre.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-support]');
  if (!el) return;
  e.preventDefault();
  if (el.dataset.support === 'call') toast(`Demo: this would call ${SUPPORT_PHONE}.`);
  openSupport(el.dataset.support, el.dataset.ctx);
});

function renderSupportChrome() {
  document.body.insertAdjacentHTML('beforeend', `
    <button class="help-fab" type="button" data-support="help" aria-label="Help and support">
      <span aria-hidden="true">?</span><b>Help</b></button>
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <a class="brand" href="/"><img src="/assets/logo.svg" alt="" width="32" height="32"><span>9 to 5</span></a>
          <p>Trusted local labourers, hired in minutes.</p>
        </div>
        <div><h4>Hire</h4><a href="/find">Find labourers</a><a href="/post_job">Post a job</a><a href="/signup-poster">Sign up to hire</a></div>
        <div><h4>Work</h4><a href="/jobs">Browse jobs</a><a href="/signup-labourer">Join as a labourer</a><a href="/dashboard">My dashboard</a></div>
        <div><h4>Support</h4><a href="#" data-support="help">Help centre</a><a href="#" data-support="chat">Contact us</a>
          <a href="#" data-support="safety">Safety</a><a href="#" data-support="report">Report a problem</a></div>
        <div><h4>Company</h4><a href="#" data-support="about">About</a><a href="#" data-support="terms">Terms</a><a href="#" data-support="privacy">Privacy</a></div>
      </div>
      <div class="footer-bottom">© 2026 9 to 5 · Demo project · Support: ${SUPPORT_PHONE}</div>
    </footer>`);
}

// ---- Mock map (a drawn map, not real data). Same booking id -> same map every time. ----
function seededRandom(seed) {
  let t = seed * 2654435761 >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const directionsLink = address => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address);

// Minutes the (pretend) trip takes for this booking, and when the labourer "arrives".
// The arrival time is remembered per tab so the countdown survives re-renders.
function mockTrip(id) {
  const rand = seededRandom(Number(id));
  const minutes = 12 + Math.floor(rand() * 20);
  const km = (minutes * 0.35 + rand()).toFixed(1);
  let until = 0;
  try {
    until = Number(sessionStorage.getItem('eta:' + id)) || 0;
    if (!until) sessionStorage.setItem('eta:' + id, (until = Date.now() + minutes * 60000));
  } catch {
    until = Date.now() + minutes * 60000;
  }
  return { minutes, km, until };
}

// opts: { id, address, viewer: 'poster' | 'labourer', status, otherName }
function mockMap({ id, address, viewer, status, otherName }) {
  const rand = seededRandom(Number(id) + 7);
  const W = 600, H = 240;
  const y = () => 40 + Math.round(rand() * 160);
  const sy = y(), my = y(), dy = y();
  const x1 = 150 + Math.round(rand() * 100), x2 = 330 + Math.round(rand() * 100);
  const route = `M60 ${sy}H${x1}V${my}H${x2}V${dy}H540`;
  const streetsH = [sy, my, dy, y()].map(v => `<path d="M0 ${v}H${W}"/>`).join('');
  const streetsV = [x1, x2, 60 + Math.round(rand() * 60), 470 + Math.round(rand() * 60)].map(v => `<path d="M${v} 0V${H}"/>`).join('');
  const parkX = 80 + Math.round(rand() * 380), riverY = 20 + Math.round(rand() * 200);
  const trip = mockTrip(id);
  const enRoute = viewer === 'poster' && status === 'accepted';
  const onSite = ['started', 'in_progress'].includes(status);

  const info = viewer === 'labourer'
    ? `<div><strong>${onSite ? 'You are on site' : 'Your route to the job'}</strong>
         <span>${onSite ? esc(address) : `${trip.km} km · about ${trip.minutes} min by road`}</span></div>
       <a class="btn small" href="${directionsLink(address)}" target="_blank" rel="noopener">Get directions in Google Maps ↗</a>`
    : `<div><strong>${enRoute ? `${esc(otherName)} is on the way` : `${esc(otherName)} is on site`}</strong>
         <span>${enRoute ? `<b class="eta-text">Arriving in ${trip.minutes} min</b> · ${trip.km} km away` : 'Work has started'}</span></div>
       <a class="btn small ghost" href="${mapLink(address)}" target="_blank" rel="noopener">View address ↗</a>`;

  return `<div class="mockmap" ${enRoute ? `data-eta-until="${trip.until}" data-eta-total="${trip.minutes}"` : ''}>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="Map of the route (demo)" role="img">
      <rect width="${W}" height="${H}" class="map-land"/>
      <path class="map-river" d="M0 ${riverY}C150 ${riverY + 40} 300 ${riverY - 40} ${W} ${riverY + 10}"/>
      <rect class="map-park" x="${parkX}" y="${30 + Math.round(rand() * 120)}" width="70" height="50" rx="8"/>
      <g class="map-streets">${streetsH}${streetsV}</g>
      <path class="map-route" d="${route}"/>
      <path class="map-route-dash" d="${route}"/>
      <g class="map-start"><circle cx="60" cy="${sy}" r="7"/></g>
      <g class="map-pin" transform="translate(540 ${dy})"><path d="M0 0c-7-9-12-14-12-21a12 12 0 0 1 24 0c0 7-5 12-12 21z"/><circle cy="-21" r="4.5"/></g>
      <g class="map-mover" ${enRoute ? '' : `transform="translate(${onSite ? `540 ${dy - 30}` : `60 ${sy}`})"`}>
        <circle r="13"/><text dy="4">${viewer === 'poster' ? esc(initials(otherName)) : 'You'}</text></g>
    </svg>
    <span class="map-tag">Demo map</span>
    <div class="map-bar">${info}</div>
  </div>`;
}

// Moves each en-route marker along its route and counts the ETA down. The ETA goes away once the job starts
// because the map is then re-drawn without data-eta-until.
function tickMaps() {
  for (const map of $$('[data-eta-until]')) {
    const left = Math.max(0, Number(map.dataset.etaUntil) - Date.now());
    const total = Number(map.dataset.etaTotal) * 60000;
    const route = $('.map-route', map);
    const p = route.getPointAtLength(route.getTotalLength() * Math.min(1, 1 - left / total));
    $('.map-mover', map).setAttribute('transform', `translate(${p.x} ${p.y})`);
    const mins = Math.ceil(left / 60000);
    $('.eta-text', map).textContent = left <= 0 ? 'Arriving now' : `Arriving in ${mins} min`;
  }
}
setInterval(tickMaps, 1000);

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderSupportChrome();
});
