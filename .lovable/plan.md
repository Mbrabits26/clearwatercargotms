# Copy a load into multiple loads

## What you'll get
- **Copy load** button on a load's details on the Dispatch board.
- A small window asks:
  - **How many copies** (1 to 50).
  - **Pickup dates:** keep the same dates, move each copy forward by a set number of days (for example every day or every week), or pick a date for each copy on a calendar. Delivery dates shift along with pickup.
- Each copy gets its own new CW load number and comes over with the same customer, shipper, consignee, lane, equipment, commodity, weight, pieces, temperature, miles, customer rate, target carrier pay, accessorials, reference numbers and facility notes.
- **Not copied** (each copy starts fresh): the carrier, truck and driver, rate con and signature, tracking links, offers, notes, documents, and anything sent to Accounting. Copies start as **Available**, and you're the broker on them.
- The **Load builder** also gets a **"Create how many"** box, so a brand-new load can be made several times at once with the same date options.
- When it's done you'll see a message like "Created 5 loads: CW-10461 to CW-10465". The copies show up on the board right away.

## Rules kept
- A carrier you assign to a copy later still goes through the normal booking safety checks.
- Brokers can only copy loads they can already see.

## Technical details
- Client-side in `dispatch.tsx` (new CopyLoadDialog) and `LoadBuilderDialog.tsx` (count + date-spacing fields). The copies are inserted as one batch into `loads`, with carrier, fleet, ratecon, cancel, override, source and external_ref fields cleared, and `broker_id` set to the current user. Load numbers come from the existing default, the same as any new load.
- No database changes.
