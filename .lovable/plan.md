# Weekly carrier safety & authority re-checks (+ MOTUS)

## Cost answer first

**$0.** FMCSA's data (operating authority, safety rating, insurance on file) is free public government data. The app already pulls it with no paid searches and no AI credits. Running it on a weekly schedule costs nothing extra — no subscription, no per-lookup fee. (Paid monitoring services like Carrier411 or MyCarrierPackets charge $50–150+/month for the same FMCSA data plus extras; this covers the authority/safety/insurance part for free.)

## What gets built

**1. Weekly automatic re-check of every carrier**
- Once a week (Monday mornings, ~6am ET), the app re-runs the check for every carrier that has a DOT # (skips Do Not Use carriers — they're already blocked).
- Safety ratings come from the SAFER company snapshot, so what the app shows stays in line with what you'd see on SAFER's website. Authority status and insurance-on-file come from FMCSA's data feed, with SAFER as the fallback.
- Each carrier's authority status and safety rating are refreshed on their record. Hand-entered fields (phone, email, notes) are never overwritten.
- Results stay cached, so a carrier you looked up recently isn't re-fetched.

**2. Status-change notices to admins and brokers**
- If a carrier's situation changes — authority revoked/inactive, out-of-service order, safety rating changed (especially drops to Conditional or Unsatisfactory) — the app posts a notice in team chat naming the carrier, what changed, and the old vs new value, so every admin and broker sees it.
- The carrier row gets a red badge in the Carriers list so it stands out.
- Because the booking rules already read the carrier's live authority status, a carrier whose authority is revoked is **automatically blocked from new load assignments** the moment the weekly check catches it — no manual step needed.

**3. Weekly summary**
- After each run, a short summary in team chat: how many carriers were checked, how many had changes, how many are currently blocked.

**4. Manual lookup stays**
- The Look up FMCSA / Re-check FMCSA buttons stay exactly as they are for on-demand checks anytime, and the carrier detail panel shows when the data was last refreshed and the source (FMCSA / SAFER / MOTUS).

**5. MOTUS DOT lookup added as a source**
- MOTUS is FMCSA's new registration system. I'll check what public DOT-number lookup it exposes and wire it in alongside the existing sources (DOT numbers only).
- If MOTUS has no free public lookup endpoint, the plan continues with the existing free sources and I'll tell you exactly what MOTUS offers instead.

## Technical details

- New public cron endpoint `src/routes/api/public/hooks/carrier-recheck.ts`, gated on the server-only `LOVABLE_CRON_SECRET` (not the publishable key, since this job writes carrier data and posts chat messages).
- The endpoint reuses the same lookup logic as `lookupFmcsa` (FMCSA webkey → SAFER fallback → census → MOTUS if available), iterating carriers in small batches with the 24h cache so repeat runs are cheap.
- Updates `carriers.authority_status` / `safety_rating` only; writes a `chat_messages` row to the `team` channel for each status change and one summary row per run.
- Scheduling via pg_cron (set up with the database SQL tool, not a migration, since it contains the project URL and key): weekly, Monday ~10:00 UTC (6am ET), calling the endpoint on the stable production URL.
- DNU carriers are skipped; carriers without a DOT # are skipped (nothing to look up).
- MOTUS integration starts with a quick check of its public API/docs; if none is freely available, that step is dropped and reported.
