import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEarlySettlement,
  getPaidAmount,
  getRemainingAmount,
  isContractComplete,
  sumPaid
} from '../src/services/paymentRules.js';

const paidRows = (count, amount = 500) => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  amount,
  status: 'paid',
  actual_paid: amount
}));

const applyUpdates = (rows, updates) => rows.map((row) => {
  const update = updates.find((item) => item.id === row.id);
  if (!update) return row;

  const { applied, discountApplied, ...fields } = update;
  return { ...row, ...fields };
});

test('paid and remaining amounts handle legacy paid rows and partial payments', () => {
  assert.equal(getPaidAmount({ amount: 500, status: 'paid', actual_paid: 0 }), 500);
  assert.equal(getPaidAmount({ amount: 500, status: 'pending', actual_paid: 125 }), 125);
  assert.equal(getRemainingAmount({ amount: 500, status: 'pending', actual_paid: 125 }), 375);
});

test('early settlement after end postponement does not double count the postponed source', () => {
  const rows = [
    ...paidRows(14),
    { id: 15, amount: 500, status: 'postponed', actual_paid: 0 },
    { id: 16, amount: 500, status: 'pending', actual_paid: 0 },
    { id: 17, amount: 500, status: 'pending', actual_paid: 0 }
  ];

  const settlement = calculateEarlySettlement(rows, 8000);
  const updated = applyUpdates(rows, settlement.updates);

  assert.equal(settlement.paymentAmount, 1000);
  assert.deepEqual(settlement.updates.map((item) => item.id), [16, 17]);
  assert.equal(updated.find((item) => item.id === 15).status, 'postponed');
  assert.equal(sumPaid(updated), 8000);
  assert.equal(isContractComplete({ totalAmount: 8000, installments: updated }), true);
});

test('early settlement after next-installment postponement settles the merged target once', () => {
  const rows = [
    ...paidRows(14),
    { id: 15, amount: 500, status: 'postponed', actual_paid: 0 },
    { id: 16, amount: 1000, status: 'pending', actual_paid: 0 }
  ];

  const settlement = calculateEarlySettlement(rows, 8000);
  const updated = applyUpdates(rows, settlement.updates);

  assert.deepEqual(settlement.updates.map((item) => item.id), [16]);
  assert.equal(sumPaid(updated), 8000);
  assert.equal(Math.max(0, 8000 - sumPaid(updated)), 0);
});

test('partially paid postponed installments settle only their replacement remainder', () => {
  const rows = [
    { id: 1, amount: 500, status: 'paid', actual_paid: 500 },
    { id: 2, amount: 500, status: 'postponed', actual_paid: 200 },
    { id: 3, amount: 300, status: 'pending', actual_paid: 0 }
  ];

  const settlement = calculateEarlySettlement(rows, 1000);
  const updated = applyUpdates(rows, settlement.updates);

  assert.equal(settlement.paymentAmount, 300);
  assert.equal(updated.find((item) => item.id === 3).status, 'paid');
  assert.equal(sumPaid(updated), 1000);
});

test('discount covers the remaining installment without leaving it pending', () => {
  const rows = [
    { id: 1, amount: 500, status: 'paid', actual_paid: 500 },
    { id: 2, amount: 500, status: 'pending', actual_paid: 0 }
  ];

  const settlement = calculateEarlySettlement(rows, 1000, 100);
  const updated = applyUpdates(rows, settlement.updates);

  assert.equal(settlement.paymentAmount, 400);
  assert.equal(settlement.safeDiscount, 100);
  assert.equal(updated.find((item) => item.id === 2).status, 'paid');
  assert.equal(isContractComplete({ totalAmount: 1000, installments: updated }), true);
});

test('settlement rejects data that is already overpaid', () => {
  const rows = [{ id: 1, amount: 1100, status: 'paid', actual_paid: 1100 }];

  assert.throws(
    () => calculateEarlySettlement(rows, 1000),
    /المدفوع الحالي يتجاوز إجمالي العقد/
  );
});

test('settlement rejects a schedule that cannot cover the contract balance', () => {
  const rows = [
    { id: 1, amount: 500, status: 'paid', actual_paid: 500 },
    { id: 2, amount: 200, status: 'postponed', actual_paid: 0 }
  ];

  assert.throws(
    () => calculateEarlySettlement(rows, 1000),
    /عدم تطابق جدول الأقساط/
  );
});

test('contract completion requires the full amount after payments and discounts', () => {
  const rows = [
    { id: 1, amount: 500, status: 'paid', actual_paid: 500 },
    { id: 2, amount: 500, status: 'pending', actual_paid: 0 }
  ];

  assert.equal(isContractComplete({ totalAmount: 1000, installments: rows }), false);
  assert.equal(isContractComplete({ totalAmount: 1000, installments: rows, discountAmount: 500 }), true);
});

