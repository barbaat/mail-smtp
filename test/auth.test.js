'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionToken,
  safeEqual,
  sessionCookie,
  verifySessionToken
} = require('../utils/auth');
const { ValidationError, validateSmtpConfig } = require('../utils/validation');

test('crea una sesión firmada que rechaza contraseñas incorrectas', () => {
  const token = createSessionToken('web-secret');

  assert.equal(verifySessionToken(token, 'web-secret'), true);
  assert.equal(verifySessionToken(token, 'otra-clave'), false);
  assert.equal(safeEqual('web-secret', 'otra-clave'), false);
  assert.match(sessionCookie(token), /HttpOnly; SameSite=Strict/);
});

test('la configuración SMTP usa únicamente la contraseña del servidor', () => {
  const config = validateSmtpConfig(
    {
      host: 'smtp.example.com',
      port: 465,
      security: 'ssl',
      username: 'user@example.com',
      password: 'contraseña-del-navegador'
    },
    'contraseña-del-servidor'
  );

  assert.equal(config.password, 'contraseña-del-servidor');
  assert.throws(
    () => validateSmtpConfig(config, ''),
    (error) => error instanceof ValidationError && error.details.includes('Configura SMTP_PASSWORD en el servidor.')
  );
});
