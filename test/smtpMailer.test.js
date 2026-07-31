'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const {
  verifyConnection,
  sendIndividualEmails
} = require('../services/smtpMailer');

const smtpConfig = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  username: 'user@example.com',
  password: 'application-password'
};

test('verifyConnection ejecuta transporter.verify() y cierra el transporte', async (context) => {
  let verifyCalls = 0;
  let closeCalls = 0;
  const originalCreateTransport = nodemailer.createTransport;

  nodemailer.createTransport = (options) => {
    assert.equal(options.host, smtpConfig.host);
    assert.equal(options.requireTLS, true);
    assert.deepEqual(options.auth, {
      user: smtpConfig.username,
      pass: smtpConfig.password
    });
    return {
      async verify() {
        verifyCalls += 1;
      },
      close() {
        closeCalls += 1;
      }
    };
  };
  context.after(() => {
    nodemailer.createTransport = originalCreateTransport;
  });

  await verifyConnection(smtpConfig);

  assert.equal(verifyCalls, 1);
  assert.equal(closeCalls, 1);
});

test('envía una operación independiente por destinatario y continúa tras un error', async (context) => {
  const messages = [];
  const events = [];
  const originalCreateTransport = nodemailer.createTransport;

  nodemailer.createTransport = () => ({
    async sendMail(message) {
      messages.push(message);
      if (message.to === 'reject@example.com') {
        const error = new Error('Respuesta SMTP sensible que no debe llegar al cliente');
        error.responseCode = 550;
        throw error;
      }
      return { accepted: [message.to] };
    },
    close() {}
  });
  context.after(() => {
    nodemailer.createTransport = originalCreateTransport;
  });

  const results = await sendIndividualEmails({
    smtpConfig,
    sender: { name: 'Pruebas', email: 'sender@example.com' },
    recipients: ['one@example.com', 'reject@example.com', 'two@example.com'],
    subject: 'Mensaje individual',
    contentType: 'text',
    content: 'Contenido',
    attachments: [],
    delayMs: 0,
    isCancelled: () => false,
    onStatus(type, result) {
      events.push({ type, result });
    }
  });

  assert.equal(messages.length, 3);
  assert.deepEqual(
    messages.map((message) => message.to),
    ['one@example.com', 'reject@example.com', 'two@example.com']
  );
  assert.ok(messages.every((message) => !('cc' in message) && !('bcc' in message)));
  assert.deepEqual(
    results.map((result) => result.status),
    ['sent', 'error', 'sent']
  );
  assert.equal(results[1].error, 'El servidor rechazó esta dirección de destinatario.');
  assert.equal(
    events.filter((event) => event.type === 'sending').length,
    3
  );
});

test('la cancelación conserva procesados y marca solo los pendientes', async (context) => {
  let cancelled = false;
  const originalCreateTransport = nodemailer.createTransport;

  nodemailer.createTransport = () => ({
    async sendMail() {
      cancelled = true;
    },
    close() {}
  });
  context.after(() => {
    nodemailer.createTransport = originalCreateTransport;
  });

  const results = await sendIndividualEmails({
    smtpConfig,
    sender: { name: 'Pruebas', email: 'sender@example.com' },
    recipients: ['one@example.com', 'two@example.com', 'three@example.com'],
    subject: 'Cancelación',
    contentType: 'text',
    content: 'Contenido',
    attachments: [],
    delayMs: 0,
    isCancelled: () => cancelled,
    onStatus() {}
  });

  assert.deepEqual(
    results.map((result) => result.status),
    ['sent', 'cancelled', 'cancelled']
  );
});
