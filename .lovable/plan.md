# TMS on its own domain, billing fixes, and document previews

The website, partner portal and packet-import ideas stay saved in the draft "Website, portal, e-sign & billing preview". Nothing from that draft is added now.

## 1. Domain (TMS only)
- clearwatercargo.com is already registered. If you own it, I'll connect it to this app. If someone else owns it, we can't buy it, so pick another name: clearwatercargollc.com, clearwater-cargo.com, clearwatercargo.net, or clearwatercargo.co (first year free).
- The domain opens straight to the staff sign-in page, and signing in goes to Dispatch. No public website for now.
- Publish after connecting so the domain serves the current TMS.

## 2. Billing gaps (Accounting tab)
- **Invoice numbers and PDF:** each customer invoice gets its own number, starting at INV-10001. You get a branded Clearwater Cargo invoice PDF with bill-to, load number, references, lane, linehaul plus extras, total, and Net 30 terms. Email it from the app, with the POD attached when there is one.
- **Carrier invoice matching:** on a carrier bill, upload the carrier's invoice. Enter or read its amount, and the bill flags in red if it differs from the rate con total.
- **Quick Pay fee applied automatically:** carrier bills subtract the 5% (Quick Pay) or 2.5% (factored Quick Pay) fee based on the load's pay terms. The fee shows as Quick Pay revenue for us.
- **Loads we haul for outside brokers:** a third type, "Fleet billing," invoices the outside brokerage. It's kept separate from customer invoices.
- **Separate AR and AP totals:** money owed to us and money we owe each get their own totals and 0–30 / 31–60 / 60+ day aging, so they never mix.

## 3. Preview documents without downloading
- Every document in the app opens in a viewer inside the page when you click it: PDFs, photos, rate cons, signed rate cons, invoices, carrier documents, POD/BOL from drivers, and uploaded packets.
- Hovering over a document name shows a small preview on desktop. On phones, a tap opens the full viewer.
- The viewer has **Download** and **Open in new tab** buttons, plus next/previous when a load or carrier has several documents.
- Other file types, like Excel, show the file name with a Download button.

## 4. Import every carrier packet from your packet app ("Live App Polish")
- Your packet app keeps its records separately, so it has to share them first. I'll give you a short text to paste into the packet app's chat. It adds a private, password-protected export. Nobody can use it without the shared password.
- An admin-only **Import from packet app** button on the Carriers tab brings in every submission:
  - Carrier details, MC/DOT, contact, insurance and factoring
  - The pay option the carrier picked
  - **Every uploaded document** (W-9, COI, agreement, NOA, voided check and others), saved to that carrier's Documents and opening in the new viewer
  - The signature record: signer, date and time, IP address, device and reference number
- Duplicates merge with the carriers you already have (DOT, MC, name) and only fill empty fields. New carriers start as Pending, and Vetted/DNU status never changes.
- You see a preview before anything saves, and a summary after. Running it again skips packets already imported. Optional: check for new packets every hour.

## Technical details
- Packet export: a server route in the packet app, `/api/public/packet-export`, using a Bearer shared secret with a timing-safe compare. It returns submissions plus 10-minute signed URLs for its `carrier-documents` files. In this app, `PACKET_EXPORT_URL` and `PACKET_EXPORT_SECRET` secrets feed an admin-only `importPackets` server fn. It uses carrierMerge fill-blanks, copies files into `carrier-docs/<carrier_id>/`, adds `carrier_documents` rows (source "packet app"), and creates a new `carrier_signatures` table (external_ref unique, staff-read / admin-write RLS).
- Domain: run the connect check for the chosen name, then show the connect card. The root route already redirects to the sign-in page.
- Migration: `qb_sync` gains `invoice_number` (sequence-backed, AR only), `carrier_invoice_amount`, `carrier_invoice_path`, `quickpay_fee` and `net_amount`. The `kind` value gains `fleet_invoice`. A unique `(load_id, kind)` constraint already applies, and admin-only RLS stays as it is.
- Invoice PDF via jsPDF in `src/lib/invoice.ts`, reusing the ratecon layout helpers and logo. It's emailed through `composeEmail`.
- Fee math uses `effectivePayTerms` and `PAY_TERMS` from tms.ts.
- A shared `DocPreview` component (HoverCard + Dialog) uses short-lived signed URLs from the private buckets. PDFs show in an iframe/object, images in an img, and generated PDFs render from a blob URL. It replaces the current download-only links in CarrierOnboarding, RateConPanel, TrackingPanel, the dispatch Docs tab and Accounting.
