'use strict';

const form = document.querySelector('#login-form');
const password = document.querySelector('#web-password');
const errorMessage = document.querySelector('#login-error');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) return form.reportValidity();

  submitButton.disabled = true;
  submitButton.classList.add('is-loading');
  errorMessage.textContent = '';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
    window.location.replace('/');
  } catch (error) {
    password.select();
    errorMessage.textContent = error.message || 'No se pudo iniciar sesión.';
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
  }
});
