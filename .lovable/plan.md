# ITS history import: 879 loads (Jan 2 - Oct 9, 2026)

The three ITS reports are the same 879 loads grouped three ways: by customer (34), by dispatcher (Dame Rod 861, Michael Brabits 18) and by carrier (87). Combined by ITS load number, each load gets its customer, broker and carrier.

## What gets created
- One load per ITS load, numbered **CW-<ITS #>** (e.g. CW-15426), tagged "From ITS". Any CW number already in the TMS is skipped, never duplicated.
- Lane (origin/destination city + state), ship and delivery dates, miles, equipment, weight, PO numbers (saved as shipper reference).
- Money: customer rate = line haul; P&D, FSC and additional charges as separate accessorial lines; carrier pay plus carrier P&D/FSC/other the same way. Totals match the ITS revenue and carrier pay.
- Customer: matched to your Directory by name; missing ones added as customers (city/phone from the report header).
- Carrier: matched by name to your Carriers; missing ones added as Pending carriers so you can vet them later. "Unassigned Carrier" loads stay without a carrier.
- Broker: Dame Rod and Michael Brabits matched to their TMS user accounts; no match means the load is left with the admin.
- Status: loads with a delivery date before today become **Delivered**; today and later become **Booked**.

## What it won't do
- Nothing is sent to Accounting/QuickBooks and no invoices or carrier bills are created (avoids double-billing work already billed in ITS).
- Historical loads skip the booking compliance check (recorded as an admin override "ITS history import"), since they already ran. New bookings still follow normal rules.
- Sales rep commissions and driver pay columns are not imported (commission % stays admin-set).

## After the import
- A short report: loads created, skipped, customers and carriers added, any rows that couldn't be read.
- The same file layouts become the template for the ITS Sync section in the Admin tab (recurring uploads), next on the roadmap.

## Technical details
- Parse grouped report sheets (group header row, "Load #" header row, numeric data rows, Totals rows ignored); join on Load #.
- Small migration: `loads.source text` ('its') + `loads.external_ref text` unique-when-set, for de-duplication and the "From ITS" tag.
- Insert via SQL with override_by/override_at/override_reason set so enforce_carrier_compliance permits historical carriers; amounts in cents per existing convention.
