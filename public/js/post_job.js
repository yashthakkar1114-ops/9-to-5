// Post Job page (also edits a job when opened as /post_job?edit=<id>).
(async () => {
  await requireLogin('poster');
  const form = $('#postJobForm');
  $('#tradeSelect').innerHTML = '<option value="">Choose a trade</option>' + tradeOptions();

  const editId = new URLSearchParams(location.search).get('edit');
  const job = editId ? (await api('/jobs/mine')).jobs.find(j => j.id == editId) : null;

  // Every job is a time slot: date + start time + duration.
  $('#slotBox').insertAdjacentHTML('beforeend', slotFields(job
    ? { date: job.job_date, start: job.start_time, minutes: job.duration_minutes }
    : {}));
  bindSlotFields($('#slotBox'));

  // Locations come from the admin's area list (an older job keeps its current location as an option).
  try {
    $('#areaSelect').innerHTML = await areaOptions(job?.location || '', 'Choose a location');
  } catch {
    $('#areaSelect').innerHTML = '<option value="">Could not load locations, please refresh</option>';
  }

  if (job) {
    $('#formTitle').textContent = 'Edit Job';
    $('button[type=submit]', form).textContent = 'Save changes';
    for (const k of ['title', 'trade', 'location', 'address', 'budget', 'details']) form[k].value = job[k] ?? '';
  }

  handleForm(form, async data => {
    if (editId) await api('/jobs/' + editId, { method: 'PATCH', body: data });
    else await api('/jobs', { method: 'POST', body: data });
    sessionStorage.setItem('flash', editId ? 'Job updated.' : 'Job posted! Labourers can now apply.');
    location.href = '/dashboard';
  });
})();
