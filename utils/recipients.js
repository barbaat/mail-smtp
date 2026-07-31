'use strict';

const validator = require('validator');

const MAX_ADDRESS_LENGTH = 254;

function normalizeRecipients(input) {
  const rawValues = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/);
  const valid = [];
  const invalid = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const address = String(rawValue || '').trim();
    if (!address) continue;

    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      address.length <= MAX_ADDRESS_LENGTH &&
      validator.isEmail(address, {
        allow_utf8_local_part: false,
        require_tld: true,
        ignore_max_length: false
      })
    ) {
      valid.push(address);
    } else {
      invalid.push(address);
    }
  }

  return { valid, invalid };
}

module.exports = { normalizeRecipients };
