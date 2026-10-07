# FMCSA data into the carrier setup page

## How it already works

**Adding a new carrier** (Carriers tab → Add carrier):
1. Type the carrier's MC# or DOT#.
2. Click **Look up FMCSA**.
3. The app fills in legal name, DBA, DOT#, MC#, address, city, state, zip, phone, authority status, and safety rating automatically.
4. Review and save — the carrier is created with those details.

**Existing carrier** (click a carrier in the list):
- Click **Re-check FMCSA** in their detail panel to refresh authority status, safety rating, and address.

**What gets checked:** operating authority (Authorized / Revoked / Inactive), safety rating, and insurance on file. Warnings appear if the carrier is out of service, has no active authority, or has an Unsatisfactory rating — and the system blocks booking non-compliant carriers.

## What this plan does

1. **Verify on the live app** — publish and test a lookup on a carrier you know (the sandbox here is blocked by FMCSA's firewall, so it can only be confirmed on the published site).
2. **Fallback already in place** — if FMCSA's main service blocks the request, the app reads the free public SAFER Company Snapshot instead and labels where the data came from, with an "Open in SAFER" link.
3. **No cost** — lookups use no paid searches or AI credits, and results are cached 24 hours so repeat checks are free.

## Technical details

- `lookupFmcsa` server function (staff-only): MC# → docket lookup → DOT# → carrier + authority + insurance; 24h cache in `market_rate_cache` keyed `fmcsa:<dot|mc>`.
- SAFER fallback in `src/lib/fmcsa.server.ts` parses the public snapshot page; source shown as FMCSA / SAFER / blocked.
- Add-carrier dialog and carrier detail panel call it via `FmcsaButton` / `FmcsaSummary`.
