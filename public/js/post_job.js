// Post Job page (also edits a job when opened as /post_job?edit=<id>).
(async () => {
  await requireLogin('poster');
  const form = $('#postJobForm');
  $('#tradeSelect').innerHTML = '<option value="">Choose a trade</option>' + tradeOptions();
  form.job_date.min = today();

  const editId = new URLSearchParams(location.search).get('edit');
  if (editId) {
    const { jobs } = await api('/jobs/mine');
    const job = jobs.find(j => j.id == editId);
    if (job) {
      $('#formTitle').textContent = 'Edit Job';
      $('button[type=submit]', form).textContent = 'Save changes';
      for (const k of ['title', 'trade', 'location', 'budget', 'job_date', 'details']) form[k].value = job[k] ?? '';
    }
  }

  handleForm(form, async data => {
    if (editId) await api('/jobs/' + editId, { method: 'PATCH', body: data });
    else await api('/jobs', { method: 'POST', body: data });
    sessionStorage.setItem('flash', editId ? 'Job updated.' : 'Job posted! Labourers can now apply.');
    location.href = '/dashboard';
  });
})();
