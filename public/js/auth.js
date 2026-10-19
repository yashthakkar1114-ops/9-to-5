// Login, signup and admin login pages.
(async () => {
  const params = new URLSearchParams(location.search);
  const HOME = { poster: '/dashboard', labourer: '/dashboard', admin: '/admin' };

  // Only follow same-site relative paths after login.
  function goNext(role) {
    const next = params.get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : HOME[role];
  }

  const me = await getMe();
  if (me) return (location.href = HOME[me.role]);

  const loginForm = $('#loginForm');
  if (loginForm) {
    const toggle = $('.role-toggle');
    const setRole = role => {
      loginForm.dataset.role = role;
      $$('button', toggle).forEach(b => b.classList.toggle('on', b.dataset.role === role));
      $('#signupLink').href = role === 'labourer' ? '/signup-labourer' : '/signup-poster';
    };
    if (toggle) {
      toggle.addEventListener('click', e => e.target.dataset.role && setRole(e.target.dataset.role));
      if (['poster', 'labourer'].includes(params.get('role'))) setRole(params.get('role'));
    }
    handleForm(loginForm, async data => {
      const { user } = await api('/auth/login', { method: 'POST', body: { ...data, role: loginForm.dataset.role } });
      goNext(user.role);
    });
  }

  const signupForm = $('#signupForm');
  if (signupForm) {
    passwordMeter(signupForm.password);
    const isLabourer = signupForm.dataset.role === 'labourer';
    if (isLabourer) {
      $('#tradeChecks').innerHTML = tradeChecks();
      areaOptions()
        .then(html => ($('#areaSelect').innerHTML = html))
        .catch(() => ($('#areaSelect').innerHTML = '<option value="">Could not load areas, please refresh</option>'));
    }
    handleForm(signupForm, async data => {
      if (isLabourer && !data.trades) throw new Error('Pick at least one trade.');
      const { user } = await api('/auth/register', { method: 'POST', body: { ...data, role: signupForm.dataset.role } });
      sessionStorage.setItem('welcome', '1');
      goNext(user.role);
    });
  }
})();
