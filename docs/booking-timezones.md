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

Deploy backend and advisor dashboard, then distribute updated Flutter builds. The app now uses `flutter_timezone` to read the device's IANA zone; iOS requires pod resolution/build on macOS. Older app versions retain fixed-offset behavior and their previous local-slot fallback until updated.

Verify using a Lagos/Johannesburg/Nairobi advisor and a Dhaka/Los Angeles client; include midnight, date-specific overrides, a five-minute adjacent booking, buffers, disabled chat, and daylight-saving transitions. Monitor precise service/slot errors separately; unavailable chat is not a timezone error.

Regression commands: `node test/bookingTimezone.test.js`, `node test/bookingSlots.test.js`, and Flutter `test/features/sessions/booking_availability_test.dart`.
