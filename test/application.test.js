'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server');

test('la aplicación Express se construye con las rutas y límites configurados', () => {
  const app = createApp({
    host: '127.0.0.1',
    port: 3000,
    maxRecipients: 25,
    sendDelayMs: 200,
    maxFileSizeMb: 2,
    maxAttachments: 5
  });

  assert.equal(typeof app, 'function');
  assert.ok(app._router.stack.some((layer) => layer.regexp?.toString().includes('api')));
});

test('la entrada serverless de Vercel exporta la aplicación Express', () => {
  const handler = require('../api');

  assert.equal(typeof handler, 'function');
});

test('la página principal referencia sus recursos y controles críticos', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  for (const expected of [
    'href="/styles.css"',
    'src="/app.js"',
    'id="smtp-host"',
    'value="smtp.gmail.com"',
    'value="465"',
    'value="Francisco Javier Barba Trejo"',
    'value="barbatrejofco@gmail.com"',
    'id="recipients"',
    'id="test-smtp"',
    'id="send-mails"',
    'id="cancel-send"',
    'id="download-csv"'
  ]) {
    assert.ok(html.includes(expected), `Falta ${expected}`);
  }
});
