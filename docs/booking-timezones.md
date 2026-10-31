# Booking timezones

- Weekly windows and date overrides are wall-clock times/dates in `User.timezone` (validated IANA identifier).
- `scheduledFor`, started/ended timestamps and slot lock timestamps are UTC instants. A booking records `advisorTimezone` as context; profile edits do not shift its UTC timestamp.
- Availability `date` is the viewer's local calendar date. Send `viewerTimezone` (e.g. `Africa/Lagos`). `timezone` remains a supported alias; numeric offsets are supported only for older clients without a named zone. A named timezone takes precedence over a supplied offset.
- The server applies advisor-local schedules for every instant on the viewer's day, including adjacent advisor dates and overnight windows. Closures, booking buffers, notice windows and conflicts are applied before slots are returned.
- Clients submit the returned ISO timestamp unchanged (or round-trip it through UTC). They must not generate slots from weekly hours when the server returns an empty list.
- Availability includes `sessionTypes`; disabled services cannot be selected. The booking endpoint separately revalidates service, interval and conflicts.
- The advisor calendar shows a schedule timezone selector and device-zone suggestion. UTC is a legitimate setting; saving other profile fields must not replace it with the browser zone.

## Existing data and release

Run `node scripts/auditAdvisorTimezones.js` for a read-only report of invalid/missing zones and UTC accounts needing confirmation. Do not guess a zone from country. The old Bangladesh-only UTC-to-Dhaka fallback has been removed, so those legacy advisors must explicitly confirm/save `Asia/Dhaka` when that was their intended schedule zone. Legitimate UTC advisors keep UTC. Existing booking timestamps stay unchanged.

Deploy backend and both dashboards, then distribute updated Flutter builds. The app uses `flutter_timezone` to read the device's IANA zone; iOS requires pod resolution/build on macOS. Older app versions retain their previous behavior until updated.

Verify using a Lagos/Johannesburg/Nairobi advisor and a Dhaka/Los Angeles client; include midnight, date-specific overrides, a five-minute adjacent booking, buffers, disabled chat, and daylight-saving transitions. Monitor precise service/slot errors separately; unavailable chat is not a timezone error.

Regression commands: `node --test test/bookingTimezone.test.js test/bookingSlots.test.js test/availabilityTimezone.test.js test/saveAvailabilityTimezone.test.js`, and Flutter `test/features/sessions/booking_availability_test.dart`.

## Arbitrary-minute windows and timezone changes

Availability starts can use any minute. Slot candidates and reservation locks
use one-minute units; the selected session duration remains a multiple of five
minutes and starts are aligned to the availability window. Adjacent 04:14–04:19
and 04:19–04:24 sessions therefore have disjoint locks. Existing UTC booking
timestamps, payment receipts and wallet balances are not migrated.

The advisor and admin timezone selectors request an authenticated, non-persisting
preview at `/advisor/profile/availability-timezone-preview` and
`/admin/advisors/:id/availability-timezone-preview`. They send `fromTimezone`,
`toTimezone`, weekly hours, date overrides and optional templates. Save includes
`availabilityTimezone` to identify values that have already been converted.
Older clients without that marker are converted on the backend at save time.

Dated overrides are converted using their own calendar date and IANA timezone
rules. Date boundaries and neighbouring weekly hours are reconstructed when a
converted override spans more than one date. A nonexistent source time produces
a validation error rather than silently choosing a different instant.

Weekly hours and templates are converted using the reference calendar week
(`referenceDate` in the preview, defaulting to today in the source zone). After
saving they recur at those local times in the **new** timezone and follow its
future daylight-saving rules. They do not retain a second hidden recurrence in
the old timezone. Existing booked sessions always retain their original UTC
instants, including bookings after a future clock change; timezone changes do
not auto-cancel them or request rescheduling.

Timezone and profile hours are saved together in a MongoDB transaction with a
timezone compare-and-set guard. The deployment already requires a replica set
for credit purchase fulfillment. No new index or collection is required.

The PA_422 data audit found a Chicago timezone and the dated 04:14–22:00 window.
That data does not need rounding or an inferred offset correction to generate
slots. Do not bulk-shift existing advisor data without confirming its original
timezone. The generator fix makes those saved hours usable directly.

Verification covers arbitrary-minute starts, adjacent and overlapping locks,
Chicago/Lagos date rollover, summer/winter offsets, closures, templates, stale
forms, and atomic rollback. Production smoke tests should query available slots
and preview conversion without creating a chargeable appointment.
