// Admin panel: stats, users (verify / block), jobs (remove), bookings.
(async () => {
  await requireLogin('admin');
  const body = $('#tabBody');
  let currentTab = 'users';

  async function loadStats() {
    const { stats: s } = await api('/admin/stats');
    const tiles = [
      [s.labourers, 'Labourers'], [s.posters, 'Job Posters'], [s.unverified, 'Awaiting verification'],
      [s.open_jobs, 'Open jobs'], [s.active_bookings, 'Active bookings'], [s.completed_bookings, 'Completed jobs'],
      [s.blocked, 'Blocked users'],
    ];
    $('#stats').innerHTML = tiles.map(([n, label]) =>
      `<div class="card stat no-lift"><div class="num">${n}</div><div class="label">${label}</div></div>`).join('');
  }

  // ---------- Users ----------
  function renderUsersShell() {
    body.innerHTML = `
      <form class="toolbar" id="userFilter">
        <input type="search" name="q" placeholder="Search name, email or phone">
        <select name="role"><option value="">All roles</option><option value="labourer">Labourers</option><option value="poster">Job Posters</option></select>
        <button class="btn small" type="submit">Filter</button>
      </form>
      <div class="card table-wrap"><table class="data"><thead><tr>
        <th>Name</th><th>Role</th><th>Contact</th><th>Trade / Area</th><th>Joined</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody id="userRows"></tbody></table></div>`;
    $('#userFilter').addEventListener('submit', e => {
      e.preventDefault();
      loadUsers();
    });
    return loadUsers();
  }

  async function loadUsers() {
    const qs = new URLSearchParams(new FormData($('#userFilter'))).toString();
    const { users } = await api('/admin/users?' + qs);
    $('#userRows').innerHTML = users.map(u => `
      <tr>
        <td><strong>${esc(u.name)}</strong></td>
        <td>${ROLE_LABEL[u.role]}</td>
        <td>${esc(u.email)}<br><span class="muted">${esc(u.phone)}</span></td>
        <td>${u.role === 'labourer' ? `${esc(splitTrades(u.trades).join(', '))} · ${esc(u.area)}<br>${u.verified ? '<span class="verified">✔ Verified</span>' : '<span class="muted">Not verified</span>'}` : '—'}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td>${pill(u.status)}</td>
        <td><div class="actions">
          ${u.role === 'labourer' ? `<button class="btn small ${u.verified ? 'ghost' : 'success'}" data-verify="${u.id}" data-val="${u.verified ? 0 : 1}" type="button">${u.verified ? 'Unverify' : 'Verify'}</button>` : ''}
          <button class="btn small ${u.status === 'active' ? 'danger' : 'ghost'}" data-block="${u.id}" data-val="${u.status === 'active' ? 'blocked' : 'active'}" type="button">${u.status === 'active' ? 'Block' : 'Unblock'}</button>
        </div></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">No users found.</td></tr>';
  }

  // ---------- Jobs ----------
  async function renderJobs() {
    const { jobs } = await api('/admin/jobs');
    body.innerHTML = `<div class="card table-wrap"><table class="data"><thead><tr>
        <th>Title</th><th>Trade</th><th>Location</th><th>Budget</th><th>Date</th><th>Posted by</th><th>Status</th><th></th>
      </tr></thead><tbody>${jobs.map(j => `
        <tr>
          <td><strong>${esc(j.title)}</strong></td><td>${esc(j.trade)}</td><td>${esc(j.location)}</td>
          <td>${rupees(j.budget)}</td><td>${fmtDate(j.job_date)}</td><td>${esc(j.poster_name)}</td>
          <td>${pill(j.status)}</td>
          <td><button class="btn small danger" data-delete="${j.id}" type="button">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">No jobs yet.</td></tr>'}</tbody></table></div>`;
  }

  // ---------- Bookings ----------
  async function renderBookings() {
    const { bookings } = await api('/admin/bookings');
    body.innerHTML = `<div class="card table-wrap"><table class="data"><thead><tr>
        <th>#</th><th>Job Poster</th><th>Labourer</th><th>Date</th><th>Amount</th><th>Status</th><th>Payment</th><th>Created</th>
      </tr></thead><tbody>${bookings.map(b => `
        <tr>
          <td>${b.id}</td><td>${esc(b.poster_name)}</td><td>${esc(b.labourer_name)}</td>
          <td>${fmtDate(b.booking_date)}</td><td>${rupees(b.amount)}</td><td>${pill(b.status)}</td>
          <td>${b.paid_at ? `<span class="paid">✔ Paid</span>` : b.status === 'completed' ? '<span class="muted">Unpaid</span>' : '—'}</td>
          <td>${fmtDate(b.created_at)}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">No bookings yet.</td></tr>'}</tbody></table></div>`;
  }

  // ---------- Areas (the dropdown labourers pick from at signup) ----------
  async function renderAreas() {
    const { areas } = await api('/admin/areas');
    body.innerHTML = `
      <form class="toolbar" id="areaForm">
        <input name="name" required minlength="2" maxlength="100" placeholder="New area, e.g. Santacruz">
        <button class="btn small" type="submit">Add area</button>
      </form>
      <div class="card table-wrap"><table class="data"><thead><tr>
        <th>Area</th><th>Labourers</th><th>Added</th><th></th>
      </tr></thead><tbody>${areas.map(a => `
        <tr>
          <td><strong>${esc(a.name)}</strong></td><td>${a.labourer_count}</td><td>${fmtDate(a.created_at)}</td>
          <td>${a.labourer_count ? '<span class="muted">In use</span>'
            : `<button class="btn small danger" data-area-delete="${a.id}" type="button">Remove</button>`}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">No areas yet. Labourers cannot sign up until you add one.</td></tr>'}</tbody></table></div>`;
    handleForm($('#areaForm'), async data => {
      await api('/admin/areas', { method: 'POST', body: data });
      toast(`${data.name.trim()} added.`);
      await renderAreas();
    });
  }

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-verify], [data-block], [data-delete], [data-area-delete]');
    if (!btn) return;
    try {
      if (btn.dataset.verify) {
        await api('/admin/users/' + btn.dataset.verify, { method: 'PATCH', body: { verified: btn.dataset.val === '1' } });
        toast(btn.dataset.val === '1' ? 'Labourer verified.' : 'Verification removed.');
        await loadUsers();
      } else if (btn.dataset.block) {
        const blocking = btn.dataset.val === 'blocked';
        if (blocking && !confirm('Block this user? They will be logged out and cannot log in.')) return;
        await api('/admin/users/' + btn.dataset.block, { method: 'PATCH', body: { status: btn.dataset.val } });
        toast(blocking ? 'User blocked.' : 'User unblocked.');
        await loadUsers();
      } else if (btn.dataset.delete) {
        if (!confirm('Permanently remove this job and its applications?')) return;
        await api('/admin/jobs/' + btn.dataset.delete, { method: 'DELETE' });
        toast('Job removed.');
        await renderJobs();
      } else if (btn.dataset.areaDelete) {
        if (!confirm('Remove this area from the signup list?')) return;
        await api('/admin/areas/' + btn.dataset.areaDelete, { method: 'DELETE' });
        toast('Area removed.');
        await renderAreas();
      }
      loadStats();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const TABS = { users: renderUsersShell, jobs: renderJobs, bookings: renderBookings, areas: renderAreas };
  async function showTab(key) {
    currentTab = key;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === key));
    try {
      await TABS[key]();
    } catch (err) {
      body.innerHTML = `<div class="card empty error">${esc(err.message)}</div>`;
    }
  }
  $('#tabs').addEventListener('click', e => e.target.dataset.tab && showTab(e.target.dataset.tab));

  loadStats().catch(err => toast(err.message, 'error'));
  showTab(currentTab);
})();
