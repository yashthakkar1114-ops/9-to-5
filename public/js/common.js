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
const tradeOptions = (selected = '') =>
  TRADES.map(t => `<option ${t === selected ? 'selected' : ''}>${t}</option>`).join('');

function stars(avg, count) {
  if (!count) return '<span class="muted">No reviews yet</span>';
  return `<span class="stars">★ ${Number(avg).toFixed(1)}</span> <span class="muted">(${count})</span>`;
}

function pill(status) {
  return `<span class="pill pill-${status}">${status}</span>`;
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
  const links = [['/', 'Find Labourers'], ['/jobs', 'Browse Jobs']];
  if (me?.role === 'poster') links.push(['/post_job', 'Post Job'], ['/dashboard', 'Dashboard']);
  if (me?.role === 'labourer') links.push(['/dashboard', 'Dashboard']);
  if (me?.role === 'admin') links.push(['/admin', 'Admin Panel']);
  const here = location.pathname.replace(/\.html$/, '').replace(/^\/index$/, '/');
  header.className = 'site-header';
  header.innerHTML = `
    <a class="brand" href="/">9 to 5</a>
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
      await onSubmit(Object.fromEntries(new FormData(form).entries()));
    } catch (err) {
      if (errBox) errBox.textContent = err.message;
      else toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', renderHeader);
