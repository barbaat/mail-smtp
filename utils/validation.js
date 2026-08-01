'use strict';

const path = require('node:path');
const validator = require('validator');
const sanitizeHtml = require('sanitize-html');
const { normalizeRecipients } = require('./recipients');

const SECURITY_MODES = new Set(['ssl', 'starttls', 'none']);
const CONTENT_TYPES = new Set(['text', 'html']);
const SAFE_HTML_OPTIONS = {
  allowedTags: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'i',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'u',
    'ul'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard'
};

function cleanSingleLine(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function parseJsonField(value, fieldName) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    throw new ValidationError(`El campo ${fieldName} no tiene un formato válido.`);
  }
}

class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
    this.status = 400;
  }
}

function validateSmtpConfig(input, serverPassword = '') {
  const smtp = parseJsonField(input, 'smtpConfig');
  const host = cleanSingleLine(smtp.host, 253);
  const port = Number.parseInt(smtp.port, 10);
  const security = cleanSingleLine(smtp.security, 16).toLowerCase();
  const username = cleanSingleLine(smtp.username, 320);
  const password = String(serverPassword).slice(0, 1_024);
  const errors = [];

  const isHostValid =
    host === 'localhost' ||
    validator.isIP(host) ||
    validator.isFQDN(host, { require_tld: true, allow_underscores: false });

  if (!isHostValid) errors.push('Introduce un servidor SMTP válido.');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    errors.push('El puerto SMTP debe estar entre 1 y 65535.');
  }
  if (!SECURITY_MODES.has(security)) errors.push('Selecciona un tipo de seguridad válido.');
  if (!username) errors.push('Introduce el usuario SMTP.');
  if (!password) errors.push('Configura SMTP_PASSWORD en el servidor.');
  if (password.includes('\u0000')) errors.push('La contraseña SMTP contiene caracteres no válidos.');

  if (errors.length) throw new ValidationError('Revisa la configuración SMTP.', errors);

  return { host, port, security, username, password };
}

function validateSender(input) {
  const sender = parseJsonField(input, 'sender');
  const name = cleanSingleLine(sender.name, 120);
  const email = cleanSingleLine(sender.email, 254);
  const errors = [];

  if (!name) errors.push('Introduce el nombre del remitente.');
  if (!validator.isEmail(email, { allow_utf8_local_part: false, require_tld: true })) {
    errors.push('Introduce un correo de remitente válido.');
  }

  if (errors.length) throw new ValidationError('Revisa los datos del remitente.', errors);
  return { name, email };
}

function validateMessagePayload(body, maxRecipients, defaultDelayMs) {
  const sender = validateSender(body.sender);
  const recipients = normalizeRecipients(body.recipients);
  const subject = cleanSingleLine(body.subject, 200);
  const contentType = cleanSingleLine(body.contentType, 10).toLowerCase();
  const rawContent = String(body.content ?? '').replace(/\u0000/g, '').slice(0, 200_000);
  const delayCandidate = Number.parseInt(body.delayMs, 10);
  const delayMs = Number.isInteger(delayCandidate)
    ? Math.min(Math.max(delayCandidate, 0), 10_000)
    : defaultDelayMs;
  const operationId = cleanSingleLine(body.operationId, 80);
  const errors = [];

  if (!recipients.valid.length) errors.push('Añade al menos un destinatario válido.');
  if (recipients.invalid.length) {
    errors.push(`Hay ${recipients.invalid.length} destinatario(s) con formato no válido.`);
  }
  if (recipients.valid.length > maxRecipients) {
    errors.push(`El máximo por operación es de ${maxRecipients} destinatarios.`);
  }
  if (!subject) errors.push('Introduce un asunto.');
  if (!CONTENT_TYPES.has(contentType)) errors.push('Selecciona texto plano o HTML.');
  if (!rawContent.trim()) errors.push('Escribe el contenido del mensaje.');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(operationId)) {
    errors.push('No se pudo identificar la operación de envío.');
  }

  if (errors.length) throw new ValidationError('Revisa los datos del correo.', errors);

  const content =
    contentType === 'html'
      ? sanitizeHtml(rawContent, SAFE_HTML_OPTIONS).trim()
      : rawContent.replace(/\r\n?/g, '\n').trim();

  if (!content) throw new ValidationError('El contenido quedó vacío después de sanearlo.');

  return {
    sender,
    recipients: recipients.valid,
    subject,
    contentType,
    content,
    delayMs,
    operationId
  };
}

function sanitizeAttachments(files) {
  return (files || []).map((file) => ({
    filename:
      cleanSingleLine(path.basename(file.originalname || 'archivo'), 160).replace(/[<>:"/\\|?*]/g, '_') ||
      'archivo',
    content: file.buffer,
    contentType: cleanSingleLine(file.mimetype || 'application/octet-stream', 100)
  }));
}

module.exports = {
  ValidationError,
  validateSmtpConfig,
  validateMessagePayload,
  sanitizeAttachments
};
