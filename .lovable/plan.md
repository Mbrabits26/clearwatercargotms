# Carrier packet import, company website and partner portal

## Part 1 — Bring in every carrier from the packet app

Your packet app ("Live App Polish", clearwatercarrierpacket.lovable.app) keeps its own separate records. This app can't read them until the packet app shares them securely.

**Step A — one change in the packet app.** I'll give you a short request to paste into the packet app. It adds a private export link protected by a secret password that both apps share. The link sends each submission and a short-lived download link for each file. Nobody can use it without that password.

**Step B — "Import from packet app" button (admins only, Carriers tab).**
- Pulls every submission: carrier name, MC/DOT, contact, email, phone, address, equipment, insurance limits and dates, factoring/NOA, and the pay option they picked (Net 30, Quick Pay 5%, Factored Quick Pay 2.5%).
- Uses the same duplicate matching as now (DOT, MC, name). It fills empty fields on carriers you already have and creates new carriers as Pending. Vetted or DNU status never changes.
- Copies every uploaded file (W-9, COI, agreement, NOA, voided check, others) into that carrier's Documents and ticks the matching checklist items.
- Saves the signature record on the carrier: signer name, date and time signed, IP address, device/browser, and the packet reference number. It shows on the carrier profile as "Signed online" proof.
- Shows a preview first (new / will merge / unchanged / problems), then a results summary. Running it again skips packets already imported.
- Optional: check again for new packets automatically every hour.

## Part 2 — Domain

Available names (clearwatercargo.com is already taken by someone else):
- clearwatercargollc.com — $11.10/yr
- clearwater-cargo.com — $11.10/yr
- clearwatercargo.net — $12.30/yr
- clearwatercargo.co — first year free with your workspace offer, then $25.16/yr

Tell me which one, and I'll show you the purchase card. It connects to this app automatically.

## Part 3 — Public company website (same app, same domain)

- **Home** — who Clearwater Cargo is, services (brokerage + own trucks), lanes and equipment, contact info, owl branding.
- **Request a quote** — lane, dates, equipment, weight. It lands in Sales Leads / Quotes for review.
- **Offer us a load** (brokers and shippers) — load details. It lands in a new "Inbound loads" list for review. You accept it into Dispatch with one click, and it opens prefilled in the load builder.
- **Carriers** — "Haul for us" link to the carrier packet, plus a "Send an invoice / POD" form.
- **Contact / billing question** — a general message form.
- Every form has spam protection, and each new submission posts a notice to team chat.

## Part 4 — Partner portal (login for existing carriers and customers)

- An admin invites a carrier or customer and links them to their record in this app. Only invited people can log in, the same approval rule your staff already have.
- **Carriers see:** their loads with us, rate cons to sign, an upload box for invoices, POD and BOL (attached to the right load), payment status, and messages to dispatch.
- **Customers see:** their loads and status, quote requests, invoices, billing questions and messages.
- Partners never see other companies, broker pay or margins. All of that stays locked in the database, like broker privacy today.
- New "Partner inbox" in the TMS for their messages, uploads and requests.

## Part 5 — Staff TMS stays login-only

- The website lives at the domain root. The TMS sign-in gets its own address (for example yourdomain.com/login) that staff can bookmark or add to their phone home screen. Signing in goes straight to Dispatch, and you stay signed in after that.
- Partners use a separate sign-in at /portal. Staff and partners never land in each other's areas.
- The TMS keeps its current phone layout (bottom bar, list then details). The website and portal are built phone-first too.

## Open items
- You: paste the export request into the packet app (I'll give you the exact text) and pick a domain.
- Your website content: I'll write placeholder text (services, about us, phone/email). Send me your real details and photos to swap in.

## Technical details
- Packet app has its own backend. Export: server route there, `/api/public/packet-export`, using a Bearer shared secret (`PACKET_EXPORT_SECRET`, timing-safe compare). It returns submissions (payload, signatures, signer_ip, user_agent, signed_at, reference_number, pay_type) plus 10-minute signed URLs from its `carrier-documents` bucket.
- TMS: an admin-only server fn `importPackets` fetches the export, maps the payload into carriers via `carrierMerge`, streams files into `carrier-docs/<carrier_id>/`, and inserts `carrier_documents` with source "packet app". A new `carrier_signatures` table (carrier_id, signer, signed_at, ip, user_agent, external_ref unique) handles idempotency. It's staff-read RLS and admin-write.
- Website: public SSR routes (`/`, `/quote`, `/offer-load`, `/carriers`, `/contact`) with their own head metadata. Public form submissions go through server fns with Zod validation, a honeypot and rate limiting. Rows go into a new `inbound_requests` table (kind, payload, attachments; insert only through the server fn; staff-read RLS). Files go in a private `inbound-docs` bucket.
- TMS routes move under an `/app` prefix (dashboard redirect after login). `/login` is the bookmarkable staff sign-in, and old URLs redirect.
- Partners: add `partner` to `app_role`, plus a `partner_links` table (user_id → carrier_id or company_id). `approved_users` gains a partner kind. RLS policies for partner reads are scoped through `partner_links`. `is_staff()` stays false for partners, so staff screens and data stay closed. Portal routes go under a separate `_partner` layout.
- Optional hourly sync via pg_cron calling a cron-secured import route.
