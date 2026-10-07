# Fix FMCSA carrier lookup (free sources only)

## What's happening
FMCSA's data service sends back a plain "403 Forbidden" page instead of carrier data. That's how FMCSA blocks some cloud servers. It doesn't look like a problem with your key.

## Plan (every lookup is free)
1. **Clearer errors.** The lookup will say whether FMCSA blocked the request, couldn't find the carrier, or rejected the key, so it never just fails silently.
2. **Free backup.** If the main FMCSA service is blocked, the app reads FMCSA's free public SAFER Company Snapshot directly. It fills in:
   - Legal name and DBA
   - DOT # and MC #
   - Address and phone
   - Operating status
   - Out-of-service date
   - Power units and drivers
   - Safety rating
3. **Save repeat lookups.** Each result is kept for 24 hours, so checking the same carrier again the same day doesn't make a new request.
4. **"Open in SAFER" button.** If both FMCSA sources block the request, the button opens the carrier's SAFER page in a new tab, already searched, so you can check it by hand in a few seconds. It costs nothing.
5. **Source label.** Each result shows where it came from ("FMCSA" or "SAFER") and runs the same compliance warnings as today.
6. **Test on the live app.** After you publish, I'll run a lookup on the live app. Our test environment is blocked by FMCSA, so it can't be tested here.

## Note
SAFER doesn't show insurance amounts on file. If a result comes from the backup source, the insurance fields keep your manually entered values.

## Technical details
- `fmcsa.functions.ts`: detect an HTML 403 versus a JSON auth error; fall back to a plain `fetch` of `safer.fmcsa.dot.gov/query.asp` (by USDOT or MC_MX), parsed by regex in `fmcsa.server.ts`. Never use Firecrawl or AI.
- Cache in the existing `market_rate_cache` table with the key `fmcsa:<dot|mc>`, valid for 24h.
- `FmcsaSummary` gains a `source` label plus a SAFER link button.
