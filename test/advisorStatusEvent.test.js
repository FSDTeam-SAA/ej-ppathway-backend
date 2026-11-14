import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/user.model.js';
import { suspendAdvisor, unsuspendAdvisor } from '../controllers/admin.advisors.controller.js';

for (const [handler, status] of [[suspendAdvisor, 'deactivated'], [unsuspendAdvisor, 'active']]) {
  test(`advisor ${status} change broadcasts after persistence with no private account data`, async (t) => {
    const calls = [];
    t.mock.method(User, 'findByIdAndUpdate', async (id, update) => {
      calls.push('persist');
      assert.equal(update.status, status);
      return { _id: id, status: update.status, email: 'private@example.com' };
    });
    const emit = (event, payload) => {
      calls.push('emit');
      assert.equal(event, 'advisor:status-changed');
      assert.deepEqual(payload, { advisorId: 'advisor', status });
    };
    const publicEmit = t.mock.fn((event, payload) => {
      assert.equal(event, 'advisor:status-changed');
      assert.equal(payload, undefined);
    });
    await new Promise((resolve, reject) => {
      const res = { status: () => res, json: resolve };
      handler({ params: { id: 'advisor' }, body: {}, app: { get: () => ({
        emit, of: (namespace) => {
          assert.equal(namespace, '/advisor-discovery');
          return { emit: publicEmit };
        }
      }) } }, res, reject);
    });
    assert.deepEqual(calls, ['persist', 'emit']);
    assert.equal(publicEmit.mock.callCount(), 1);
  });

  test(`missing advisor never emits a ${status} event`, async (t) => {
    t.mock.method(User, 'findByIdAndUpdate', async () => null);
    const emit = t.mock.fn();
    await assert.rejects(new Promise((resolve, reject) => {
      const res = { status: () => res, json: resolve };
      handler({ params: { id: 'missing' }, body: {}, app: { get: () => ({ emit }) } }, res, reject);
    }), { statusCode: 404 });
    assert.equal(emit.mock.callCount(), 0);
  });
}
