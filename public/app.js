'use strict';

const form = document.querySelector('#mail-form');
const elements = {
  host: document.querySelector('#smtp-host'),
  port: document.querySelector('#smtp-port'),
  security: document.querySelector('#smtp-security'),
  username: document.querySelector('#smtp-user'),
  passwordStatus: document.querySelector('#smtp-password-status'),
  senderName: document.querySelector('#sender-name'),
  senderEmail: document.querySelector('#sender-email'),
  recipientList: document.querySelector('#recipient-list'),
  addRecipient: document.querySelector('#add-recipient'),
  recipientLimit: document.querySelector('#recipient-limit'),
  subject: document.querySelector('#subject'),
  message: document.querySelector('#message'),
  attachments: document.querySelector('#attachments'),
  delayMs: document.querySelector('#delay-ms'),
  recipientCount: document.querySelector('#recipient-count'),
  recipientFeedback: document.querySelector('#recipient-feedback'),
  contentHint: document.querySelector('#content-hint'),
  fileSummary: document.querySelector('#file-summary'),
  smtpFeedback: document.querySelector('#smtp-feedback'),
  testButton: document.querySelector('#test-smtp'),
  sendButton: document.querySelector('#send-mails'),
  clearButton: document.querySelector('#clear-form'),
  cancelButton: document.querySelector('#cancel-send'),
  downloadButton: document.querySelector('#download-csv'),
  resultList: document.querySelector('#result-list'),
  emptyResults: document.querySelector('#empty-results'),
  operationState: document.querySelector('#operation-state'),
  progressBar: document.querySelector('#progress-bar'),
  metricTotal: document.querySelector('#metric-total'),
  metricPending: document.querySelector('#metric-pending'),
  metricSent: document.querySelector('#metric-sent'),
  metricErrors: document.querySelector('#metric-errors'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  confirmCount: document.querySelector('#confirm-count'),
  toast: document.querySelector('#toast'),
  logout: document.querySelector('#logout')
};

const presets = {
  gmail: { host: 'smtp.gmail.com', port: 465, security: 'ssl' },
  outlook: { host: 'smtp.office365.com', port: 587, security: 'starttls' },
  custom: { host: '', port: 587, security: 'starttls' }
};

const state = {
  config: {
    maxRecipients: 100,
    sendDelayMs: 500,
    maxFileSizeMb: 10,
    maxAttachments: 5,
    smtpPasswordConfigured: false
  },
  activeOperationId: null,
  results: new Map(),
  sending: false,
  toastTimer: null
};

function splitRecipientText(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((address) => address.trim())
    .filter(Boolean);
}

function parseRecipients(value) {
  const unique = new Map();
  const invalid = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const values = Array.isArray(value)
    ? value.flatMap((address) => splitRecipientText(address))
    : splitRecipientText(value);

  values
    .map((address) => String(address || '').trim())
    .filter(Boolean)
    .forEach((address) => {
      const key = address.toLowerCase();
      if (unique.has(key)) return;
      if (address.length <= 254 && emailPattern.test(address)) unique.set(key, address);
      else invalid.push(address);
    });

  return { valid: [...unique.values()], invalid };
}

function getRecipientInputs() {
  return [...elements.recipientList.querySelectorAll('.recipient-input')];
}

function updateRecipientControls() {
  const rows = [...elements.recipientList.querySelectorAll('.recipient-row')];
  const lockRows = state.sending || rows.length === 1;

  rows.forEach((row, index) => {
    const input = row.querySelector('.recipient-input');
    const removeButton = row.querySelector('.recipient-remove');
    const number = index + 1;
    input.id = `recipient-${number}`;
    input.setAttribute('aria-label', `Correo del destinatario ${number}`);
    removeButton.disabled = lockRows;
    removeButton.setAttribute('aria-label', `Eliminar destinatario ${number}`);
  });

  elements.addRecipient.disabled = state.sending || rows.length >= state.config.maxRecipients;
}

function createRecipientRow(value = '') {
  const row = document.createElement('div');
  row.className = 'recipient-row';
  row.setAttribute('role', 'listitem');

  const input = document.createElement('input');
  input.className = 'recipient-input';
  input.name = 'recipient';
  input.type = 'email';
  input.inputMode = 'email';
  input.placeholder = 'correo@ejemplo.com';
  input.maxLength = 254;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.required = true;
  input.value = value;

  const removeButton = document.createElement('button');
  removeButton.className = 'recipient-remove';
  removeButton.type = 'button';
  removeButton.textContent = 'Quitar';

  row.append(input, removeButton);
  return row;
}

function addRecipient(value = '', focus = true) {
  if (getRecipientInputs().length >= state.config.maxRecipients) {
    showToast(`Puedes añadir como máximo ${state.config.maxRecipients} destinatarios.`, true);
    return;
  }

  const row = createRecipientRow(value);
  elements.recipientList.append(row);
  updateRecipientControls();
  updateRecipientCount();
  if (focus) row.querySelector('.recipient-input').focus();
}

function addPastedRecipients(input, text) {
  const pastedRecipients = splitRecipientText(text);
  if (pastedRecipients.length < 2) return false;

  const currentValue = input.value.trim();
  const replacesCurrent =
    !currentValue || (input.selectionStart === 0 && input.selectionEnd === input.value.length);
  const pendingRecipients = [...pastedRecipients];
  let addedCount = 0;

  if (replacesCurrent) {
    input.value = pendingRecipients.shift();
    input.setCustomValidity('');
    addedCount = 1;
  }

  let anchorRow = input.closest('.recipient-row');
  const availableRows = state.config.maxRecipients - getRecipientInputs().length;
  const recipientsToInsert = pendingRecipients.slice(0, availableRows);

  for (const recipient of recipientsToInsert) {
    const row = createRecipientRow(recipient);
    anchorRow.after(row);
    anchorRow = row;
    addedCount += 1;
  }

  updateRecipientControls();
  updateRecipientCount();
  anchorRow.querySelector('.recipient-input').focus();

  if (recipientsToInsert.length < pendingRecipients.length) {
    showToast(`Solo se añadieron ${addedCount}: el máximo es ${state.config.maxRecipients}.`, true);
  } else {
    showToast(`${addedCount} correos añadidos.`);
  }
  return true;
}

function resetRecipientFields() {
  const rows = [...elements.recipientList.querySelectorAll('.recipient-row')];
  rows.slice(1).forEach((row) => row.remove());
  const input = rows[0].querySelector('.recipient-input');
  input.value = '';
  input.setCustomValidity('');
  updateRecipientControls();
}

function updateRecipientCount() {
  const { valid, invalid } = parseRecipients(getRecipientInputs().map((input) => input.value));
  elements.recipientCount.textContent = `${valid.length} ${valid.length === 1 ? 'válido' : 'válidos'}`;
  elements.recipientFeedback.textContent = invalid.length
    ? `No válidos: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`
    : '';
  return { valid, invalid };
}

function collectSmtpConfig() {
  return {
    host: elements.host.value.trim(),
    port: Number(elements.port.value),
    security: elements.security.value,
    username: elements.username.value.trim()
  };
}

function validateSmtpFields() {
  if (!state.config.smtpPasswordConfigured) {
    elements.smtpFeedback.className = 'inline-feedback is-error';
    elements.smtpFeedback.textContent = 'Configura SMTP_PASSWORD en las variables del servidor.';
    return false;
  }

  return (
    elements.host.checkValidity() &&
    elements.port.checkValidity() &&
    elements.username.checkValidity()
  );
}

function validateBeforeSend() {
  const recipientInputs = getRecipientInputs();
  recipientInputs.forEach((input) => input.setCustomValidity(''));
  const parsed = updateRecipientCount();
  validateSmtpFields();

  if (parsed.invalid.length) {
    const invalidKeys = new Set(parsed.invalid.map((address) => address.toLowerCase()));
    recipientInputs.forEach((input) => {
      if (invalidKeys.has(input.value.trim().toLowerCase())) {
        input.setCustomValidity('Introduce una dirección de correo válida.');
      }
    });
  } else if (parsed.valid.length > state.config.maxRecipients) {
    recipientInputs[0].setCustomValidity(
      `El máximo es de ${state.config.maxRecipients} destinatarios por operación.`
    );
  }

  const files = [...elements.attachments.files];
  const oversized = files.find((file) => file.size > state.config.maxFileSizeMb * 1024 * 1024);
  if (files.length > state.config.maxAttachments) {
    showToast(`Puedes adjuntar como máximo ${state.config.maxAttachments} archivos.`, true);
    return null;
  }
  if (oversized) {
    showToast(
      `"${oversized.name}" supera el máximo de ${state.config.maxFileSizeMb} MB.`,
      true
    );
    return null;
  }

  if (!validateSmtpFields() || !form.checkValidity()) {
    form.reportValidity();
    return null;
  }

  return parsed.valid;
}

function setButtonLoading(button, loading) {
  button.classList.toggle('is-loading', loading);
  button.disabled = loading;
}

function setSending(sending) {
  state.sending = sending;
  setButtonLoading(elements.sendButton, sending);
  elements.testButton.disabled = sending;
  elements.clearButton.disabled = sending;
  elements.cancelButton.disabled = !sending;
  document.querySelectorAll('.preset-button').forEach((button) => {
    button.disabled = sending;
  });
  updateRecipientControls();
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.classList.add('is-visible');
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, 4_500);
}

function setOperationState(label, type) {
  elements.operationState.textContent = label;
  elements.operationState.className = `status-chip status-chip--${type}`;
}

function updateSummary(summary) {
  elements.metricTotal.textContent = String(summary.total || 0);
  elements.metricPending.textContent = String(summary.pending || 0);
  elements.metricSent.textContent = String(summary.sent || 0);
  elements.metricErrors.textContent = String(summary.errors || 0);

  const processed = (summary.sent || 0) + (summary.errors || 0) + (summary.cancelled || 0);
  const percentage = summary.total ? Math.round((processed / summary.total) * 100) : 0;
  elements.progressBar.style.width = `${percentage}%`;
}

const statusLabels = {
  pending: 'Pendiente',
  sending: 'Enviando',
  sent: 'Enviado',
  error: 'Error',
  cancelled: 'Cancelado'
};

function renderResults() {
  const results = [...state.results.values()];
  elements.emptyResults.hidden = results.length > 0;
  elements.resultList.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const result of results) {
    const item = document.createElement('li');
    item.className = 'result-item';

    const address = document.createElement('p');
    address.className = 'result-address';
    address.textContent = result.recipient;
    address.title = result.recipient;

    const badge = document.createElement('span');
    badge.className = `status-chip status-chip--${result.status}`;
    badge.textContent = statusLabels[result.status] || result.status;

    item.append(address, badge);
    if (result.error) {
      const error = document.createElement('p');
      error.className = 'result-error';
      error.textContent = result.error;
      item.append(error);
    }
    fragment.append(item);
  }

  elements.resultList.append(fragment);
}

function handleStreamEvent(event) {
  if (event.type === 'started') {
    state.results.clear();
    event.results.forEach((result) => state.results.set(result.recipient.toLowerCase(), result));
    setOperationState('En curso', 'sending');
  } else if (event.type === 'sending' || event.type === 'result') {
    state.results.set(event.result.recipient.toLowerCase(), event.result);
  } else if (event.type === 'complete') {
    event.results.forEach((result) => state.results.set(result.recipient.toLowerCase(), result));
    const label = event.cancelled ? 'Cancelado' : event.summary.errors ? 'Con errores' : 'Completado';
    const type = event.cancelled ? 'cancelled' : event.summary.errors ? 'error' : 'complete';
    setOperationState(label, type);
    elements.downloadButton.disabled = false;
  } else if (event.type === 'fatal') {
    setOperationState('Interrumpido', 'error');
    showToast(event.error, true);
  }

  if (event.summary) updateSummary(event.summary);
  renderResults();
}

async function readNdjson(response) {
  if (!response.body) throw new Error('El navegador no permite leer el progreso del envío.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      handleStreamEvent(JSON.parse(line));
    }
    if (done) break;
  }

  if (buffer.trim()) handleStreamEvent(JSON.parse(buffer));
}

function askForConfirmation(count) {
  elements.confirmCount.textContent = String(count);
  elements.confirmDialog.returnValue = 'cancel';
  elements.confirmDialog.showModal();

  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener(
      'close',
      () => resolve(elements.confirmDialog.returnValue === 'confirm'),
      { once: true }
    );
  });
}

async function testSmtp() {
  const smtpIsValid = validateSmtpFields();
  if (
    !smtpIsValid ||
    !elements.host.checkValidity() ||
    !elements.port.checkValidity() ||
    !elements.username.checkValidity()
  ) {
    form.reportValidity();
    return;
  }

  setButtonLoading(elements.testButton, true);
  elements.smtpFeedback.className = 'inline-feedback';
  elements.smtpFeedback.textContent = 'Comprobando conexión…';

  try {
    const response = await fetch('/api/test-smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smtpConfig: collectSmtpConfig() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error([data.error, ...(data.details || [])].join(' '));

    elements.smtpFeedback.className = 'inline-feedback is-success';
    elements.smtpFeedback.textContent = data.message;
  } catch (error) {
    elements.smtpFeedback.className = 'inline-feedback is-error';
    elements.smtpFeedback.textContent = error.message || 'No se pudo comprobar la conexión.';
  } finally {
    setButtonLoading(elements.testButton, false);
  }
}

async function startSend(event) {
  event.preventDefault();
  if (state.sending) return;

  const recipients = validateBeforeSend();
  if (!recipients) return;

  const confirmed = await askForConfirmation(recipients.length);
  if (!confirmed) return;

  state.activeOperationId = crypto.randomUUID();
  state.results.clear();
  elements.downloadButton.disabled = true;
  setSending(true);
  setOperationState('Preparando', 'sending');
  updateSummary({ total: recipients.length, pending: recipients.length, sent: 0, errors: 0 });
  renderResults();

  const payload = new FormData();
  payload.set('smtpConfig', JSON.stringify(collectSmtpConfig()));
  payload.set(
    'sender',
    JSON.stringify({
      name: elements.senderName.value.trim(),
      email: elements.senderEmail.value.trim()
    })
  );
  payload.set('recipients', recipients.join('\n'));
  payload.set('subject', elements.subject.value.trim());
  payload.set('content', elements.message.value);
  payload.set('contentType', form.elements.contentType.value);
  payload.set('delayMs', elements.delayMs.value);
  payload.set('operationId', state.activeOperationId);
  [...elements.attachments.files].forEach((file) => payload.append('attachments', file, file.name));

  try {
    const response = await fetch('/api/send', { method: 'POST', body: payload });
    if (!response.ok) {
      const data = await response.json();
      throw new Error([data.error, ...(data.details || [])].join(' '));
    }
    await readNdjson(response);
  } catch (error) {
    setOperationState('Interrumpido', 'error');
    showToast(error.message || 'No se pudo completar la operación.', true);
  } finally {
    setSending(false);
    state.activeOperationId = null;
  }
}

async function cancelSend() {
  if (!state.activeOperationId || !state.sending) return;
  elements.cancelButton.disabled = true;
  elements.cancelButton.textContent = 'Cancelando…';

  try {
    const response = await fetch(`/api/send/${encodeURIComponent(state.activeOperationId)}/cancel`, {
      method: 'POST'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showToast(data.message);
  } catch (error) {
    elements.cancelButton.disabled = false;
    showToast(error.message || 'No se pudo solicitar la cancelación.', true);
  } finally {
    elements.cancelButton.textContent = 'Cancelar pendientes';
  }
}

function downloadCsv() {
  const rows = [['Destinatario', 'Estado', 'Fecha y hora', 'Mensaje de error']];
  for (const result of state.results.values()) {
    rows.push([
      result.recipient,
      statusLabels[result.status] || result.status,
      result.timestamp || '',
      result.error || ''
    ]);
  }

  const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `resultado-smtp-${new Date().toISOString().replaceAll(':', '-')}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetForm() {
  if (state.sending) return;
  form.reset();
  resetRecipientFields();
  applyPreset('gmail');
  elements.fileSummary.textContent = 'Ningún archivo seleccionado';
  elements.smtpFeedback.className = 'inline-feedback';
  elements.smtpFeedback.textContent = 'La contraseña SMTP nunca se envía al navegador.';
  state.results.clear();
  elements.downloadButton.disabled = true;
  setOperationState('Sin iniciar', 'idle');
  updateSummary({ total: 0, pending: 0, sent: 0, errors: 0 });
  renderResults();
  updateRecipientCount();
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset || state.sending) return;

  elements.host.value = preset.host;
  elements.port.value = String(preset.port);
  elements.security.value = preset.security;
  document.querySelectorAll('.preset-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.preset === name);
  });
  if (name === 'custom') elements.host.focus();
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    state.config = { ...state.config, ...(await response.json()) };
    elements.passwordStatus.textContent = state.config.smtpPasswordConfigured
      ? 'Configurada de forma segura en el servidor'
      : 'Falta la variable SMTP_PASSWORD';
    elements.passwordStatus.classList.toggle('is-error', !state.config.smtpPasswordConfigured);
    elements.delayMs.value = String(state.config.sendDelayMs);
    elements.recipientLimit.textContent =
      `Pega una lista separada por comas, punto y coma, espacios o saltos. ` +
      `Máximo ${state.config.maxRecipients}.`;
    updateRecipientControls();
    elements.attachments.accept = '*/*';
  } catch {
    showToast('No se pudo cargar la configuración del servidor.', true);
  }
}

document.querySelectorAll('.preset-button').forEach((button) => {
  button.addEventListener('click', () => applyPreset(button.dataset.preset));
});
document.querySelectorAll('input[name="contentType"]').forEach((input) => {
  input.addEventListener('change', () => {
    elements.contentHint.textContent =
      input.value === 'html' && input.checked
        ? 'Se saneará el HTML antes de enviarlo. No se permiten scripts ni seguimiento.'
        : 'Se enviará como texto plano. No se añade seguimiento de aperturas.';
  });
});
elements.addRecipient.addEventListener('click', () => addRecipient());
elements.recipientList.addEventListener('input', (event) => {
  if (!event.target.classList.contains('recipient-input')) return;
  event.target.setCustomValidity('');
  updateRecipientCount();
});
elements.recipientList.addEventListener('paste', (event) => {
  if (!event.target.classList.contains('recipient-input')) return;
  const pastedText = event.clipboardData?.getData('text') || '';
  if (addPastedRecipients(event.target, pastedText)) event.preventDefault();
});
elements.recipientList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !event.target.classList.contains('recipient-input')) return;
  event.preventDefault();
  if (!event.target.value.trim() || !event.target.checkValidity()) {
    event.target.reportValidity();
    return;
  }
  addRecipient();
});
elements.recipientList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('.recipient-remove');
  if (!removeButton || removeButton.disabled) return;

  const rows = [...elements.recipientList.querySelectorAll('.recipient-row')];
  const removedIndex = rows.indexOf(removeButton.closest('.recipient-row'));
  rows[removedIndex].remove();
  const remainingInputs = getRecipientInputs();
  updateRecipientControls();
  updateRecipientCount();
  remainingInputs[Math.max(0, removedIndex - 1)].focus();
});
elements.attachments.addEventListener('change', () => {
  const files = [...elements.attachments.files];
  elements.fileSummary.textContent = files.length
    ? `${files.length} ${files.length === 1 ? 'archivo' : 'archivos'} · ${files
        .map((file) => file.name)
        .join(', ')}`
    : 'Ningún archivo seleccionado';
});
elements.logout.addEventListener('click', async () => {
  elements.logout.disabled = true;
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    window.location.replace('/login');
  }
});
elements.testButton.addEventListener('click', testSmtp);
elements.cancelButton.addEventListener('click', cancelSend);
elements.downloadButton.addEventListener('click', downloadCsv);
elements.clearButton.addEventListener('click', resetForm);
form.addEventListener('submit', startSend);

updateRecipientControls();
updateRecipientCount();
loadConfig();
