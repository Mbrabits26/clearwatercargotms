<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md

- Subdirectories have their own `AGENTS.md`; read it before changing files there.
- Browser data access uses RLS; pay privacy and load visibility live in DB policies, not UI.
- Admission requires `approved_users`; roles (admin/broker/accountant, multiple per user) live in `user_roles`; `is_staff()`/`is_finance()` gate RLS. All staff share loads + qb_sync (insert/send); invoice edit/delete, QB connect and due reminders need is_finance; commissions admin/self-only.
- Carrier booking compliance is enforced by the `enforce_carrier_compliance` DB trigger so clients can't bypass it.
- Shared types/helpers: `src/lib/tms.ts`; query options: `src/lib/queries.ts`; PDFs: client-side jsPDF in `src/lib/`.
- QuickBooks: qb_connection id 1 Clearwater, id 2 Foust Farms; `entityForKind` routes fleet_invoice → fleet; billing company = invoice kind (default `invoiceKind` from loads.bill_through, which a DB trigger fills from the customer's companies.bill_through when left automatic; overridable at creation; pre-send switch only via finance-only `set_invoice_company`, renumbers the group). OAuth state carries entity; DocNumber dedupe.
- Public onboarding portal (/onboard/$token) uses only token-validating server fns, then the admin client; docs in private carrier-docs bucket.
- Rate cons: one jsPDF layout (`buildRateConPdf`) renders preview and signed copy; signing link stores a snapshot. RC # = load number. Signed rate cons are voided (void_reason/note on ratecon_requests), never deleted. Portal-signed carrier agreements are rendered server-side by `buildAgreementPdf`.
- Named admin emails get admin via the grant_named_admins trigger after email verification (edit its list).
- FMCSA/SAFER: `lookupFmcsa` (staff-only server fn, FMCSA_WEBKEY) → carriers.authority_status/safety_rating.
- Email: user-sent mail via `composeEmail` (each user's own Gmail); automated app alerts only via server-side `sendTemplateEmail` (incl. `notifyCarrierRemoved`: emails a carrier taken off a load only if it was sent a rate con, and voids its open rate con links) (Lovable managed email, templates in src/lib/email-templates/registry.ts). Chat channels: 'team' or sorted 'dm:<a>:<b>' (RLS by name). getMarketRates: Firecrawl + AI, cached 24h.
- Load offers: carriers respond on public /offer/$token via token-validated server fns (offers.functions.ts); staff manage offers under load-visibility RLS.
- Lane pricing math lives in laneStats/RateView, fed by lane_history_loads() (staff-only security definer, no broker_id) so brokers see company-wide history, not who earned it.
- User create/delete/password reset run in users.functions.ts (admin-verified via has_role, then admin client); area permissions in user_permissions gate the nav (admins bypass).
- Conditional carrier approval (carriers.conditional_until) is honored by enforce_carrier_compliance and admin-only via the guard_carrier_conditional trigger; DNU/unauthorized authority are never bypassable.
- Admin compliance overrides live on loads.override_* (guard_load_override trigger, admin-only); enforce_carrier_compliance honors them except DNU/unauthorized authority. Client `carrierCompliance().bookable` mirrors the trigger.
- Driver pings geocode server-side.
- `DocPreview` previews docs in-page. RC tracking: `applyTrackingFee` splits $200 out of carrier pay; editor shows split lines, load stores unsplit.
- `assign_invoice_number` trigger sets qb_sync number + QB class: invoice → INV-, fleet_invoice → FF- (Foust letterhead). Carrier bills store gross, quickpay_fee, net.
- Role changes via server-side `setUserAdmin` (no self-demotion, ≥1 admin).
- Deletes go through shared ConfirmDelete; log_deletion snapshots rows into deletion_log; FKs on loads/quotes/leads are ON DELETE SET NULL.
- ITS-imported loads carry loads.source='its' + external_ref (unique per source); enforce_carrier_compliance skips them only for server-side imports with no API request claims, so app users can't bypass it.
- Data API caps reads at 1000 rows.
- Combined invoice = qb_sync rows sharing one (non-unique) invoice_number, sent as one multi-line QB invoice. `isFleetLoad` loads (incl. FLEET_CARRIER_ID, the one internal-fleet carrier) stay out of brokerage reports.
- List bulk actions: `BulkActionBar` (per-row under RLS; bulk delete admin-only); loads use `BulkStatusBar`.
- Load rules/status history use DB triggers; `batch_load_action` and Reports bulk status (`BulkStatusBar`, rules in `bulkStatus.ts`) update per-row under RLS so triggers judge each load. `closed_at` archives operationally, never means paid; lightweight paged `loadWorkQuery` drives all-date notices without expanding Dispatch's default.
- qb_sync.deductions: amount gross, net=invoiceNet, QB minus lines. qb_sync.attachments go once (attachments_sent); qbSyncNow first runs `autoAttachPods` so load PODs (`isPodDoc`) join unsent customer invoices.
- carriers.inactive: hidden from CarrierPicker default list, still searchable; picking reactivates.
- Invoiced status may be set without an invoice (paid still needs one); `qbReviewState` (invoiceReview.ts) drives the finance-only InvoicedQbReview list + bell alert until the invoice is sent to QuickBooks.
- Doc renames never move storage objects (paths are referenced by loads/qb_sync/ratecons): carrier docs edit carrier_documents.file_name (staff, that column only); load-docs names live in load_doc_names keyed by path.
- Per-user alert choices live in notification_prefs (own-row RLS; missing row = all on); server emails check them via notifyPrefs.server.ts, the bell filters in-app alerts.
- Agent integrations (MCP): server tools in `src/lib/mcp/` (read-only, `supabaseForUser` so RLS applies as the OAuth caller; never admin client); consent at `src/routes/[.]lovable.oauth.consent.tsx`; /auth honors a validated `next` (oauthReturnPath) through password + Google. Browser-agent (WebMCP) tools live in the screen that renders the controls (Dispatch) and share its handlers.
- Accounting buttons: hint + warning box before data changes via `ActionGuard` (provider in __root); read-only buttons hint only.
