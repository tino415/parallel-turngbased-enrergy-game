import test from 'node:test';
import assert from 'node:assert/strict';
import { roundOrdersFromPlan } from './support/live-economy.mjs';

const nodes = [{ owner: 0 }, { owner: 1 }, { owner: 1 }];

test('an AI withdrawal reaches the resolver even when that node gives no order', () => {
  const plan = {
    orders: { 1: { source: 1, type: 'invest', amount: 2, dest: null } },
    withdrawals: { 1: 0.5, 2: 1.5 },
  };
  const { aiWithdrawalsOverride } = roundOrdersFromPlan(plan, nodes);
  assert.deepEqual(aiWithdrawalsOverride, { 1: 0.5, 2: 1.5 });
});

test('a Blue withdrawal without an order becomes a manual withdraw-only order', () => {
  const plan = { orders: {}, withdrawals: { 0: 2 } };
  const { orders, aiWithdrawalsOverride } = roundOrdersFromPlan(plan, nodes);
  assert.deepEqual(orders, { 0: { withdraw: 2, invest: 0, edges: {} } });
  assert.deepEqual(aiWithdrawalsOverride, {});
});
