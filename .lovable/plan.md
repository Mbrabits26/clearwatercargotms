# QuickBooks Online — connect once, then auto-sync

## How it will work

1. **One-time connection** — the QuickBooks tab gets a "Connect QuickBooks" button. Admin clicks it, signs into their Intuit account, picks the Clearwater company file. Done — the connection renews itself silently after that.
2. **Automatic sending** — the existing queue stays, but now it delivers:
   - **Customer invoice** goes to QuickBooks automatically when a load is marked **Delivered** (AR).
   - **Carrier bill** goes automatically when a **signed POD** is received (AP) — routed to the factoring company as payee when one is on file.
3. **QuickBooks tab becomes a dashboard** — shows each invoice/bill with its real QuickBooks number, status (sent / failed), and a Retry button for anything that errored. Nothing is ever lost — failures stay queued with the reason.
4. **Safety** — duplicates are prevented (one invoice and one bill per load, ever). Amounts include linehaul + accessorials, matching the rate con.

## What you provide (one time)

A free Intuit developer app so the TMS is allowed to talk to your QuickBooks:

1. Sign in at **developer.intuit.com** with your QuickBooks login.
2. Click **My Apps → Create an app**, choose **QuickBooks Online and Payments**.
3. Name it "Clearwater Cargo TMS", select the **Accounting** scope.
4. Open **Keys & credentials**, copy the **Client ID** and **Client Secret**.
5. Add both in **Project Settings → Secrets**, then tell me it's done.

It starts in free Development mode, which works fully with your own company file — no paid upgrade or app review required. I'll handle the rest, including the sign-in redirect setup.

## New: click any load number anywhere → quick look

Everywhere a load number appears (Dispatch, Reports, Quotes, Fleet, QuickBooks/Accounting, offers, tracking), clicking it opens a **quick-look panel**: lane, status, customer, carrier, dates, revenue/cost totals, and a big **Open load** button that jumps to the full load in the dispatch cockpit. Built as one shared component so every screen behaves the same.

## New: QuickBooks tab becomes the Accounting tab (admin only)

The QuickBooks tab grows into a full accounting home, still admin-only:

1. **AR (customer invoices)** — every delivered/invoiced load with amount, age, and status; admin can edit the amount, mark sent/paid, or remove it from the queue.
2. **AP (carrier bills)** — every POD-signed load awaiting carrier payment, with factoring payee routing; same edit/remove controls.
3. **Edit & delete** — admin-only buttons on each queued invoice/bill: change amount or payee, delete a mistaken entry, retry a failed send.
4. **Sync log** — unchanged: what went to QuickBooks, when, and the result.
5. **Connect & auto-sync** — the QuickBooks connection described above lives here too.

## Technical details

- Intuit OAuth 2.0 with refresh tokens stored encrypted; token refresh handled server-side.
- Server functions create Customer Invoice / Vendor Bill via the QuickBooks REST API and write the returned doc number into `qb_sync` (existing table, admin-only).
- Sends trigger from the load status flow (delivered → invoice, POD signed → bill) and from a manual "Send now" per queued row.
- No per-user QuickBooks accounts needed — one company connection, admin-managed.
