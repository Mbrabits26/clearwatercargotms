# TMS polish round: reports, users, dates, carriers, search, invoices, reminders

## 1. Report downloads with totals
- Every CSV/print download in Reports adds a TOTAL row per section: revenue, carrier pay, margin, margin %, load count (and miles/accessorials where shown).

## 2. Edit users + temporary passwords
- Admin → Users: "Edit" on each person to change full name and email (email change is applied server-side and kept in sync with approved access).
- "Set password" gets a "Temporary — make them choose a new one" checkbox (on by default). On their next sign-in with it, they're sent to a "Create your new password" screen; they can set one or choose "Keep this password".
- Same flag applied after "Forgot password" resets.

## 3. Date boxes: type or pick
- One shared date field used everywhere (load builder, appointments, quotes, leads, carriers, fleet, invoices): type the date directly (MM/DD/YYYY) or open the calendar dropdown.

## 4. Carriers fully editable
- "Edit carrier" on each carrier: name, DBA, MC/DOT, address, phone, email, contact, insurance dates/limits, equipment, factoring, pay option. Lets a carrier added by name only be completed later. Compliance status still updates through the normal safety checks.

## 5. Alphabetical lists + type-ahead
- Carriers, customers, shippers, consignees always sorted A–Z (new ones included) in tabs and every picker.
- Pickers stay open and keep filtering as you type (no closing/losing the list after the first letter).

## 6. Load search
- Search box on Dispatch matches load number, ITS #, customer, carrier, shipper, consignee, city/state, refs/PO. Optional "search all dates" so older loads are found too.

## 7. Related loads on searches
- Opening/searching a carrier, customer, shipper or consignee shows a "Loads" list for that party (number, date, lane, status), each clickable to the quick look.

## 8. Editable invoices
- Admins can edit an invoice (bill-to, date, due date, line items, notes, amount), save it, then preview/print/download. Changes are saved on the accounting record; still admin-only.

## 9. Due-invoice reminders
- When an admin signs in, a reminder panel lists customer invoices coming due/past due and carrier bills due to pay.
- Admin → Settings: editable timelines (e.g. remind X days before due, customer terms default 30, carrier terms by pay option) and a "snooze for today".

## 10. Carrier on an optional load create form section
- Load builder gets a carrier section: pick an existing carrier or "Add new carrier" inline (name + MC/DOT, optional FMCSA lookup) without leaving the form. Safety checks still apply before booking.

## 11. Google address fill + rate con addresses
- Check and fix Google address auto-fill on Add customer/shipper/consignee/carrier.
- Rate con pulls full shipper and receiver address, phone and contact; checked on a real load.

## 12. Brokers see all customers, shippers and carriers
- Confirm brokers can view and pick every directory company and carrier (shared directory), while still only seeing their own loads and never other brokers' pay. Fix any gaps found.

## 13. Full review + confirm-before-save
- Walk through every tab as admin and as a broker; list and fix anything missing or broken.
- Every edit dialog gets a "Review changes" step (old vs new) before saving; deletes keep the type-to-confirm step.

## Order
Quick wins first (1, 3, 5, 6, 12), then 4, 7, 10, 11, 2, 8, 9, finishing with the full review (13).

## 15. Customer bill-to search by name
- Right now the customer, shipper and consignee pickers also match on city, so typing a name shows companies from that city too. They'll search by business name first, with names that start with what you typed listed at the top (A–Z). City only shows as a hint under each name.

## 14. Let brokers approve non-compliant carriers (admin option)
- Admin → Users: per-broker "Can approve non-compliant carriers" switch (off by default).
- Brokers with it on can use the compliance override (reason required, logged with name/time), same as admins.
- Do Not Use carriers and carriers without active authority stay blocked for everyone.
- The database safety rule checks this switch, so it can't be bypassed.

## Technical details
- New columns: invoice editable fields on accounting records (line items json, due date, notes); a must-change-password flag per user; reminder settings table (admin-only RLS, with grants).
- User email/name edits and temp-password flag via admin-verified server functions; auth gate redirects flagged users to a change-password page.
- Sorting via `order("name")` plus client sort after inserts; combobox keeps popover open on input.
- Search uses server-side `ilike` across load fields so it isn't limited to the 30-day window.
