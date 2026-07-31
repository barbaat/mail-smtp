'use strict';

const nodemailer = require('nodemailer');

function createTransporter(smtpConfig) {
  const options = {
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.security === 'ssl',
    pool: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
    tls: {
      minVersion: 'TLSv1.2'
    }
  };

  if (smtpConfig.security === 'starttls') options.requireTLS = true;
  if (smtpConfig.security === 'none') options.ignoreTLS = true;
  if (smtpConfig.username && smtpConfig.password) {
    options.auth = {
      user: smtpConfig.username,
      pass: smtpConfig.password
    };
  }

  return nodemailer.createTransport(options);
}

function friendlySmtpError(error) {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode);

  if (code === 'EAUTH' || responseCode === 535) {
    return 'Autenticación rechazada. Revisa el usuario, la contraseña o la contraseña de aplicación.';
  }
  if (['ECONNECTION', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET'].includes(code)) {
    return 'No se pudo conectar con el servidor SMTP.';
  }
  if (responseCode === 550 || responseCode === 551 || responseCode === 553) {
    return 'El servidor rechazó esta dirección de destinatario.';
  }
  if (responseCode === 552) return 'El servidor rechazó el mensaje por su tamaño.';
  if (responseCode === 421 || responseCode === 450 || responseCode === 451) {
    return 'El servidor está aplicando un límite temporal. Inténtalo más tarde.';
  }
  if (code === 'EMESSAGE') return 'El servidor rechazó el contenido del mensaje.';
  return 'El servidor SMTP no pudo completar el envío.';
}

async function verifyConnection(smtpConfig) {
  const transporter = createTransporter(smtpConfig);
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendIndividualEmails({
  smtpConfig,
  sender,
  recipients,
  subject,
  contentType,
  content,
  attachments,
  delayMs,
  isCancelled,
  onStatus
}) {
  const transporter = createTransporter(smtpConfig);
  const results = [];

  try {
    for (let index = 0; index < recipients.length; index += 1) {
      const recipient = recipients[index];

      if (isCancelled()) {
        const cancelledAt = new Date().toISOString();
        for (const pendingRecipient of recipients.slice(index)) {
          const cancelledResult = {
            recipient: pendingRecipient,
            status: 'cancelled',
            timestamp: cancelledAt,
            error: ''
          };
          results.push(cancelledResult);
          onStatus('result', cancelledResult, results);
        }
        break;
      }

      onStatus(
        'sending',
        { recipient, status: 'sending', timestamp: new Date().toISOString(), error: '' },
        results
      );

      try {
        const message = {
          from: { name: sender.name, address: sender.email },
          to: recipient,
          subject,
          attachments
        };
        message[contentType === 'html' ? 'html' : 'text'] = content;

        await transporter.sendMail(message);
        const sentResult = {
          recipient,
          status: 'sent',
          timestamp: new Date().toISOString(),
          error: ''
        };
        results.push(sentResult);
        onStatus('result', sentResult, results);
      } catch (error) {
        const failedResult = {
          recipient,
          status: 'error',
          timestamp: new Date().toISOString(),
          error: friendlySmtpError(error)
        };
        results.push(failedResult);
        onStatus('result', failedResult, results);
      }

      if (index < recipients.length - 1 && delayMs > 0 && !isCancelled()) {
        await wait(delayMs);
      }
    }
  } finally {
    transporter.close();
  }

  return results;
}

module.exports = {
  friendlySmtpError,
  verifyConnection,
  sendIndividualEmails
};
