# Show driver locations as places on a map

## What you'll get
- When a driver sends a status update or location from their tracking link, the app turns the GPS point into a readable place, for example "Near Salina, KS · I-70". The raw latitude and longitude numbers are no longer shown.
- That place name appears in:
  - the "Driver updates" list in the load's Driver tracking panel
  - the automatic load note ("Driver update — Rolling — Near Salina, KS")
  - the team chat mention
- A map in the Driver tracking panel shows the latest location as a gold pin. Earlier updates appear as smaller dots with a line connecting the route so far. The pickup and delivery cities are marked too.
- Clicking any update in the list moves the map to that spot. "Open in Google Maps" is still available.
- If a driver doesn't share GPS, the update shows the status and note only, as it does today.

## What you need to do
- Approve the Google Maps connection when the prompt appears. Choose "Managed by Lovable" so you don't need a Google account or API key.
- Cost: each location is looked up only once, when the driver sends it, then saved. At about 20 loads a day with a few check-ins each, that stays in the low hundreds of lookups a day, well under Google's free monthly allowance. The map itself does not count against those lookups.

## Technical details
- Link the `google_maps` connector, using the managed browser key for the map and the gateway for reverse geocoding.
- Migration: add a nullable `load_tracking_pings.place` text column.
- In `postPing` (`tracking.functions.ts`), after token validation, reverse geocode through the gateway (`/maps/api/geocode/json?latlng=`) to get "City, ST" with the route if one is available. Store the result in `place` and use it in the note and mention text. Lookup failures fall back silently to no place name.
- In `TrackingPanel.tsx`, load Maps JS async with a callback, using `clickableIcons: false` and `google.maps.Marker` plus a Polyline. Show the place in the list. On the preview hostname the map shows a placeholder; it renders on the published site.
- Existing pings with coordinates get backfilled once on first view through a staff-only server function, capped at 50.
