# Flutterwave tips alongside IAP

The existing Leave a Tip screen offers IAP plus Flutterwave for accounts in all
countries when enabled. Flutterwave checkout uses the configured NGN tip prices
regardless of the account's saved country or currency.
This routing implements a product requirement; it does not establish store policy eligibility.

## Configuration

- Backend: `FLUTTERWAVE_TIPS_ENABLED=true`, `FLUTTERWAVE_SECRET_KEY`,
  `FLUTTERWAVE_WEBHOOK_SECRET`, and a public HTTPS `SERVER_URL`.
  Tips have a separate enable flag from credit-pack purchases.
- App: `--dart-define=FLUTTERWAVE_TIPS_ENABLED=true` for the intended build.
  Debug builds default to enabled; release/profile builds default to disabled.
- Admin → Credit Management → Advisor Tip Packages: set each tip's
  **Flutterwave price (NGN)**, then Save Changes. Zero hides that tip from
  Flutterwave. Prices are independent of the Apple/Google USD amount and require
  no coordinated store update. Existing packs default to zero until configured.
- Configure the active NG/NGN currency row for USD earnings/reporting conversion.
  It does not determine the Naira checkout price. The backend snapshots the
  saved NGN amount and conversion rate before checkout.
- Existing V3 charge and refund webhook URLs and secret hash are reused:
  `/api/v1/webhooks/flutterwave` and `/api/v1/webhooks/flutterwave/refunds`.
  Configure Flutterwave fees to be paid by the merchant. The advisor ledger
  receives 100% of the base tip; provider fees are stored separately and borne by the platform.
- Use MongoDB Atlas/a replica set and run the job worker. Create the new
  `unique_pending_flutterwave_tip` index before taking payments (partial unique
  session/provider index where type=tip_checkout and status=pending).
  Keep the existing unique `tip_fiat`-per-session and Flutterwave indexes.
  Do not drop existing indexes or run production syncIndexes blindly.

## Payment and recovery

Authenticated endpoints are under `/api/v1/wallet/flutterwave/tips`:
`catalog`, `pending?sessionId=...`, `checkout`, `status?txId=...`, `cancel`.
Only the session's user can create a tip checkout, after a completed session.
One pending Flutterwave checkout is allowed per session. Checkout request IDs
are persisted on the device before POST; a timeout can resume the same receipt.
The screen locks payment methods while a payment is pending and provides
Check Payment, Continue Payment and Cancel Payment controls.

Checkout redirects are only signals to query the authenticated backend. Charge
verification checks status, exact NGN amount and reference against the saved
receipt. A MongoDB transaction commits payment status, the user/advisor receipts,
session tip count and the advisor's USD tip balance together. It never adds or
deducts user credits, unlocks recordings/transcripts or changes subscriptions.
New ledger events retain provider=flutterwave for reporting.

If a late Flutterwave payment races an already completed tip, it does not award
a second tip. A durable job requests a full refund and checks existing provider
refunds before retrying. User-facing status is refund_pending until verified.
Partial/full verified refunds have separate receipts and cumulatively reverse
the correct USD earnings using the original exchange rate. Negative advisor tip
balance is retained if the advisor was already paid, to offset future earnings.

## Release validation

Automated tests mock provider responses; they do not charge cards. Before store
submission, use Flutterwave test mode to exercise an actual hosted checkout,
decline, cancellation, app restart, delayed bank payment and refund. Verify
advisor balances and reports. Both feature flags must be configured for the
review build. Verify the flow with both Nigerian and non-Nigerian accounts.
Disclose the optional session-linked tip flow and fee allocation in review notes;
Apple/Google acceptance remains a review outcome, not a guarantee from this code.
