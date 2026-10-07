# Fix FMCSA carrier lookup

## What's happening
FMCSA's QCMobile service sends back a plain "403 Forbidden" web page instead of carrier data. That page is how FMCSA blocks traffic coming from cloud servers. It doesn't look like a problem with your key. In the app this shows up as "FMCSA rejected the web key" or as nothing happening.

## Plan
1. **Clearer errors.** The lookup will tell you whether FMCSA blocked the request, couldn't find the carrier, or rejected the key, so it never just fails silently.
2. **Backup source: SAFER Company Snapshot.** If the main FMCSA service blocks us, the app will read the carrier's public SAFER snapshot page (safer.fmcsa.dot.gov) by MC # or DOT #. It uses the web-reading service we already connected for market rates. The snapshot fills in:
   - Legal name and DBA
   - DOT # and MC #
   - Address and phone
   - Operating status (Authorized, Not Authorized or Out of Service)
   - Out-of-service date
   - Power units and drivers
   - Safety rating
3. **Source label.** Each result shows where it came from ("FMCSA QCMobile" or "SAFER snapshot") and keeps the same warnings and compliance checks as today.
4. **Test.** Look up a few real MC # and DOT # values and confirm the Add Carrier and Re-check FMCSA buttons fill in the details.

## Note
SAFER doesn't show insurance amounts on file. If a result comes from the backup source, the insurance fields keep your manually entered values.

## Technical details
- `src/lib/fmcsa.functions.ts`: tell an HTML 403 apart from a JSON auth error. On a block, call a new `fetchSaferSnapshot(mc|dot)` in `src/lib/fmcsa.server.ts`. That function uses Firecrawl scrape (markdown) of `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT|MC_MX&query_string=…` and parses the fields with regex.
- Add `source` to `FmcsaCarrier` and show it in `FmcsaSummary`.
