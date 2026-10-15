# Clearwater Cargo TMS roadmap

## Done (round 1 — core operations)
- [x] Logins, admin/broker roles, broker pay privacy
- [x] Directory (customers, shippers, consignees)
- [x] Carriers: vetting checklist, compliance gate, DNU list, factoring/NOA
- [x] Split dispatch board, status dropdowns, alerts, load builder, accessorials
- [x] Lane intelligence (30/90 day), DAT/Truckstop CSV export
- [x] Branded rate con PDF, QuickPay/advance calculator
- [x] Admin financials and commissions

## Next
- [x] Mobile/tablet interface: bottom navigation, list-to-details screens, touch-safe forms and responsive tables
- [x] Approval-only sign-in managed by admins while preserving current users
- [ ] Sales CRM pipeline + spot quote PDFs with 24h expiry
- [x] Internal fleet: trucks, trailers, drivers, availability, dispatch assignment
- [ ] Outside-broker loads hauled by our trucks (MC#, external rate con, billing)
- [ ] Google Places autofill (needs Google Maps connection)
- [x] Live FMCSA lookup
- [x] Carrier onboarding packet portal (built in-app: invite links, uploads, insurance expiry alerts)
- [x] Digital rate con signing links (template layout, signed PDF attached to load)
- [x] QuickBooks section: AR/AP send queue + sync log
- [ ] Live QuickBooks delivery of queued items (blocked: user adds Intuit Client ID/Secret in Project Settings → Secrets, then tells me)
- [x] Customizable reports: customer AR, carrier AP, broker loads/amounts, custom filters + CSV
- [x] Admin access for accounting@ and eric@clearwatercargo.com (verified email only)
- [x] Bulk import (xlsx/csv) on Directory + Carriers; import customerlist.xlsx
- [x] Document/spreadsheet import → load builder (AI extraction, multi-load docs)
- [x] Type-to-search customer/shipper/consignee/carrier with add-new
- [x] Carrier packet invite email drafts (Carriers tab, carrier detail, dispatch)
- [ ] QuickBooks Online live connection + auto-sync (blocked: user adds Intuit Client ID/Secret in Project Settings → Secrets, then tells me)
- [x] FMCSA live lookup (Add carrier + Re-check FMCSA)
- [x] Gmail/Workspace email option for invites + rate cons
- [x] Team chat pop-up + per-load notes
- [x] @mentions in chat + notes
- [x] Mass load offers to carriers (accept/reject/counter, send from my Gmail or dispatch)
- [x] Carrier lane history
- [x] Rate View + price a load
- [x] Public market rates (FreightWaves etc. via web search)
- [ ] Automatic sending from dispatch@ (blocked: email domain setup)
- [x] Quotes tab + RFP mode
- [x] Admin user management: add/delete users, roles, permissions
- [x] FMCSA free SAFER fallback + 24h cache + Open in SAFER (no paid searches)
- [x] Sales Leads tab with contact log + follow-ups
- [x] Direct Gmail sending per user (google_mail App User Connector, Connect Gmail button in header)
- [x] Driver tracking link: status, GPS, POD/BOL upload auto-attaching to the load
- [x] FMCSA lookup fills email/contact/phones (free Census file); Add carrier full fields
- [x] Duplicate carriers merged on add/import + Find duplicates merge tool
- [x] Admin conditional carrier approval while documents pending (DB-enforced)
- [x] Rate con email auto-fills from assigned carrier
- [x] Calendar date pickers; Edit load after creation; editable/deletable load notes and facility notes
- [x] Load builder typing fix; commission default 0 with admin-confirmed changes
- [x] Carrier assignment matches DB rules + admin compliance override (recorded on load)
- [x] Load sheet reader: refs, PO, contacts, handwritten carrier/rate, no guessed customer
- [x] Full carrier packet upload → review → fills carrier fields and checklist
- [x] Rate con: multiple recipient emails + copy to myself
- [x] Load number quick-look panel + Open load jump (Reports, Fleet, Accounting)
- [x] Accounting tab: AR/AP with aging, edit/delete/retry queued items (admin only)
- [x] Weekly carrier safety/authority auto re-check (FMCSA/SAFER, free) + team-chat change notices
- [ ] MOTUS DOT lookup (dropped: no free public MOTUS endpoint; FMCSA QCMobile + SAFER cover it)
- [x] Factoring pay option on carrier sign-up packet
- [x] Document preview viewer (hover / in-page, with Download)
- [x] Billing: invoice numbers + PDF, carrier invoice match, auto Quick Pay fee, fleet billing, AR/AP totals
- [ ] Import carrier packets from "Live App Polish" — TMS side built (waiting: export added in that app + shared secret)
- [ ] Connect clearwatercargo.com (user will do once they have the registrar login)

## Round 3 — ITS move, delete anywhere, standard broker features
- [x] Directory: "Also add as" shipper/consignee/customer; customer/shipper/consignee spreadsheets imported
- [x] Delete anywhere with type-to-confirm + admin deletion log; accounting-linked deletes admin-only
- [x] ITS history import (879 loads imported as CW-<ITS #>; user to fill CW-15435 destination)
- [ ] ITS Sync section in Admin for recurring uploads (built to match the ITS export columns once received)
- [ ] Clearwater TMS API keys + inbound/outbound endpoints
- [ ] Multi-stop loads
- [ ] Automatic customer status emails
- [ ] Automatic check-call prompts
- [ ] Customer portal
- [ ] Carrier bid portal
- [ ] Smart carrier suggestions
- [ ] Carrier scorecards
- [ ] Carrier bill audit (rate con / invoice / POD match)
- [ ] Customer credit limits
- [ ] Claims tracking
- [ ] Phone camera BOL/POD capture with AI filing
- [x] Full TMS check: every tab/function works (fleet sample trucks can't be deleted)
- [x] Accounting + Admin checked with an admin session; fixed 1,000-row fetch cap hiding companies past "B" in Accounting (and possible bulk-import duplicates)
- [x] michael@clearwatercargo.com promoted to Admin
- [x] Speed up data loading: dispatch board defaults to last 30 days of loads (checkbox shows older); reports/accounting still read all loads; domain change will NOT help speed
- [x] Copy a load into multiple loads (Copy load button + Create how many in load builder)

## Polish round (Oct 13)
- [x] Report CSV: group subtotals + grand total
- [x] Date boxes: type MM/DD/YYYY or pick from calendar
- [x] Pickers search by name (not city), A–Z, starts-with first
- [x] Dispatch search: customer/carrier/shipper/consignee/refs/ITS #, searches all dates
- [ ] Brokers see all customers/shippers/carriers (verify)
- [ ] Edit carrier (all fields)
- [ ] Related loads on carrier/company
- [ ] Optional carrier section + add-new carrier in load builder
- [ ] Google address fill check; rate con shipper/receiver addresses
- [ ] Edit user name/email; temporary password → choose new
- [ ] Admin-editable invoices (save/print)
- [ ] Due-invoice reminders at admin sign-in with editable timelines
- [ ] Admin switch: brokers may approve non-compliant carriers (DB-enforced)
- [ ] Full review + review-changes step before saving edits
- [x] Lanes run rows clickable → loads list with quick look
- [x] Brokers see company-wide lane history + rate view (no broker attribution)
- [x] Customer "brought in by" + Customer commissions report

## Done (round 3 — polish, 2026-10-14)
- [x] Reports CSV: group subtotals + grand total
- [x] Date fields: typeable + calendar dropdown (DatePicker everywhere)
- [x] Entity pickers: A–Z, starts-with first, name-only search
- [x] Dispatch search across all dates (auto-includes older loads)
- [x] Lane history clickable → load quick look; brokers see company-wide lanes/Rate View (no broker pay)
- [x] Customer "Brought in by" + broker commission report
- [x] Edit carrier dialog (all fields) on carrier detail
- [x] Optional carrier section in load builder (compliant attach; new name → pending, not attached)
- [x] Admin: edit user name/email; temp-password forces choose-own-password at next sign-in
- [x] Admin due-invoice reminders banner with editable day thresholds (AR / AP / QuickPay)
- [x] Admin-granted broker permission "Override carrier compliance" (DB trigger updated; DNU/unauthorized still blocked)
- [x] One-click copy string on every load (dispatch rows, load cockpit, quick look) — paste-ready details, no rates

## Open
- [x] Google address autofill (directory, carrier edit, new shipper/consignee in load builder)
- [x] Full walkthrough (all tabs load clean); review-changes step on carrier, company, user, invoice edits; Directory companies now editable
- [x] Onboarding: signed broker-carrier agreement PDF saved to carrier docs (11 past signers backfilled); file slots follow pay option; pay terms/remit pre-fill + sync
- [x] Delete a signed rate con with reason + note (kept in history), optional remove carrier, then send revised
