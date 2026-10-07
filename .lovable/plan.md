# Automatic carrier safety & authority re-checks (+ MOTUS)

## Cost answer first

**$0.** FMCSA's data (operating authority, safety rating, insurance on file) is free public government data. The app already pulls it with no paid searches and no AI credits. Running it on a schedule costs nothing extra — no subscription, no per-lookup fee. (Paid monitoring services like Carrier411 or MyCarrierPackets charge $50–150+/month for the same FMCSA data plus extras; this covers the authority/safety/insurance part for free.)

## What gets built

**1. MOTUS DOT lookup added as a source**
- MOTUS is FMCSA's new registration system. I'll check what public DOT-number lookup it exposes and wire it in alongside the existing sources (FMCSA webkey → SAFER snapshot → company census), DOT numbers only.
- If MOTUS has no free public lookup endpoint, the plan continues with the existing free sources and I'll tell you exactly what MOTUS offers instead.

**2. Nightly automatic re-check of every carrier**
- Once a day, the app re-runs the check for every carrier that has a DOT # (skips Do Not Use carriers — they're already blocked).
- Each carrier's authority status and safety rating are refreshed on their record.
- Results stay cached, so a carrier you looked up an hour ago isn't re-fetched.

**3. Change alerts**
- If a carrier's situation gets worse — authority revoked/inactive, out-of-service order, safety rating drops to Unsatisfactory/Conditional — the app:
  - Posts an alert in team chat naming the carrier and what changed.
  - Flags the carrier row (red badge) so it stands out in the Carriers list.
- Because the booking rules already read the carrier's live authority status, a carrier whose authority is revoked is **automatically blocked from new load assignments** the moment the nightly check catches it — no manual step needed.

**4. "Last checked" visibility**
- The carrier detail panel shows when the data was last refreshed and where it came from (FMCSA / SAFER / MOTUS), plus the existing Re-check FMCSA button for an on-demand refresh anytime.

**5. Weekly digest**
- Once a week, a short summary in team chat: how many carriers were checked, how many had changes, how many are blocked.

## Technical details

- New public cron endpoint `src/routes/api/public/hooks/carrier-recheck.ts`, gated on the server-only `LOVABLE_CRON_SECRET` (not the publishable key, since this job writes carrier data and posts chat messages).
- The endpoint reuses the same lookup logic as `lookupFmcsa` (QC webkey → SAFER fallback → census → MOTUS if available), iterating carriers in small batches with the 24h cache so repeat runs are cheap.
- Updates `carriers.authority_status` / `safety_rating` only (never overwrites hand-entered fields); writes a `chat_messages` row to the `team` channel when a carrier's status worsens.
- Scheduling via pg_cron (set up with the database SQL tool, not a migration, since it contains the project URL and key): nightly at ~6am ET calling the endpoint, plus a weekly digest job. Both hit the stable production URL.
- DNU carriers are skipped; carriers without a DOT # are skipped (nothing to look up).
- MOTUS integration starts with a quick check of its public API/docs; if none is freely available, that step is dropped and reported.
