// Home page: search labourers, view profile, book directly. For job posters and visitors only.
(async () => {
  if ((await getMe())?.role === 'labourer') return location.replace('/jobs');
  $('#tradeFilter').insertAdjacentHTML('beforeend', tradeOptions());
  const params = new URLSearchParams(location.search);
  for (const [k, val] of params) if ($(`#searchForm [name=${k}]`)) $(`#searchForm [name=${k}]`).value = val;

  async function loadLabourers() {
    const grid = $('#workersGrid');
    const qs = new URLSearchParams(new FormData($('#searchForm'))).toString();
    grid.innerHTML = '<div class="muted">Loading…</div>';
    try {
      const { labourers } = await api('/labourers?' + qs);
      if (!labourers.length) {
        grid.innerHTML = '<div class="card empty" style="grid-column:1/-1">No labourers match your search. Try another trade or area.</div>';
        return;
      }
      grid.innerHTML = labourers.map(l => `
        <div class="card worker-card fade-in">
          <div class="top">
            <div class="avatar">${esc(initials(l.name))}</div>
            <div>
              <h3 class="name" style="margin:0">${esc(l.name)}</h3>
              ${tradeBadges(l.trades)}
              ${l.verified ? '<span class="verified">✔ Verified</span>' : ''}
            </div>
          </div>
          <div class="card-body">
            <div class="meta">📍 ${esc(l.area)} · ${rupees(l.daily_rate)}/day · ${l.experience} yrs</div>
            <div class="meta">${stars(l.rating_avg, l.rating_count)}
              ${l.available ? '' : '<span class="unavailable">Not available</span>'}</div>
            <p class="skills">${esc(l.skills)}</p>
            <div class="actions">
              <button class="btn small ghost" data-view="${l.id}" type="button">View profile</button>
              ${l.available ? `<button class="btn small" data-book="${l.id}" type="button">Book</button>` : ''}
            </div>
          </div>
        </div>`).join('');
      grid.labourers = labourers;
    } catch (err) {
      grid.innerHTML = `<div class="card empty error">${esc(err.message)}</div>`;
    }
  }

  async function loadJobs() {
    const box = $('#jobsList');
    const { jobs } = await api('/jobs');
    box.innerHTML = jobs.slice(0, 5).map(j => `
      <a class="card job-card" href="/jobs" style="text-decoration:none;color:inherit">
        <div>
          <h3>${esc(j.title)}</h3>
          <div class="meta"><span>🛠 ${esc(j.trade)}</span><span>📍 ${esc(j.location)}</span><span>📅 ${slotText(j.job_date, j.start_time, j.duration_minutes)}</span></div>
        </div>
        <div class="side"><div class="price">${rupees(j.budget)}</div></div>
      </a>`).join('') || '<div class="card empty">No open jobs right now.</div>';
  }

  async function viewProfile(id) {
    const { labourer: l, reviews } = await api('/labourers/' + id);
    const body = openModal(l.name, `
      <div style="display:flex;gap:16px;align-items:center">
        <div class="avatar lg">${esc(initials(l.name))}</div>
        <div>
          ${tradeBadges(l.trades)} ${l.verified ? '<span class="verified">✔ Verified by 9 to 5</span>' : ''}
          <div class="muted" style="margin-top:6px">📍 ${esc(l.area)} · ${rupees(l.daily_rate)}/day · ${l.experience} years experience</div>
          <div style="margin-top:4px">${stars(l.rating_avg, l.rating_count)}</div>
        </div>
      </div>
      <p><strong>Skills:</strong> ${esc(l.skills) || '—'}</p>
      <h4 style="margin-bottom:0">Reviews</h4>
      ${reviews.map(r => `<div class="review"><span class="stars">${'★'.repeat(r.rating)}</span>
          <strong>${esc(r.reviewer)}</strong> <span class="muted">· ${fmtDate(r.created_at)}</span>
          <div>${esc(r.comment)}</div></div>`).join('') || '<p class="muted">No reviews yet.</p>'}
      ${l.available ? '<button class="btn" id="bookFromProfile" type="button" style="margin-top:12px">Book ' + esc(l.name.split(' ')[0]) + '</button>' : '<p class="unavailable">Not taking work right now.</p>'}`);
    $('#bookFromProfile', body)?.addEventListener('click', () => book(l));
  }

  async function book(l) {
    const me = await getMe();
    if (!me) return (location.href = '/login?role=poster&next=/find');
    if (me.role !== 'poster') return toast('Only Job Poster accounts can book labourers.', 'error');
    const body = openModal(`Book ${l.name}`, `
      <p class="muted">${esc(splitTrades(l.trades).join(', '))} · ${rupees(l.daily_rate)}/day. ${esc(l.name.split(' ')[0])} will confirm the booking.</p>
      <form class="form-card" style="padding:0">
        ${slotFields({ dateName: 'booking_date' })}
        <label>Amount offered (₹) <input name="amount" type="number" min="100" required value="${l.daily_rate}"></label>
        <label>Work address <input name="address" required minlength="5" maxlength="255" placeholder="Flat / building, street, area"></label>
        <label>Work description <textarea name="note" rows="3" maxlength="255" placeholder="What needs to be done, timing…"></textarea></label>
        <p class="muted" style="margin-top:-6px;font-size:13px">The address is shared with ${esc(l.name.split(' ')[0])} only after they accept.</p>
        <div class="form-error"></div>
        <button class="btn" type="submit">Send booking request</button>
      </form>`);
    bindSlotFields($('form', body));
    handleForm($('form', body), async data => {
      await api('/bookings', { method: 'POST', body: { ...data, labourer_id: l.id } });
      closeModal();
      toast('Booking request sent! Track it in your dashboard.');
    });
  }

  $('#workersGrid').addEventListener('click', e => {
    const view = e.target.closest('[data-view]');
    const bookBtn = e.target.closest('[data-book]');
    if (view) viewProfile(view.dataset.view).catch(err => toast(err.message, 'error'));
    if (bookBtn) book($('#workersGrid').labourers.find(l => l.id == bookBtn.dataset.book));
  });
  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault();
    loadLabourers();
  });

  loadLabourers();
  loadJobs().catch(() => {});
})();
