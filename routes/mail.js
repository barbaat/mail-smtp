'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const {
  ValidationError,
  validateSmtpConfig,
  validateMessagePayload,
  sanitizeAttachments
} = require('../utils/validation');
const {
  friendlySmtpError,
  verifyConnection,
  sendIndividualEmails
} = require('../services/smtpMailer');

function summarize(results, total) {
  const sent = results.filter((result) => result.status === 'sent').length;
  const errors = results.filter((result) => result.status === 'error').length;
  const cancelled = results.filter((result) => result.status === 'cancelled').length;
  return {
    total,
    pending: Math.max(total - results.length, 0),
    sent,
    errors,
    cancelled
  };
}

function createMailRouter(config) {
  const router = express.Router();
  const activeOperations = new Map();
  const maxRequestBytes =
    config.maxAttachments * config.maxFileSizeMb * 1024 * 1024 + 1024 * 1024;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
      files: config.maxAttachments,
      fields: 20,
      fieldSize: 256 * 1024,
      parts: config.maxAttachments + 20
    }
  });

  const sendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      ok: false,
      error: 'Se ha alcanzado el límite de operaciones de envío. Espera unos minutos.'
    }
  });

  function requestSizeGuard(req, res, next) {
    const contentLength = Number(req.get('content-length') || 0);
    if (contentLength > maxRequestBytes) {
      return res.status(413).json({
        ok: false,
        error: 'La petición o los archivos superan el tamaño máximo permitido.'
      });
    }
    return next();
  }

  router.post('/test-smtp', async (req, res) => {
    const startedAt = Date.now();
    try {
      const smtpConfig = validateSmtpConfig(req.body.smtpConfig || req.body, config.smtpPassword);
      console.info('[smtp:test] started', {
        host: smtpConfig.host,
        port: smtpConfig.port,
        security: smtpConfig.security
      });
      await verifyConnection(smtpConfig);
      console.info('[smtp:test] completed', { durationMs: Date.now() - startedAt });
      return res.json({ ok: true, message: 'Conexión SMTP verificada correctamente.' });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ ok: false, error: error.message, details: error.details });
      }
      console.error('[smtp:test] failed', {
        code: String(error?.code || 'UNKNOWN'),
        responseCode: Number(error?.responseCode) || null,
        durationMs: Date.now() - startedAt
      });
      return res.status(502).json({ ok: false, error: friendlySmtpError(error) });
    }
  });

  router.post(
    '/send',
    sendLimiter,
    requestSizeGuard,
    (req, res, next) => {
      upload.array('attachments', config.maxAttachments)(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError) {
          const message =
            error.code === 'LIMIT_FILE_SIZE'
              ? `Cada archivo puede ocupar como máximo ${config.maxFileSizeMb} MB.`
              : error.code === 'LIMIT_FILE_COUNT'
                ? `Puedes adjuntar como máximo ${config.maxAttachments} archivos.`
                : 'Los archivos adjuntos no cumplen los límites permitidos.';
          return res.status(413).json({ ok: false, error: message });
        }
        return next(error);
      });
    },
    async (req, res) => {
      let smtpConfig;
      let mailData;

      try {
        smtpConfig = validateSmtpConfig(req.body.smtpConfig, config.smtpPassword);
        mailData = validateMessagePayload(req.body, config.maxRecipients, config.sendDelayMs);
      } catch (error) {
        if (error instanceof ValidationError) {
          return res.status(400).json({ ok: false, error: error.message, details: error.details });
        }
        return res.status(400).json({ ok: false, error: 'No se pudo validar la petición.' });
      }

      if (activeOperations.has(mailData.operationId)) {
        return res.status(409).json({ ok: false, error: 'Ya existe una operación con ese identificador.' });
      }

      const operation = { cancelled: false };
      activeOperations.set(mailData.operationId, operation);
      const attachments = sanitizeAttachments(req.files);
      const total = mailData.recipients.length;

      res.status(200);
      res.set({
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();

      const writeEvent = (event) => {
        if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
      };

      writeEvent({
        type: 'started',
        operationId: mailData.operationId,
        summary: summarize([], total),
        results: mailData.recipients.map((recipient) => ({
          recipient,
          status: 'pending',
          timestamp: '',
          error: ''
        }))
      });

      res.on('close', () => {
        if (!res.writableEnded) operation.cancelled = true;
      });

      try {
        const results = await sendIndividualEmails({
          smtpConfig,
          sender: mailData.sender,
          recipients: mailData.recipients,
          subject: mailData.subject,
          contentType: mailData.contentType,
          content: mailData.content,
          attachments,
          delayMs: mailData.delayMs,
          isCancelled: () => operation.cancelled,
          onStatus: (type, result, currentResults) => {
            writeEvent({
              type,
              result,
              summary: summarize(currentResults, total)
            });
          }
        });

        writeEvent({
          type: 'complete',
          cancelled: operation.cancelled,
          summary: summarize(results, total),
          results
        });
      } catch {
        writeEvent({
          type: 'fatal',
          error: 'La operación de envío se interrumpió de forma inesperada.'
        });
      } finally {
        activeOperations.delete(mailData.operationId);
        smtpConfig = null;
        mailData = null;
        if (!res.writableEnded) res.end();
      }
    }
  );

  router.post('/send/:operationId/cancel', (req, res) => {
    const operationId = String(req.params.operationId || '');
    const operation = activeOperations.get(operationId);
    if (!operation) {
      return res.status(404).json({ ok: false, error: 'La operación ya no está activa.' });
    }
    operation.cancelled = true;
    return res.json({
      ok: true,
      message: 'Cancelación solicitada. No se iniciarán más envíos.'
    });
  });

  return router;
}

module.exports = { createMailRouter };
