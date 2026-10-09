# ITS Dispatch to Clearwater TMS: ongoing sync

## What is possible today

Truckstop has no public API for ITS Dispatch data such as loads, carriers or customers. Their public APIs cover load board posting, truck search and rate data. To get API access you contact the Truckstop Integrations Team (tsi@truckstop.com), and it usually requires Load Board Pro plus possible extra fees. So the plan works in two layers: one that works right away, and one that switches on if Truckstop grants API access.

## 1. ITS Sync screen (works right away)

A new **Admin → ITS Sync** screen where you drop in ITS Dispatch export files as often as you like (daily, weekly). Each run:

- Accepts Excel/CSV exports for **Loads, Carriers, Customers, Shippers, Consignees**, and figures out which type each file is from its columns. You can also pick the type yourself.
- **Never duplicates.** Rows are matched by ITS load number, carrier MC/DOT, or company name + city.
  - New records are added.
  - For existing records, only blank fields are filled in. Anything you've edited in the TMS is never overwritten.
- Loads from ITS keep their ITS load number and are tagged "From ITS". Their customer, shipper, consignee and carrier are linked to the matching Directory/Carrier entries, and new ones are created if needed. Imported loads skip the booking-compliance block only for loads that were *already booked or delivered* in ITS. New bookings still follow the normal rules.
- Shows a preview first (what will be added, updated or skipped), then a **Sync** button.
- Keeps a **sync history**: date, who ran it, file names, and counts per type, so you can see what came over when.

## 2. Clearwater TMS API (for ITS or any other software)

A secure connection point other systems can use, now or later:

- An admin creates **API keys** on the ITS Sync screen, can name them ("ITS Dispatch", "Factoring company"), and can turn them off at any time.
- Other software can **send in** loads, carriers and companies, using the same no-duplicate matching as above, and **read** load status and updates.
- Optional **outgoing notices**: when a load changes status in the TMS, the TMS can notify another system's address.
- Every API call is logged in the sync history.

If Truckstop grants API access, the TMS would pull from ITS automatically on a schedule, using the same matching rules, and you would no longer need to upload exports.

## What you'll need to do

- In ITS Dispatch, export your Loads and Carriers reports as Excel or CSV. You already did this for customers, shippers and consignees.
- Optional: email tsi@truckstop.com and ask whether ITS Dispatch offers API access for exporting broker loads and carriers. I'll give you a short email you can send.

## Technical details

- New tables: `external_sync_runs` (run log, admin-only), `api_keys` (hashed key, name, active, last used; admin-only), `webhook_endpoints` (url, events, secret).
- Loads gain `external_source` and `external_ref` (unique per source) for idempotent matching. Companies and carriers use the existing normalized-name/MC/DOT matching (`carrierMerge.ts` rules).
- Sync parsing happens in the browser (spreadsheet to rows). The write happens in an admin-verified server function that runs the match/merge with the admin client. Historical loads are inserted with an admin override reason "Imported from ITS" so `enforce_carrier_compliance` accepts past bookings. DNU and unauthorized carriers are still never bypassed.
- Public API: server routes under `/api/public/v1/*` (loads, carriers, companies). Every request must carry a valid hashed API key, input is validated with Zod, and responses never include broker pay or commissions.
- Outgoing webhooks: a trigger on load status change queues a call, which is HMAC-signed and sent by a server route.

## 3. Delete anything, with a confirm step

Every list in the TMS gets a **Delete** option: Directory companies, carriers, carrier documents, fleet trucks/trailers, drivers, leads and lead activities, quotes, loads, load notes, load documents, offers and tracking links.

- **Confirm step:** a dialog shows what will be removed and what's attached to it (for example "3 loads use this customer"). You type the name or number to confirm. Nothing is deleted with a single click.
- **Linked records are protected:** deleting a customer, carrier, truck or driver that's used on loads asks you to pick a replacement or leave that field blank on those loads. The loads themselves are never removed silently.
- **Who can delete:** all staff (admins and brokers) can delete regular entries. Brokers still only see, and so only delete, loads, leads and quotes assigned to them.
- **Accounting is admin-only:** invoices, carrier bills, the QuickBooks queue, and loads that were invoiced, paid or sent to QuickBooks can only be deleted by an admin. Admins confirm with a reason, and the reason is logged.
- **Deletion log:** every delete records who, when, what, and the reason, and admins can see it under Admin → Deletion log.

### Technical details (delete)
- Today only admins can delete companies, carriers, carrier documents, drivers and fleet units. Those policies widen to staff (`is_staff`), and `qb_sync` stays admin-only.
- `guard_load_delete` changes: admins may delete accounting-linked loads when a reason is supplied, and brokers stay blocked.
- New `deletion_log` table (admin read, insert via trigger on each covered table, which stores a row snapshot).
- One shared `ConfirmDelete` component, plus a dependency count query per entity. Reassign/blank runs in a staff-verified server function, then the delete.
