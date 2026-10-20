// Mock payment page for a completed booking: /pay?booking=<id>. No real money moves.
(async () => {
  await requireLogin('poster');
  const box = $('#payBox');
  const id = Number(new URLSearchParams(location.search).get('booking'));
  const METHODS = { upi: 'UPI', card: 'Debit / Credit card', netbanking: 'Net banking' };

  function receipt(b) {
    box.innerHTML = `
      <div class="receipt">
        <div class="tick">✔</div>
        <h1>Payment successful</h1>
        <p class="muted">${rupees(b.amount)} paid to ${esc(b.other_name)}</p>
        <dl>
          <dt>Reference</dt><dd>${esc(b.payment_ref)}</dd>
          <dt>Method</dt><dd>${esc(METHODS[b.payment_method] || b.payment_method)}</dd>
          <dt>Paid on</dt><dd>${fmtDate(b.paid_at)}</dd>
          <dt>Work</dt><dd>${esc(b.note || 'Booking #' + b.id)}</dd>
        </dl>
        <p class="mock-note">This is a mock payment for demo purposes. No real money was charged.</p>
        ${b.rating ? '' : `<a class="btn block" href="/dashboard?tab=bookings&rate=${b.id}">Rate ${esc(b.other_name.split(' ')[0])}</a>`}
      </div>`;
  }

  const { bookings } = await api('/bookings');
  const b = bookings.find(x => x.id === id);
  if (!b) return (box.innerHTML = '<p class="empty error">Booking not found.</p>');
  if (b.paid_at) return receipt(b);
  if (b.status !== 'completed') {
    return (box.innerHTML = `<p class="empty">You can pay once the work is marked completed. It is currently <strong>${esc(b.status.replace('_', ' '))}</strong>.</p>`);
  }

  box.innerHTML = `
    <span class="mock-badge">Mock payment · test mode</span>
    <h1 style="margin-top:10px">Pay ${esc(b.other_name)}</h1>
    <p class="muted">${esc(b.note || 'Booking #' + b.id)} · ${fmtDate(b.booking_date)}</p>
    <form id="payForm">
      <label class="pay-edit">Amount to pay
        <span class="pay-input"><span>₹</span><input name="amount" type="number" inputmode="numeric" min="1" max="10000000" step="1"
          required value="${b.amount}" aria-describedby="payDiff"></span>
      </label>
      <p class="pay-diff" id="payDiff">Agreed amount: ${rupees(b.amount)}</p>
      <div class="pay-quick">
        <button type="button" class="chip-btn" data-set="${b.amount}">Agreed ${rupees(b.amount)}</button>
        ${[50, 100, 200].map(t => `<button type="button" class="chip-btn" data-add="${t}">+ ₹${t} tip</button>`).join('')}
      </div>
      <fieldset class="field-group">
        <legend>Pay with</legend>
        <div class="chips">${Object.entries(METHODS).map(([k, label], i) => `
          <label class="chip"><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </fieldset>
      <div class="form-error"></div>
      <button class="btn block success" type="submit">Pay ${rupees(b.amount)}</button>
      <p class="mock-note">Demo only: no card or UPI details are collected and no money is charged.</p>
    </form>`;
  // Editable amount: the button and the "vs agreed" line follow what the poster types.
  const form = $('#payForm');
  const input = form.amount;
  const payBtn = $('button[type=submit]', form);
  const updateAmount = () => {
    const n = Math.round(Number(input.value));
    const valid = input.value !== '' && n >= 1;
    payBtn.textContent = valid ? `Pay ${rupees(n)}` : 'Enter an amount';
    payBtn.disabled = !valid;
    const diff = n - b.amount;
    $('#payDiff').innerHTML = !valid || diff === 0
      ? `Agreed amount: ${rupees(b.amount)}`
      : `Agreed amount: ${rupees(b.amount)} · <strong class="${diff > 0 ? 'success' : 'error'}">${rupees(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than agreed</strong>`;
  };
  input.addEventListener('input', updateAmount);
  $('.pay-quick', form).addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    input.value = btn.dataset.set ?? b.amount + Number(btn.dataset.add);
    updateAmount();
  });
  updateAmount();

  handleForm(form, async data => {
    const amount = Math.round(Number(data.amount));
    if (amount < b.amount && !confirm(`You are paying ${rupees(b.amount - amount)} less than the agreed ${rupees(b.amount)}. Continue?`)) return;
    const res = await api(`/bookings/${b.id}/pay`, { method: 'POST', body: { method: data.method, amount } });
    toast('Payment successful.');
    receipt({ ...b, amount: res.amount, payment_ref: res.payment_ref, payment_method: data.method, paid_at: new Date().toISOString() });
  });
})().catch(err => {
  $('#payBox').innerHTML = `<p class="empty error">${esc(err.message)}</p>`;
});
