const jwt = require('jsonwebtoken');
const { query } = require('../db');

const COOKIE = 'token';

function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

// Attaches req.user if the cookie is valid and the account is still active.
async function loadUser(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return next();
  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const [user] = await query('SELECT id, name, email, phone, role, status FROM users WHERE id = ?', [id]);
    if (user && user.status === 'active') req.user = user;
    else clearAuthCookie(res);
  } catch {
    clearAuthCookie(res);
  }
  next();
}

// requireRole() = any logged-in user; requireRole('poster') = only posters, etc.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You are not allowed to do this.' });
    }
    next();
  };
}

module.exports = { setAuthCookie, clearAuthCookie, loadUser, requireRole };
