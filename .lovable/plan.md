# Full admin check: Accounting and Admin tabs

## Goal
Finish the TMS-wide check by testing the two tabs that couldn't be verified before, signed in as Michael (admin).

## How I sign in
I mint a browser session under Michael's own account. A confirmation card will pop up for Michael to approve — no passwords are shared or changed, and no accounts are modified.

## What gets checked (read-through only — nothing deleted or edited)

**Accounting tab**
- Opens for an admin; AR and AP lists load with real numbers
- Invoice / fleet invoice / bill tabs, aging buckets (0–30, 31–60, 60+)
- Totals and stats make sense against the imported loads
- Edit, retry, and remove-from-queue controls are visible for an admin (clicked no further than opening the dialogs)

**Admin tab**
- Users: list, admin switch, approved users, area permissions
- ITS Sync section
- Deletion log
- Carrier check report

**Cross-checks**
- Admin-only protections still hold (verified from the earlier non-admin session where relevant)
- Console and runtime errors collected during the walkthrough

## If something is broken
Report each finding in plain language with what's wrong and the fix. Small fixes get made right after the check; anything larger gets its own short plan.

## What I won't do
No deletes, no edits to invoices or users, no emails sent — the walkthrough is read-only.
