// Small input helpers. Each throws a 400 error with a readable message.

const TRADES = ['Plumber', 'Carpenter', 'Electrician', 'Mover', 'Painter', 'Mason', 'Cleaner', 'Helper'];

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function str(value, field, { min = 1, max = 255, optional = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v && optional) return '';
  if (v.length < min) throw new BadRequest(`${field} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  if (v.length > max) throw new BadRequest(`${field} is too long (max ${max} characters).`);
  return v;
}

function int(value, field, { min = 0, max = 10_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`${field} must be a whole number between ${min} and ${max}.`);
  return n;
}

function email(value) {
  const v = str(value, 'Email', { max: 150 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new BadRequest('Enter a valid email address.');
  return v;
}

function phone(value) {
  const v = str(value, 'Phone', { max: 15 }).replace(/[\s-]/g, '');
  if (!/^\+?\d{10,13}$/.test(v)) throw new BadRequest('Enter a valid phone number (10 digits).');
  return v;
}

function trade(value) {
  if (!TRADES.includes(value)) throw new BadRequest('Choose a valid trade.');
  return value;
}

function date(value, field = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw new BadRequest(`${field} must be a valid date.`);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (value < today) throw new BadRequest(`${field} cannot be in the past.`);
  return value;
}

module.exports = { TRADES, BadRequest, str, int, email, phone, trade, date };
