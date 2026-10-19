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
    <div class="pay-amount">${rupees(b.amount)}</div>
    <form id="payForm">
      <fieldset class="field-group">
        <legend>Pay with</legend>
        <div class="chips">${Object.entries(METHODS).map(([k, label], i) => `
          <label class="chip"><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </fieldset>
      <div class="form-error"></div>
      <button class="btn block success" type="submit">Pay ${rupees(b.amount)}</button>
      <p class="mock-note">Demo only: no card or UPI details are collected and no money is charged.</p>
    </form>`;
  handleForm($('#payForm'), async data => {
    const { payment_ref } = await api(`/bookings/${b.id}/pay`, { method: 'POST', body: { method: data.method } });
    toast('Payment successful.');
    receipt({ ...b, payment_ref, payment_method: data.method, paid_at: new Date().toISOString() });
  });
})().catch(err => {
  $('#payBox').innerHTML = `<p class="empty error">${esc(err.message)}</p>`;
});
