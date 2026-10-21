// Browse Jobs page: anyone can browse; labourers only see (and apply to) jobs for their own trades.
(async () => {
  const me = await getMe();
  let jobs = [];

  if (me?.role === 'labourer') {
    const { profile } = await api('/labourers/me');
    const mine = splitTrades(profile.trades);
    $('#tradeFilter').innerHTML = `<option value="">All my trades</option>${tradeOptions('', mine)}`;
    $('#jobSearch').insertAdjacentHTML('afterend', `<p class="trade-note">Showing jobs for your trades:
      ${tradeBadges(profile.trades)} <a href="/dashboard?tab=profile">Edit trades</a></p>`);
  } else {
    $('#tradeFilter').insertAdjacentHTML('beforeend', tradeOptions());
  }

  function applyButton(j) {
    if (me?.role === 'poster' || me?.role === 'admin') return '';
    if (j.my_application === 'rejected') return '<span class="pill pill-rejected pill-text">Not selected</span>';
    if (j.my_application === 'expired') return '<span class="pill pill-expired pill-text" title="You were booked for another job at this time">Expired</span>';
    if (j.my_application) return '<span class="pill pill-accepted">Applied ✓</span>';
    // A labourer can only hold one job at a time, so overlapping jobs can't be applied to.
    if (j.clash) return '<span class="pill pill-rejected pill-text" title="You already have work booked at this time">Clashes with your booking</span>';
    return `<button class="btn small" data-apply="${j.id}" type="button">Apply</button>`;
  }

  async function load() {
    const box = $('#jobsList');
    const qs = new URLSearchParams(new FormData($('#jobSearch'))).toString();
    box.innerHTML = '<div class="muted">Loading…</div>';
    ({ jobs } = await api('/jobs?' + qs));
    box.innerHTML = jobs.map(j => `
      <div class="card job-card fade-in">
        <div>
          <h3>${esc(j.title)}</h3>
          <div class="meta">
            <span>🛠 ${esc(j.trade)}</span><span>📍 ${esc(j.location)}</span>
            <span>🕒 ${slotText(j.job_date, j.start_time, j.duration_minutes)}</span><span>👤 ${esc(j.poster_name)}</span>
            <span>${j.applicant_count} applied</span>
          </div>
          ${j.details ? `<p class="details">${esc(j.details)}</p>` : ''}
        </div>
        <div class="side">
          <div class="price">${rupees(j.budget)}</div>
          ${applyButton(j)}
        </div>
      </div>`).join('') || `<div class="card empty">No open jobs match your search${me?.role === 'labourer' ? ' and trades' : ''}.</div>`;
  }

  function apply(job) {
    if (!me) return (location.href = '/login?role=labourer&next=/jobs');
    const body = openModal(`Apply: ${job.title}`, `
      <p class="muted">${esc(job.trade)} · ${esc(job.location)} · ${slotText(job.job_date, job.start_time, job.duration_minutes)} · ${rupees(job.budget)}</p>
      <form class="form-card" style="padding:0">
        <label>Message to the poster (optional)
          <textarea name="message" rows="3" maxlength="255" placeholder="e.g. I have 5 years experience with this work and can come at 10am."></textarea></label>
        <div class="form-error"></div>
        <button class="btn" type="submit">Send application</button>
      </form>`);
    handleForm($('form', body), async data => {
      await api(`/jobs/${job.id}/apply`, { method: 'POST', body: data });
      closeModal();
      toast('Application sent! The poster will contact you if selected.');
      load();
    });
  }

  $('#jobsList').addEventListener('click', e => {
    const btn = e.target.closest('[data-apply]');
    if (btn) apply(jobs.find(j => j.id == btn.dataset.apply));
  });
  $('#jobSearch').addEventListener('submit', e => {
    e.preventDefault();
    load();
  });
  load().catch(err => toast(err.message, 'error'));
})();
