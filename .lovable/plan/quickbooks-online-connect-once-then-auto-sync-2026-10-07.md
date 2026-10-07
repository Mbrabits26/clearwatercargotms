# QuickBooks Online — connect once, then auto-sync

## Recommendation: automatic sync

Manual "click to import every time" means someone has to remember to push each invoice and bill. Auto-sync is smoother: the admin signs into QuickBooks **once**, and from then on everything flows over by itself. The QuickBooks tab stays as the control center where you can see what went, retry failures, or disconnect.

## How it will work

1. **One-time connection** — QuickBooks tab gets a "Connect QuickBooks" button. Admin clicks it, signs into their Intuit account, picks the Clearwater company file. Done — the connection renews itself silently after that.
2. **Automatic sending** — the existing queue stays, but now it delivers:
   - **Customer invoice** goes to QuickBooks automatically when a load is marked **Delivered** (AR).
   - **Carrier bill** goes automatically when a **signed POD** is received (AP) — routed to the factoring company as payee when one is on file.
3. **QuickBooks tab becomes a dashboard** — shows each invoice/bill with its real QuickBooks number, status (sent / failed), and a Retry button for anything that errored. Nothing is ever lost — failures stay queued with the reason.
4. **Safety** — duplicates are prevented (one invoice and one bill per load, ever). Amounts include linehaul + accessorials, matching the rate con.

## What you need to provide (one time)

A free Intuit developer app so the TMS is allowed to talk to your QuickBooks:
1. Sign in at developer.intuit.com with your QuickBooks login.
2. Create an app (name it "Clearwater Cargo TMS"), select the **Accounting** scope.
3. Copy the **Client ID** and **Client Secret** and paste them here (I'll store them encrypted).

I'll handle the rest, including the sign-in redirect setup.

## Driver tracking link (location, status, POD/BOL upload) — free, no texting service

1. **Tracking link per load** — from the dispatch cockpit, generate a private link for that load and copy it (text it from your own phone) or email it to the driver. No app download, no login, works in any phone browser.
2. **Driver's page** — one-tap status updates (Arrived at shipper, Loaded / rolling, Arrived at receiver, Delivered) with an optional note. Each tap stamps the load's check-call time and posts to the load's notes.
3. **Location updates** — the page asks the driver to share their phone's GPS; each status tap (and an optional "Send location" button) records their position with a timestamp, shown on the load in the cockpit.
4. **POD / BOL photo upload** — the driver snaps a photo of the signed POD or BOL; it attaches straight to the load's documents and flips "POD received," which queues the carrier bill for QuickBooks.

**Cost: $0.** One-way only — drivers use the page; no texting service, no per-message fees. If you ever want drivers to reply by plain text instead, WhatsApp Business or Twilio can be added later without changing this page.

## Technical details (QuickBooks)

- Intuit OAuth 2.0 with refresh tokens stored encrypted; token refresh handled server-side.
- Server functions create Customer Invoice / Vendor Bill via the QuickBooks REST API and write the returned doc number into `qb_sync` (existing table, admin-only).
- Sends trigger from the load status flow (delivered → invoice, POD signed → bill) and from a manual "Send now" per queued row.
- No per-user QuickBooks accounts needed — one company connection, admin-managed.

## Technical details (driver texting)

- Tracking page at `/track/$token` (public, tokenized like the rate con signing page): status buttons, note field, browser GPS, photo upload — all via token-validated server functions.
- New `load_tracking_tokens` table (token, load_id, driver phone, expires); status taps update `loads.last_check_call` and insert a `load_notes` row; POD photos go to the load-docs bucket and set `pod_received`.
- Dispatch cockpit gets a "Send tracking link" action (copy link / email / Gmail).
- Location pings stored on a `load_tracking_pings` table (load_id, lat, lng, note, created_at) shown in the cockpit.
