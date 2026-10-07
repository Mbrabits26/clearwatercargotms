# Cancel or delete a load

## What you'll get
- **Cancel load** button in the load's details on the Dispatch board. You pick a reason (customer cancelled, carrier fell off, TONU, duplicate entry, other) and can add a note. The load moves to a new grey "Cancelled" status. It drops out of the active queue but stays in history, reports and lane rates. You can reopen it later if plans change.
- **Delete load** (admins, plus the broker assigned to the load) for loads entered by mistake. It asks you to confirm by typing the load number, then removes the load along with its notes, offers, tracking links and rate con requests.
- You can't delete a load that already has a signed rate con, was invoiced or paid, or was sent to QuickBooks. Cancel those loads instead so the paperwork trail stays intact.
- A "Show cancelled" filter on the Dispatch board.

## Technical details
- Migration: add `cancelled` to `load_status`, plus nullable `loads.cancel_reason`, `cancelled_at` and `cancelled_by` columns.
- The database already lets the assigned broker or an admin delete a load. Add a BEFORE DELETE trigger that blocks deletion when the load is invoiced or paid, has a signed `ratecon_requests` row or has a `qb_sync` row. Child foreign keys (notes, offers, tracking, ratecon, mentions) become ON DELETE CASCADE.
- UI changes in `dispatch.tsx` (cockpit header menu, confirm dialogs, queue filter) and `tms.ts` (STATUSES entry). Cancelled loads are left out of the active and overdue alerts.
