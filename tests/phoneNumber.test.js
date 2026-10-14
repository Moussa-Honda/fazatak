import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone, toE164Phone } from '../src/services/phoneNumber.js';

test('normalizes Arabic-Indic digits', () => {
  assert.equal(normalizePhone('٠٥٥ ١٢٣ ٤٥٦٧'), '0551234567');
  assert.equal(normalizePhone('۰۵۵۱۲۳۴۵۶۷'), '0551234567');
});

test('normalizes supported Saudi number forms to E.164', () => {
  assert.equal(toE164Phone('0551234567'), '+966551234567');
  assert.equal(toE164Phone('551234567'), '+966551234567');
  assert.equal(toE164Phone('966551234567'), '+966551234567');
  assert.equal(toE164Phone('+966 55 123 4567'), '+966551234567');
});

test('rejects incomplete phone numbers', () => {
  assert.throws(() => toE164Phone('1234'));
});
