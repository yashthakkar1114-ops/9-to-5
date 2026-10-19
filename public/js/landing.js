// Landing page: live numbers, trade shortcuts, a demo booking card and role-aware buttons.
(async () => {
  const ICONS = { Plumber: '🚰', Carpenter: '🪚', Electrician: '💡', Mover: '📦', Painter: '🎨', Mason: '🧱', Cleaner: '🧽', Helper: '🤝' };
  $('#tradeGrid').innerHTML = TRADES.map(t => `
    <a class="card lp-trade" href="/find?trade=${encodeURIComponent(t)}"><span>${ICONS[t] || '🛠️'}</span>${t}</a>`).join('');

  // A sample booking card using the same mock map the dashboard shows.
  $('#heroDemo').innerHTML = `
    <div class="lp-demo-head">
      <div class="avatar">RK</div>
      <div><strong>Ram Kumar</strong><span class="muted"> · Plumber</span>
        <div class="muted" style="font-size:13px">Fix bathroom leak · ₹500</div></div>
      ${pill('accepted')}
    </div>
    ${mockMap({ id: 9005, address: 'Bandra West, Mumbai', viewer: 'poster', status: 'accepted', otherName: 'Ram Kumar' })}`;
  tickMaps();

  const me = await getMe();
  if (me?.role === 'labourer') {
    $('#heroCta').innerHTML = `<a class="btn lp-btn" href="/jobs">Browse jobs</a><a class="btn ghost lp-btn" href="/dashboard">My dashboard</a>`;
  } else if (me?.role === 'poster') {
    $('#heroCta').innerHTML = `<a class="btn lp-btn" href="/find">Find labourers</a><a class="btn ghost lp-btn" href="/post_job">Post a job</a>`;
  } else if (me?.role === 'admin') {
    $('#heroCta').innerHTML = `<a class="btn lp-btn" href="/admin">Open admin panel</a>`;
  }

  const count = async (path, key) => (await api(path))[key].length;
  const set = (id, n) => ($(id).textContent = n.toLocaleString('en-IN'));
  Promise.all([count('/labourers', 'labourers'), count('/jobs', 'jobs'), count('/areas', 'areas')])
    .then(([l, j, a]) => { set('#statLabourers', l); set('#statJobs', j); set('#statAreas', a); })
    .catch(() => {});
})();
