import test from 'node:test';
import assert from 'node:assert/strict';

import { mobileLoginRoleError } from '../utils/mobileLoginRole.js';

test('accepts matching mobile roles', () => {
  assert.equal(mobileLoginRoleError({ actualRole: 'user', expectedRole: 'user' }), null);
  assert.equal(mobileLoginRoleError({ actualRole: 'advisor', expectedRole: 'advisor' }), null);
});

test('rejects administrator accounts with a mobile-specific message', () => {
  assert.equal(
    mobileLoginRoleError({ actualRole: 'admin', expectedRole: 'user' }),
    'Administrator accounts cannot sign in to the mobile app. Please use the admin portal.'
  );
  assert.equal(
    mobileLoginRoleError({ actualRole: 'sub_admin', expectedRole: 'advisor' }),
    'Administrator accounts cannot sign in to the mobile app. Please use the admin portal.'
  );
});

test('directs users to the login entry point matching their role', () => {
  assert.equal(
    mobileLoginRoleError({ actualRole: 'advisor', expectedRole: 'user' }),
    'This is an advisor account. Please use Log in as advisor.'
  );
  assert.equal(
    mobileLoginRoleError({ actualRole: 'user', expectedRole: 'advisor' }),
    'This is a client account. Please use Log in as Client.'
  );
});
