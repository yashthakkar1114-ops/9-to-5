// Small input helpers. Each throws a 400 error with a readable message.
const { query } = require('./db');

const TRADES = ['Plumber', 'Carpenter', 'Electrician', 'Mover', 'Painter', 'Mason', 'Cleaner', 'Helper'];

// Kept in step with PASSWORD_RULES in public/js/common.js, which shows them live while typing.
const PASSWORD_RULES = [
  [/^.{8,}$/, 'at least 8 characters'],
  [/[A-Z]/, 'an uppercase letter'],
  [/[a-z]/, 'a lowercase letter'],
  [/\d/, 'a number'],
  [/[^A-Za-z0-9\s]/, 'a special character'],
];

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

function password(value, field = 'Password') {
  const v = str(value, field, { max: 72 });
  const missing = PASSWORD_RULES.filter(([re]) => !re.test(v)).map(([, label]) => label);
  if (missing.length) throw new BadRequest(`${field} needs ${missing.join(', ')}.`);
  return v;
}

function trade(value) {
  if (!TRADES.includes(value)) throw new BadRequest('Choose a valid trade.');
  return value;
}

// Accepts ['Painter', 'Mason'] or 'Painter,Mason'; returns 'Painter,Mason' in TRADES order.
function trades(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const picked = list.map(t => String(t).trim()).filter(Boolean);
  if (!picked.length) throw new BadRequest('Choose at least one trade.');
  if (!picked.every(t => TRADES.includes(t))) throw new BadRequest('Choose a valid trade.');
  return TRADES.filter(t => picked.includes(t)).join(',');
}

// Must be one of the areas the admin has added.
async function area(value) {
  const v = str(value, 'Area', { max: 100 });
  const [row] = await query('SELECT name FROM areas WHERE name = ?', [v]);
  if (!row) throw new BadRequest('Choose an area from the list.');
  return row.name;
}

function date(value, field = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw new BadRequest(`${field} must be a valid date.`);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (value < today) throw new BadRequest(`${field} cannot be in the past.`);
  return value;
}

module.exports = { TRADES, BadRequest, str, int, email, phone, password, trade, trades, area, date };
