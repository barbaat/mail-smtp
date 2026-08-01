'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'smtp_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(left, right) {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function sign(payload, password) {
  return crypto
    .createHmac('sha256', digest(`smtp-mailer:${password}`))
    .update(payload)
    .digest('base64url');
}

function createSessionToken(password, now = Date.now()) {
  const payload = `${now + SESSION_TTL_MS}.${crypto.randomBytes(18).toString('base64url')}`;
  return `${payload}.${sign(payload, password)}`;
}

function verifySessionToken(token, password, now = Date.now()) {
  if (!token || !password) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_TTL_MS) {
    return false;
  }

  return safeEqual(parts[2], sign(payload, password));
}

function readCookie(header, name = COOKIE_NAME) {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function sessionCookie(token, secure = false) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_MS / 1000}`,
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function clearSessionCookie(secure = false) {
  const attributes = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function requestIsSecure(req) {
  return Boolean(process.env.VERCEL) || req.secure || req.get('x-forwarded-proto') === 'https';
}

function requestIsAuthenticated(req, password) {
  return verifySessionToken(readCookie(req.get('cookie')), password);
}

module.exports = {
  clearSessionCookie,
  createSessionToken,
  requestIsAuthenticated,
  requestIsSecure,
  safeEqual,
  sessionCookie,
  verifySessionToken
};
