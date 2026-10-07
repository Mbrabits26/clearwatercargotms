# Load entry and dispatch fixes

## 1. Calendar date pickers
- Pickup and delivery appointments in the load builder and in the dispatch details get a calendar button to click a date, plus a separate time box. Typing still works.
- Quote pickup dates, follow-up dates and carrier insurance dates get the same calendar.

## 2. Edit everything after a load is created
- New "Edit load" button in the dispatch details opens the load builder filled in with that load: customer, shipper, consignee, cities, appointments, equipment, commodity, weight, pieces, temp, miles, reference numbers and facility notes.
- Pickup and delivery notes can be edited right on the Load tab.
- Load notes: the author (or an admin) can edit or delete their own notes. Deleting asks for confirmation first.
- Accessorials can be edited, not just removed.

## 3. Customer rate / carrier pay typing bug
- Root cause still unconfirmed. First step: reproduce it in the preview. The likely cause is that the details panel reloads after each keystroke and resets the box.
- Fix it so you can type the whole amount, and it saves when you leave the box or press Enter. The same fix goes on the accessorial amount box.

## 4. Commission % (Admin screen)
- Everyone starts at 0% (it currently defaults to 30%). Existing saved values get reset to 0.
- Only admins can change it. This is already enforced in the database and will be double-checked.
- Changing it shows a "Change commission for X from A% to B%?" prompt. After you confirm, it saves and shows a "Saved" message. If you cancel, the old value comes back.

## 5. Carrier assignment and manual override
- Fix carrier selection so picking a carrier actually assigns it. Right now non-compliant carriers can't be picked at all, and an error from the booking check isn't shown.
- Add "Override compliance" for admins on a single load: pick a carrier and give a required reason. The override is recorded on the load (who, when, why) and appears as a badge.
- Do Not Use carriers and carriers without Authorized authority can never be overridden. This matches the existing rule.
- Brokers see the reason a carrier is blocked, plus a "Request admin override" note.

## 6. Load sheet import pulling the wrong data
- Test with a sample sheet. Please upload one or two load sheets that failed so I can match their layout.
- Improve the reader: better handling of spreadsheet columns and multi-stop sheets, and it captures more details (PO/pickup numbers, ship/delivery refs, appointment times, contact phones, hazmat).
- After import, a review screen shows what was found next to the original fields, so you can fix any mistakes before saving.

## Technical details
- Date picker: shadcn Calendar + Popover wrapper component replacing raw date/datetime inputs.
- Rate inputs: the Cockpit state resets from `load` on refetch; key/sync fix plus commit on blur/Enter.
- Migration: `broker_commissions.commission_pct` default 0, all rows updated to 0. Add an UPDATE/DELETE policy on `load_notes` (author or admin). Add `loads.compliance_override_by/at/reason`. Update `enforce_carrier_compliance` to allow an admin-set override, never for DNU or unauthorized authority. Add a guard trigger so only admins can set the override columns.
- Extraction: expand the schema fields and prompt in extract.server.ts. Send spreadsheet CSV with header context.
