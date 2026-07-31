'use strict';

require('dotenv').config();

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createMailRouter } = require('./routes/mail');

function readPositiveInteger(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function getRuntimeConfig() {
  return Object.freeze({
    host: String(process.env.HOST || '127.0.0.1').trim(),
    port: readPositiveInteger('PORT', 3000, { max: 65_535 }),
    maxRecipients: readPositiveInteger('MAX_RECIPIENTS', 100, { max: 1_000 }),
    sendDelayMs: readPositiveInteger('SEND_DELAY_MS', 500, { min: 0, max: 60_000 }),
    maxFileSizeMb: readPositiveInteger('MAX_FILE_SIZE_MB', 10, { max: 100 }),
    maxAttachments: 5
  });
}

function createApp(config = getRuntimeConfig()) {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.get('/api/config', (_req, res) => {
    res.json({
      maxRecipients: config.maxRecipients,
      sendDelayMs: config.sendDelayMs,
      maxFileSizeMb: config.maxFileSizeMb,
      maxAttachments: config.maxAttachments
    });
  });

  app.use('/api', createMailRouter(config));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint no encontrado.' });
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();

    const isJsonSyntaxError = error instanceof SyntaxError && error.type === 'entity.parse.failed';
    const status = isJsonSyntaxError ? 400 : error.status || 500;
    const message =
      status === 413
        ? 'La petición o alguno de los archivos supera el tamaño permitido.'
        : status === 400
          ? 'La petición no tiene un formato válido.'
          : 'No se pudo procesar la petición.';

    res.status(status).json({ ok: false, error: message });
  });

  return app;
}

if (require.main === module) {
  const config = getRuntimeConfig();
  const app = createApp(config);
  const server = app.listen(config.port, config.host, () => {
    console.log(`SMTP Mailer disponible en http://${config.host}:${config.port}`);
  });
  server.on('error', (error) => {
    console.error(`No se pudo iniciar el servidor HTTP (${error.code || 'ERROR'}).`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, getRuntimeConfig };
