// Dashboard for Job Posters and Labourers.
(async () => {
  const me = await requireLogin('poster', 'labourer');
  const body = $('#tabBody');

  $('#hello').textContent = `Hi, ${me.name.split(' ')[0]} 👋`;
  $('#helloSub').textContent = me.role === 'poster'
    ? 'Manage your jobs, applicants and bookings.'
    : 'Manage your bookings, applications and profile.';
  if (me.role === 'poster') $('#headAction').innerHTML = '<a class="btn" href="/post_job">+ Post a Job</a>';
  if (sessionStorage.getItem('welcome')) toast('Account created. Welcome to 9 to 5!');
  if (sessionStorage.getItem('flash')) toast(sessionStorage.getItem('flash'));
  sessionStorage.removeItem('welcome');
  sessionStorage.removeItem('flash');

  // ---------- Bookings (both roles) ----------
  function bookingActions(b) {
    if (me.role === 'labourer' && b.status === 'pending') {
      return `<button class="btn small success" data-act="accept" data-id="${b.id}" type="button">Accept</button>
              <button class="btn small ghost" data-act="reject" data-id="${b.id}" type="button">Reject</button>`;
    }
    if (me.role === 'poster') {
      let html = '';
      if (b.status === 'accepted') html += `<button class="btn small success" data-act="complete" data-id="${b.id}" type="button">Mark done</button>`;
      if (['pending', 'accepted'].includes(b.status)) html += `<button class="btn small ghost" data-act="cancel" data-id="${b.id}" type="button">Cancel</button>`;
      if (b.status === 'completed' && !b.rating) html += `<button class="btn small" data-review="${b.id}" type="button">Rate</button>`;
      return html;
    }
    return '';
  }

  async function renderBookings() {
    const { bookings } = await api('/bookings');
    const who = me.role === 'poster' ? 'Labourer' : 'Hired by';
    body.innerHTML = bookings.map(b => `
      <div class="card job-card fade-in" style="margin-bottom:10px">
        <div>
          <h3>${esc(b.note || (b.trade + ' work'))}</h3>
          <div class="meta">
            <span>${who}: <strong>${esc(b.other_name)}</strong></span>
            ${b.trade ? `<span>🛠 ${esc(b.trade)}</span>` : ''}
            <span>📅 ${fmtDate(b.booking_date)}</span>
            ${b.other_phone ? `<span>📞 <a href="tel:${esc(b.other_phone)}">${esc(b.other_phone)}</a></span>` : ''}
            ${b.job_id ? '<span>via job post</span>' : '<span>direct booking</span>'}
          </div>
          ${b.rating ? `<p class="details"><span class="stars">${'★'.repeat(b.rating)}</span> ${esc(b.comment)}</p>` : ''}
        </div>
        <div class="side">
          <div class="price">${rupees(b.amount)}</div>
          ${pill(b.status)}
          <div class="actions">${bookingActions(b)}</div>
        </div>
      </div>`).join('') || `<div class="card empty">No bookings yet. ${me.role === 'poster'
        ? '<a href="/">Find a labourer</a> or <a href="/post_job">post a job</a>.'
        : 'Keep your profile up to date and <a href="/jobs">apply to jobs</a>.'}</div>`;
    return bookings;
  }

  const CONFIRM = {
    cancel: 'Cancel this booking?',
    reject: 'Reject this booking request?',
    complete: 'Mark this work as completed?',
  };

  body.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      if (CONFIRM[act.dataset.act] && !confirm(CONFIRM[act.dataset.act])) return;
      try {
        await api('/bookings/' + act.dataset.id, { method: 'PATCH', body: { action: act.dataset.act } });
        toast({ accept: 'Booking accepted.', reject: 'Booking rejected.', cancel: 'Booking cancelled.', complete: 'Marked as completed.' }[act.dataset.act]);
        if (act.dataset.act === 'complete') reviewModal(act.dataset.id);
        showTab(currentTab);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    const rev = e.target.closest('[data-review]');
    if (rev) reviewModal(rev.dataset.review);
  });

  function reviewModal(bookingId) {
    let rating = 0;
    const m = openModal('Rate this labourer', `
      <p class="muted">Your review helps others hire with confidence.</p>
      <form class="form-card" style="padding:0">
        <div class="rating-input" role="radiogroup" aria-label="Rating">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n} star">★</button>`).join('')}
        </div>
        <label style="margin-top:10px">Comment <textarea name="comment" rows="3" maxlength="500" placeholder="How was the work?"></textarea></label>
        <div class="form-error"></div>
        <button class="btn" type="submit">Submit review</button>
      </form>`);
    $('.rating-input', m).addEventListener('click', e => {
      const s = e.target.closest('[data-star]');
      if (!s) return;
      rating = Number(s.dataset.star);
      $$('[data-star]', m).forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= rating));
    });
    handleForm($('form', m), async data => {
      if (!rating) throw new Error('Please choose a star rating.');
      await api(`/bookings/${bookingId}/review`, { method: 'POST', body: { rating, comment: data.comment } });
      closeModal();
      toast('Thanks for your review!');
      showTab(currentTab);
    });
  }

  // ---------- Poster: My Jobs ----------
  async function renderMyJobs() {
    const { jobs } = await api('/jobs/mine');
    body.innerHTML = jobs.map(j => `
      <div class="card job-card fade-in" style="margin-bottom:10px">
        <div>
          <h3>${esc(j.title)}</h3>
          <div class="meta">
            <span>🛠 ${esc(j.trade)}</span><span>📍 ${esc(j.location)}</span><span>📅 ${fmtDate(j.job_date)}</span>
            ${j.hired_name ? `<span>Hired: <strong>${esc(j.hired_name)}</strong></span>` : ''}
          </div>
        </div>
        <div class="side">
          <div class="price">${rupees(j.budget)}</div>
          ${pill(j.status)}
          <div class="actions">
            ${j.status === 'open' ? `<button class="btn small" data-applicants="${j.id}" type="button">Applicants${j.pending_count ? ` (${j.pending_count})` : ''}</button>
              <a class="btn small ghost" href="/post_job?edit=${j.id}">Edit</a>
              <button class="btn small ghost" data-close="${j.id}" type="button">Close</button>` : ''}
            ${j.status === 'closed' && !j.hired_name ? `<button class="btn small ghost" data-reopen="${j.id}" type="button">Reopen</button>` : ''}
          </div>
        </div>
      </div>`).join('') || '<div class="card empty">You have not posted any jobs yet. <a href="/post_job">Post your first job</a>.</div>';
  }

  async function applicantsModal(jobId) {
    const { job, applications } = await api(`/jobs/${jobId}/applications`);
    const m = openModal(`Applicants — ${job.title}`, applications.map(a => `
      <div class="review" style="display:flex;gap:12px;align-items:center">
        <div class="avatar">${esc(initials(a.name))}</div>
        <div style="flex:1">
          <strong>${esc(a.name)}</strong> ${a.verified ? '<span class="verified">✔ Verified</span>' : ''}
          <div class="muted">${esc(a.trade)} · ${esc(a.area)} · ${rupees(a.daily_rate)}/day · ${a.experience} yrs · ${stars(a.rating_avg, a.rating_count)}</div>
          ${a.message ? `<div>“${esc(a.message)}”</div>` : ''}
        </div>
        ${a.status === 'pending' ? `<button class="btn small" data-hire="${a.id}" type="button">Hire</button>` : pill(a.status)}
      </div>`).join('') || '<p class="muted">No one has applied yet. Check back soon.</p>');
    m.addEventListener('click', async e => {
      const h = e.target.closest('[data-hire]');
      if (!h || !confirm('Hire this labourer? Other applicants will be declined.')) return;
      try {
        await api(`/jobs/${jobId}/hire`, { method: 'POST', body: { application_id: Number(h.dataset.hire) } });
        closeModal();
        toast('Labourer hired! You can now see their phone number under Bookings.');
        showTab('jobs');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  body.addEventListener('click', async e => {
    const a = e.target.closest('[data-applicants]');
    if (a) applicantsModal(a.dataset.applicants).catch(err => toast(err.message, 'error'));
    const c = e.target.closest('[data-close], [data-reopen]');
    if (c) {
      const closing = 'close' in c.dataset;
      if (closing && !confirm('Close this job? Labourers will no longer see it.')) return;
      try {
        await api('/jobs/' + (c.dataset.close || c.dataset.reopen), { method: 'PATCH', body: { status: closing ? 'closed' : 'open' } });
        toast(closing ? 'Job closed.' : 'Job reopened.');
        showTab('jobs');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // ---------- Labourer: Applications ----------
  async function renderApplications() {
    const { applications } = await api('/jobs/applied');
    body.innerHTML = applications.map(a => `
      <div class="card job-card fade-in" style="margin-bottom:10px">
        <div>
          <h3>${esc(a.title)}</h3>
          <div class="meta"><span>🛠 ${esc(a.trade)}</span><span>📍 ${esc(a.location)}</span>
            <span>📅 ${fmtDate(a.job_date)}</span><span>👤 ${esc(a.poster_name)}</span></div>
          ${a.message ? `<p class="details">Your message: “${esc(a.message)}”</p>` : ''}
        </div>
        <div class="side"><div class="price">${rupees(a.budget)}</div>${pill(a.status)}</div>
      </div>`).join('') || '<div class="card empty">You have not applied to any jobs yet. <a href="/jobs">Browse open jobs</a>.</div>';
  }

  // ---------- Labourer: Profile ----------
  async function renderProfile() {
    const { profile: p } = await api('/labourers/me');
    body.innerHTML = `
      <form class="card form-card" id="profileForm" style="max-width:680px">
        <h3 style="margin-top:0">Your public profile</h3>
        <p class="muted" style="margin-top:-6px">
          ${p.verified ? '<span class="verified">✔ Verified by 9 to 5</span>' : 'Not verified yet: an admin will review your profile.'}
          · ${stars(p.rating_avg, p.rating_count)}</p>
        <div class="form-grid">
          <label>Full name <input name="name" required minlength="2" value="${esc(p.name)}"></label>
          <label>Phone <input name="phone" type="tel" required value="${esc(p.phone)}"></label>
          <label>Trade <select name="trade" required>${tradeOptions(p.trade)}</select></label>
          <label>Area <input name="area" required value="${esc(p.area)}"></label>
          <label>Daily rate (₹) <input name="daily_rate" type="number" min="100" required value="${p.daily_rate}"></label>
          <label>Experience (years) <input name="experience" type="number" min="0" max="60" value="${p.experience}"></label>
          <label class="full">Skills <input name="skills" value="${esc(p.skills)}"></label>
          <label class="full check"><input type="checkbox" name="available" ${p.available ? 'checked' : ''}> I am available for work (posters can book me)</label>
        </div>
        <div class="form-error"></div>
        <button class="btn" type="submit">Save profile</button>
      </form>`;
    handleForm($('#profileForm'), async data => {
      await api('/labourers/me', { method: 'PUT', body: { ...data, available: data.available === 'on' } });
      toast('Profile saved.');
    });
  }

  // ---------- Account (both) ----------
  function renderAccount() {
    body.innerHTML = `
      <form class="card form-card" id="pwForm" style="max-width:460px">
        <h3 style="margin-top:0">Change password</h3>
        <p class="muted" style="margin-top:-6px">Logged in as ${esc(me.email)}</p>
        <label>Current password <input name="current" type="password" required autocomplete="current-password"></label>
        <label>New password <input name="next" type="password" required minlength="6" autocomplete="new-password"></label>
        <div class="form-error"></div>
        <button class="btn" type="submit">Update password</button>
      </form>`;
    const form = $('#pwForm');
    handleForm(form, async data => {
      await api('/auth/password', { method: 'PATCH', body: data });
      form.reset();
      toast('Password updated.');
    });
  }

  // ---------- Tabs ----------
  const TABS = me.role === 'poster'
    ? { jobs: ['My Jobs', renderMyJobs], bookings: ['Bookings', renderBookings], account: ['Account', renderAccount] }
    : { bookings: ['Bookings', renderBookings], applications: ['My Applications', renderApplications],
        profile: ['My Profile', renderProfile], account: ['Account', renderAccount] };
  let currentTab = Object.keys(TABS)[0];

  $('#tabs').innerHTML = Object.entries(TABS)
    .map(([key, [label]]) => `<button type="button" data-tab="${key}">${label}</button>`).join('');
  $('#tabs').addEventListener('click', e => e.target.dataset.tab && showTab(e.target.dataset.tab));

  async function showTab(key) {
    currentTab = key;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === key));
    try {
      await TABS[key][1]();
    } catch (err) {
      body.innerHTML = `<div class="card empty error">${esc(err.message)}</div>`;
    }
  }

  // Show a badge with pending booking requests for labourers.
  if (me.role === 'labourer') {
    api('/bookings').then(({ bookings }) => {
      const n = bookings.filter(b => b.status === 'pending').length;
      if (n) $('#tabs [data-tab=bookings]').insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
    }).catch(() => {});
  }
  showTab(currentTab);
})();
