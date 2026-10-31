# Flutterwave credit purchases (NGN)

Only user credit packs use this integration. Apple/Google purchases, paid tips,
subscriptions, advisor earnings and Hyperwallet payouts retain their providers.

## Setup

1. Use a staging database and Flutterwave **test** account. Set backend
   `FLUTTERWAVE_ENABLED=true`, `FLUTTERWAVE_SECRET_KEY` and
   `FLUTTERWAVE_WEBHOOK_SECRET`. `SERVER_URL` is the public HTTPS backend origin.
   Hosted checkout does not require the public or encryption key in the app.
2. In Flutterwave's **V3** webhook settings, set the charge URL to
   `SERVER_URL/api/v1/webhooks/flutterwave` and enable retries. Set the same
   secret hash as `FLUTTERWAVE_WEBHOOK_SECRET` (`verif-hash` header).
   Under custom refund webhook preferences, set the URL to
   `SERVER_URL/api/v1/webhooks/flutterwave/refunds` with the same secret hash.
3. MongoDB must support transactions (replica set or Atlas). Receipt completion
   and the wallet increment commit together. Ensure the transaction collection's
   unique Flutterwave reference, request key, payment ID and refund ID indexes
   have been built before accepting payments. Do not run `syncIndexes` against
   production blindly; create the new indexes using your normal deployment process.
4. In Admin → Currencies, configure an active Nigeria (`NG`) / `NGN` row with
   the correct **Naira per 1 USD** rate. Checkout refuses a missing/invalid rate.
5. In Admin → Credits → Credit Packs, set **Flutterwave price (NGN)** and Save.
   Zero makes a pack unavailable on Flutterwave. The Apple/Google product prices
   remain independent. Existing packs start at zero; no NGN prices are invented.
6. Flutterwave is visible by default in local **debug** app builds; use the
   staging `API_BASE_URL`. The flag `--dart-define=FLUTTERWAVE_CREDITS_ENABLED=false`
   disables it when testing only store purchases. A separate **Pay in Naira with Flutterwave**
   button appears below the existing store purchase flow on Buy Credits.
   Checkout opens the hosted browser page; returning to the app checks status.
   Pending purchases can also be checked, continued or cancelled on this screen.
7. External checkout is disabled by default in profile/release builds. Enable
   `--dart-define=FLUTTERWAVE_CREDITS_ENABLED=true` in store builds only for
   eligible storefronts/programs. The build flag is not
   an automatic determination of Apple/Google policy eligibility.

No real charge or sandbox checkout is sent by unit tests. Before release, run
an actual test checkout, declined/cancelled payment, delayed bank payment and
refund through the configured staging account and inspect both dashboards.

## Accounting and recovery

- Backend snapshots the credit count, bonus, NGN price and NGN/USD rate at
  checkout. The app sends a pack ID, the displayed price for stale-price
  detection, and a persisted retry key; it cannot choose the awarded credits.
- `amount` is NGN; `amountUsd` is the independently priced NGN sale divided by
  the snapshotted rate. The IAP reference price is not substituted for NGN revenue.
- Webhook, return callback, status checks and the background reconciliation job
  use the same server-side payment verification and atomic fulfillment.
- The job worker checks pending purchases for roughly a day (300 attempts,
  existing exponential backoff). Enable the normal backend job worker. Failed
  jobs are visible in the existing job monitoring; status checks and webhook
  retries can still recover a later payment.
- Pending/failed/cancelled attempts do not add credits or count as sales.
  Cancelling disables the hosted link. A genuinely paid in-flight payment can
  still be fulfilled later; a browser `status=successful` is never trusted.
- Verified provider refunds get separate `credit_pack_refund` receipts. Partial
  refunds cumulatively reverse the proportional rounded credit count (including
  bonus), so a full refund reverses exactly the original award. Delivery retries
  cannot reverse it twice. Cash conversion uses the original rate with cumulative
  rounding to prevent partial-refund rounding drift.
- If refunded credits were already spent, purchased balance may become negative.
  This records debt rather than creating free credits. No other user's wallet,
  advisor earnings or session history is rewritten by a purchase refund.
- Original completed purchases stay in gross sales and purchase counts; refunds
  are shown separately and deducted from net finance totals. Credit Management
  shows cash refunds and reversed credits alongside gross sales. Flutterwave
  receipts cannot be deleted using the finance delete action.
- Provider chargebacks/disputes are not refunds and need their own operational
  review; this integration does not automate chargeback outcomes or initiate
  refunds. Refunds initiated in Flutterwave are reconciled through the verified
  refund webhook.

## Endpoints

- `GET /api/v1/wallet/flutterwave/catalog`
- `POST /api/v1/wallet/flutterwave/checkout` — `{packId, expectedAmountNgn, requestId}`
- `GET /api/v1/wallet/flutterwave/pending`
- `GET /api/v1/wallet/flutterwave/status?txId=...`
- `POST /api/v1/wallet/flutterwave/cancel` — `{txId}`
- Public provider return: `GET /api/v1/wallet/flutterwave/return`
- Charge/refund webhooks as configured above.

All catalog/purchase/status/cancellation endpoints require a signed-in user.
Status and cancellation queries enforce purchase ownership. Both webhooks require
the shared hash and re-query Flutterwave before applying financial changes.

Official references: [Standard checkout](https://developer.flutterwave.com/docs/flutterwave-standard-1),
[verification](https://developer.flutterwave.com/docs/transaction-verification),
[V3 webhooks](https://developer.flutterwave.com/docs/webhooks),
[refunds](https://developer.flutterwave.com/docs/refunds).
