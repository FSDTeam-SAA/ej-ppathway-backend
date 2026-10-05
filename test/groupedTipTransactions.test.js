import test from 'node:test';
import assert from 'node:assert/strict';
import Transaction from '../models/transaction.model.js';
import { listTransactions } from '../controllers/admin.finance.controller.js';

test('grouped tips count payment rows, retain orphan earnings, and expose the linked breakdown', async (t) => {
  const payment = { _id: 'payment', type: 'tip_fiat', amount: 5, currency: 'usd' };
  const earning = { _id: 'earning', txCode: 'TXN-E', type: 'advisor_tip_fiat', sourceTransaction: 'payment', amount: 3.5, grossAmountUsd: 5, netProceedsUsd: 3.5, commissionAmountUsd: 1.5 };
  const orphan = { _id: 'orphan', type: 'advisor_tip_fiat', amount: 2 };
  const records = [earning, payment, orphan];
  t.mock.method(Transaction, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[1].$lookup.from, Transaction.collection.name);
    assert.equal(pipeline[2].$match['payment.type'], 'tip_fiat');
    return [{ _id: earning._id }];
  });
  const matches = (filter) => records.filter((row) =>
    (!filter._id?.$nin?.includes(row._id)) &&
    (!filter.type || filter.type === row.type));
  t.mock.method(Transaction, 'countDocuments', async (filter) => matches(filter).length);
  t.mock.method(Transaction, 'find', (filter) => {
    if (filter.sourceTransaction) {
      assert.deepEqual(filter.sourceTransaction.$in, ['payment']);
      return { lean: async () => [earning] };
    }
    let selected = matches(filter);
    const chain = {};
    chain.populate = chain.sort = () => chain;
    chain.skip = (skip) => { selected = selected.slice(skip); return chain; };
    chain.limit = (limit) => { selected = selected.slice(0, limit); return chain; };
    chain.lean = async () => selected;
    return chain;
  });
  const request = (query) => new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    listTransactions({ query }, res, reject);
  });
  const grouped = await request({ groupTips: 'true', page: '1', limit: '1' });
  assert.equal(grouped.meta.total, 2);
  assert.equal(grouped.data.length, 1);
  assert.equal(grouped.data[0]._id, 'payment');
  assert.equal(grouped.data[0].displayAmount, 5);
  assert.equal(grouped.data[0].tipBreakdown.netUsd, 3.5);
  assert.equal(grouped.data[0].tipBreakdown.deductionsUsd, 1.5);
  assert.equal(grouped.data[0].linkedAdvisorTransaction.txCode, 'TXN-E');
  const second = await request({ groupTips: 'true', page: '2', limit: '1' });
  assert.equal(second.data[0]._id, 'orphan');
  const raw = await request({});
  assert.equal(raw.meta.total, 3);
  const advisorView = await request({ groupTips: 'true', type: 'advisor_tip_fiat' });
  assert.equal(advisorView.meta.total, 2);
  assert.equal(Transaction.aggregate.mock.callCount(), 2);
});
