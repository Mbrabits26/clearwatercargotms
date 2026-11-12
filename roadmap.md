# Roadmap

- [ ] Diagnose missing queued entries for 114 checked Accounting loads, explain AR inclusion, and correct Paid + Closeout for already-closed unpaid loads without deleting invoices.

- [x] Align Accounting checked-load and quick-batch choices, including customer Paid, Closeout and Paid + Closeout; 21 tests passed including a 115-load batch, real-account 115-load and Sync log confirmations verified and cancelled without changing payments.

- [x] Restore app-wide load hover details including Accounting; exclude Dispatch board and load detail screen. Four rule tests passed; real Accounting table/summary, repeat hover, Home and laptop previews verified; no financial changes.

- [x] Accounting: Apply to all checked across AR, fleet AR, AP and Sync log; shared terms/amount/payee/due/deduction/company edits plus existing send/retry/remove and document/link/email review; 28 tests passed, real-account selection, sequential review and confirmations verified without saving financial changes.

- [x] Accounting totals: AP/QuickPay use carrier payment records, totals open printable load details, refresh every minute/manual; real-account AR/AP/fee windows, search and refresh verified; 21 tests passed.

- [x] Accounting manual QB linking: make existing correction visible by name in AR and Sync log; offer matching for Not sent loads without a TMS invoice, with a permanent top-level entry.
- [x] CW-10472 white POD display: saved scan contains legible paperwork/signatures; PDF.js preview verified at phone/desktop sizes without altering load or invoice.
- [x] POD hover previews without automatically downloading; browser verified zero hover downloads and successful explicit Download.
- [x] Explain thumb removal: outside-paper fingers can be cropped; do not reconstruct obscured content or alter the signed POD to invent missing paper.

- [x] Driver POD: convert one or multiple photos into one PDF attachment, preserving every selected page; 12 tests passed, real driver page produced a verified two-page PDF (upload intercepted before changing a load).

- [x] Driver POD link: multiple photos with add/remove and explicit finish; all files verified before delivery/link closure, saved pages kept on retry; 12 tests passed and mobile selection verified on a real link without submitting PODs.

- [x] Expand carrier due-pay window: searchable load/carrier views, references, due dates, paperwork, fees and printable detail; 14 pay-rule tests passed; real accounting search and drill-down verified without payment changes.

- [x] Rate confirmations: email or phone signing-link sharing with Google Voice/texting app and manual phone/text copy.

- [x] Load uploads: custom typed labels and regular/factoring carrier invoice choices; finance-only reviewed remit/payment saving; 25 focused tests passed; custom upload and factoring form browser-verified (no real payment details changed)

- [x] Accounting: finance-only manual invoice linking; verified invoice 2088 / ref 40114919 assigned to CW-15408; removed conflicting CW-10529 link without changing ref 40116298
- [ ] Accounting CW-10529: held pending verification of its existing QB invoice for customer ref 40116298; do not auto-create a replacement
- [ ] Review permission-controlled manual corrections throughout TMS (documents, numbers, assignments); implement confirmed gaps without bypassing safeguards
- [x] Tracking: added phone-only and phone + tracking text copy; Google Voice message unchanged; focused tests passed

- [x] Shipper prospect finder + cold outreach (sender micheal@clearwatercargo.com, multi-sender, sister-domain ready)
- [x] Carrier packet link mobile/tablet friendly
- [x] Rate con signing link mobile/tablet friendly
- [x] Outreach: read shipper replies from Gmail automatically and act on them
- [x] Document viewer: Attach to QuickBooks + Delete buttons
- [x] Load notes: @tags (@team/@everyone/@person) must alert the tagged people
- [x] Add Carrier form always opens blank
- [x] Home cockpit + per-person start screen (role defaults)
- [x] Quick carrier onboard from any screen
- [x] Load creation: warn on duplicate customer/shipper/delivery ref and ask first
- [x] Accounting: QB duplicate audit + payment document check
- [x] Chat/alerts naming a load are clickable
- [x] QB duplicate check: shared customer ref # on two different TMS loads is not a duplicate
- [x] Ideas for bringing in new shipper customers
- [ ] Core ELD: receiver + Live ELD tab built; waiting on Core ELD to send data (or give pull API docs)

- [x] Queue 10 first-touch shipper emails (Jordan Lumber + Culpeper excluded per user); send Mon 8am ET window
