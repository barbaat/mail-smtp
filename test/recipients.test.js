'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecipients } = require('../utils/recipients');

test('normaliza separadores, elimina duplicados y conserva direcciones válidas', () => {
  const result = normalizeRecipients(
    ' ana@example.com,\nLUIS@example.com; uno@example.com dos@example.com; luis@EXAMPLE.com '
  );

  assert.deepEqual(result.valid, [
    'ana@example.com',
    'LUIS@example.com',
    'uno@example.com',
    'dos@example.com'
  ]);
  assert.deepEqual(result.invalid, []);
});

test('separa las direcciones inválidas', () => {
  const result = normalizeRecipients('bien@example.com, sin-arroba, mal@, otro@example.org');

  assert.deepEqual(result.valid, ['bien@example.com', 'otro@example.org']);
  assert.deepEqual(result.invalid, ['sin-arroba', 'mal@']);
});
