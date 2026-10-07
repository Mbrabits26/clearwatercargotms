# Load entry, dispatch and carrier packet fixes

## 1. Calendar date pickers
- Pickup and delivery appointments in the load builder and in the dispatch details get a calendar button to click a date, plus a time box. You can still type a date if you prefer.
- Quote pickup dates, lead follow-up dates and carrier insurance dates get the same calendar.

## 2. Edit everything after a load is created
- New "Edit load" button in the dispatch details. It opens the load builder already filled in with that load: customer, shipper, consignee, cities, appointments, equipment, commodity, weight, pieces, temp, miles, reference numbers and facility notes.
- Pickup and delivery notes can be edited right on the Load tab.
- Load notes: the person who wrote a note, or an admin, can edit or delete it. Deleting asks you to confirm first.
- Accessorials can be edited as well as removed.

## 3. Customer rate / carrier pay typing bug
- First step: reproduce the problem in the preview to confirm the cause. Most likely, the details panel refreshes after each keystroke and clears the box.
- Fix it so you can type the full amount. It saves when you leave the box or press Enter. The accessorial amount box gets the same fix.

## 4. Commission % (Admin screen)
- Everyone starts at 0% instead of the current default of 30%. Existing saved values are reset to 0.
- Only admins can change commission.
- Changing a value asks "Change commission for X from A% to B%?". When you confirm, it saves and shows "Saved". If you cancel, the old value comes back.

## 5. Carrier assignment and manual override
- Fix carrier selection so picking a carrier actually assigns it and shows a clear reason if it's blocked.
- Admins get an "Override compliance" option on a single load. They pick a carrier and must enter a reason. The load records who did it, when and why, and shows an override badge.
- Do Not Use carriers and carriers whose authority isn't Authorized can never be overridden.
- Brokers see why a carrier is blocked, with a "Request admin override" note.

## 6. Load sheet import
- Built around your sample (Adelphia Metals shipper no. 384851). The reader will pull:
  - Shipper: Adelphia Metals, 8812 Highway 79 W, Jewett, TX 75846, 903-626-6223
  - Consignee: Araco Concrete Contractor, LLC, Monte Vista, CO; contact Arturo 719-459-3360
  - References: shipper no. 384851, PO 2600113, trip #2563998
  - Freight: 360 pieces of #9 Rebar Grade 60, 40 ft, 48,960 lbs
  - Pickup date: 9/25/26
  - Equipment: Flatbed
  - Notes: no appointment required; call Arturo for jobsite directions
  - Handwritten notes: carrier FOUST, rate $4,000, FLAT. The carrier is a suggestion only and still goes through the booking checks.
- It also handles rate cons, tenders, BOLs, multi-stop sheets and spreadsheets.
- If the paperwork doesn't show who the customer is, that field stays blank instead of being guessed.
- After import, a review screen shows every field it found so you can correct anything before saving.

## 7. Carrier packet upload with automatic fill-in
- Carrier documents get a new "Full carrier packet" document type.
- When a packet is uploaded, the app reads it and finds:
  - Company details: legal name, DBA, MC/DOT, address, phone, email and contact
  - W-9 details and the tax ID (last 4 digits shown only)
  - Insurance: auto liability and cargo limits, expiration dates, insurer
  - Factoring company and remit-to (NOA), plus voided check and bank name
  - Whether the broker agreement is signed, and the signer
- A review screen shows what it found next to what's already on file. You choose what to apply. Empty fields fill in automatically; existing values are changed only when you tick them.
- The matching checklist items (W-9, COI, agreement, NOA, voided check) get marked received, and the packet is saved as the source document for each one.
- The carrier stays pending until you mark them vetted, same as now.

## Technical details
- Date picker: shadcn Calendar + Popover wrapper replacing raw date/datetime-local inputs.
- Rate inputs: Cockpit local state is reset on load refetch; sync only when the load id changes, commit on blur/Enter.
- Migration:
  - Set the `broker_commissions.commission_pct` default to 0 and update all rows to 0.
  - Add UPDATE/DELETE policies on `load_notes` (author or admin).
  - Add `loads.override_by/override_at/override_reason`. `enforce_carrier_compliance` allows an admin-set override, never for DNU or unauthorized authority. A guard trigger makes the override columns admin-only.
- Load extraction: expand the schema and prompt in extract.server.ts (references, contacts, handwritten notes, equipment hints, no guessing the customer). Spreadsheets are sent as CSV with headers.
- Packet extraction: a new staff-only server function sends the PDF/images to Lovable AI with a strict JSON schema. The file goes in the private carrier-docs bucket with `kind = 'packet'`. The review dialog applies the selected fields through the existing carrier update path, using carrierMerge's fill-blanks logic.
