# Credits, session work and advisor payouts

## Accounting boundaries

- Users purchase credits with money. Sessions and recording/transcript unlocks consume credits, not a second cash payment.
- Completed session work is measured using `actualDurationSec`, not booked `durationMinutes` or user credit charges.
- New sessions do not create `advisor_earning` credit transactions. Admin selects unpaid completed sessions and explicitly sets their USD payment.
- Store tips credit only provider-reported net proceeds to the separate USD tip wallet. Gross, commission, tax and net are retained. No universal store percentage is assumed.
- Store settlement can differ from provider-reported proceeds. Unverified tip fallback is disabled in production.

## Admin workflow

1. Payout Management → Advisor Accounts → Manage.
2. Select unpaid sessions, enter the USD session payment, and optionally enter an amount from available net tips.
3. Queue payment. Selected sessions are assigned atomically and tips move from available to pending.
4. From Payout Queue, either Approve & send using the configured provider, or transfer externally and explicitly confirm Mark paid. Mark paid does not transfer money.
5. Paid session/tip amounts appear separately in advisor payout history and summary. Rejection releases the assigned sessions and held tips. A failed payout keeps sessions assigned for retry.

Queue creation uses a unique request ID. Sessions cannot be assigned to two payouts. Finalization is idempotent. Provider timeouts keep funds held until confirmation; do not create a replacement payout when the provider outcome is unknown. If no provider token was received, reconcile using the transaction ID/provider webhook.

## Existing records

Historical session-credit earnings remain unchanged for audit; they are not new USD entitlements. Legacy payout conversion helpers remain for processing historical transactions only. Advisors with old unlinked service payouts are blocked from receiving new service assignments until those records are reconciled.

Legacy tips are handled by the separate `migrateLegacyTipBalances.js` migration. Do not rerun with `--apply` without reviewing its dry-run output. No historical session balances are automatically deleted or rewritten by this change.

## Verification and rollout

- `npm test`: unit tests for explicit pricing, session ownership/assignment, tip holds, idempotency, finalization and transaction units.
- `node scripts/auditPayoutBusinessFlow.js`: read-only database audit; does not create indexes, alter balances or send payments.
- Confirm `payoutRequestId` unique sparse index exists before enabling the new queue. MongoDB transactions require a replica set/Atlas.
- Deploy the backend and both dashboard builds together; rebuild/restart the mobile app for UI changes.
- In a test environment, finish a session, check actual time and user credit deduction, queue/reject a session-only and combined payout, then verify both dashboards. Verify store purchase + receipt confirmation and provider payouts in sandbox before live money movement.

The automated tests do not certify live App Store/Play Store settlement, Hyperwallet transfers or deployed-environment connectivity.
