'use strict';

require('dotenv').config();

const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createMailRouter } = require('./routes/mail');
const {
  clearSessionCookie,
  createSessionToken,
  requestIsAuthenticated,
  requestIsSecure,
  safeEqual,
  sessionCookie
} = require('./utils/auth');

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
    maxAttachments: 5,
    smtpPassword: String(process.env.SMTP_PASSWORD || ''),
    webPassword: String(process.env.WEB_PASSWORD || '')
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

  const publicDirectory = path.join(__dirname, 'public');
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'Demasiados intentos. Espera unos minutos.' }
  });

  app.get('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (config.webPassword && requestIsAuthenticated(req, config.webPassword)) {
      return res.redirect('/');
    }
    return res.sendFile(path.join(publicDirectory, 'login.html'));
  });
  app.get('/login.js', (_req, res) => res.sendFile(path.join(publicDirectory, 'login.js')));
  app.get('/styles.css', (_req, res) => res.sendFile(path.join(publicDirectory, 'styles.css')));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  app.post('/api/login', loginLimiter, (req, res) => {
    if (!config.webPassword) {
      return res.status(503).json({
        ok: false,
        error: 'El acceso no está configurado. Añade WEB_PASSWORD en el servidor.'
      });
    }

    const password = String(req.body?.password || '').slice(0, 1_024);
    if (!safeEqual(password, config.webPassword)) {
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
    }

    res.set('Set-Cookie', sessionCookie(createSessionToken(config.webPassword), requestIsSecure(req)));
    return res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.set('Set-Cookie', clearSessionCookie(requestIsSecure(req)));
    return res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (!config.webPassword) {
      const error = 'El acceso no está configurado. Añade WEB_PASSWORD en el servidor.';
      return req.path.startsWith('/api')
        ? res.status(503).json({ ok: false, error })
        : res.status(503).send(error);
    }
    if (requestIsAuthenticated(req, config.webPassword)) return next();
    if (req.path.startsWith('/api')) {
      return res.status(401).json({ ok: false, error: 'Autenticación requerida.' });
    }
    return res.redirect('/login');
  });

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      maxRecipients: config.maxRecipients,
      sendDelayMs: config.sendDelayMs,
      maxFileSizeMb: config.maxFileSizeMb,
      maxAttachments: config.maxAttachments,
      smtpPasswordConfigured: Boolean(config.smtpPassword)
    });
  });

  app.use('/api', createMailRouter(config));
  app.use(express.static(publicDirectory, { extensions: ['html'] }));

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

const app = createApp(getRuntimeConfig());

if (require.main === module) {
  const { host, port } = getRuntimeConfig();
  const server = app.listen(port, host, () => {
    console.log(`SMTP Mailer disponible en http://${host}:${port}`);
  });
  server.on('error', (error) => {
    console.error(`No se pudo iniciar el servidor HTTP (${error.code || 'ERROR'}).`);
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.getRuntimeConfig = getRuntimeConfig;
