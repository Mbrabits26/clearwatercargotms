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

- Browser data access uses RLS; pay privacy and load visibility live in DB policies, not UI.
- Admission requires `approved_users`; roles (admin/broker/accountant, multiple per user) live in `user_roles`; `is_staff()`/`is_finance()` gate RLS. All staff share loads + qb_sync (insert/send); invoice edit/delete, QB connect and due reminders need is_finance; commissions admin/self-only.
- Carrier booking compliance is enforced by the `enforce_carrier_compliance` DB trigger so clients can't bypass it.
- Shared types/helpers: `src/lib/tms.ts`; query options: `src/lib/queries.ts`; PDFs: client-side jsPDF in `src/lib/`.
- QuickBooks: `qb_sync` (admin-only RLS) is the queue; quickbooks.server.ts delivers rows via Intuit OAuth tokens in server-only `qb_connection` (no client grants), deduping by DocNumber; the redirect URI is fixed to the published domain.
- Carrier onboarding portal (/onboard/$token) is public; it only touches data through server functions that validate the invite token, then use the admin client. Documents live in the private carrier-docs bucket.
- Rate cons: one jsPDF layout (`buildRateConPdf`) renders preview and signed copy; signing link stores a snapshot. RC # = load number. Signed rate cons are voided (void_reason/note on ratecon_requests), never deleted. Portal-signed carrier agreements are rendered server-side by `buildAgreementPdf`.
- Named admin emails are granted admin by the grant_named_admins trigger only after email verification; edit that function's list to change them.
- Dispatch document extraction runs server-side in `extract.server.ts` (Lovable AI, strict JSON schema); spreadsheets are converted to CSV text in the browser first. New directory entities typed in the load builder are created on save.
- FMCSA/SAFER lookups run in `lookupFmcsa` (server fn, staff-only) using the FMCSA_WEBKEY secret; results map to carriers.authority_status/safety_rating.
- Outbound email goes through `composeEmail` (src/lib/email.ts): Gmail connector, else mailto draft.
- Team chat uses chat_messages channels ('team' or 'dm:<idA>:<idB>' sorted); RLS checks membership from the channel name.
- Load offers: carriers respond on public /offer/$token via token-validated server fns (offers.functions.ts); staff manage offers under load-visibility RLS.
- getMarketRates (staff-only): Firecrawl + Lovable AI, cached 24h in market_rate_cache.
- Lane pricing math lives in laneStats/RateView, fed by lane_history_loads() (staff-only security definer, no broker_id) so brokers see company-wide history, not who earned it.
- User create/delete/password reset run in users.functions.ts (admin-verified via has_role, then admin client); area permissions in user_permissions gate the nav (admins bypass).
- Carrier duplicate matching/merging (DOT, MC, normalized name; fill blanks only) lives in src/lib/carrierMerge.ts; cross-table merges run in mergeCarriers (carriers.functions.ts) so related rows move atomically server-side.
- Conditional carrier approval (carriers.conditional_until) is honored by enforce_carrier_compliance and admin-only via the guard_carrier_conditional trigger; DNU/unauthorized authority are never bypassable.
- Admin compliance overrides live on loads.override_* (guard_load_override trigger, admin-only); enforce_carrier_compliance honors them except DNU/unauthorized authority. Client `carrierCompliance().bookable` mirrors the trigger.
- Document AI reads share `readDocJson` in extract.server.ts; carrier packets use `extractCarrierPacket` and a review step before writing to carriers.
- Driver pings are reverse geocoded server-side (geocode.server.ts) into load_tracking_pings.place; the browser map uses only the browser key.
- Docs preview in-page (`DocPreview`). RC tracking uses `applyTrackingFee` before snapshots; edits hold unsplit rates to prevent double deductions.
- AR invoice numbers + QuickBooks class come from the `assign_invoice_number` trigger on qb_sync: invoice → INV-, fleet_invoice (loads with truck_id) → FF- and the fleet entity letterhead (FF in invoice.ts). Carrier bills store gross, quickpay_fee and net.
- Carrier problems come from `carrierIssues` (tms.ts); `fixCarrierWithAi` (carrierFix.functions.ts) reads stored carrier-docs + FMCSA and only fills blank fields via mergeFill, preview-then-apply.
- Role changes go through `setUserAdmin` server-side (no self-demotion, always ≥1 admin); password resets are verified by a test sign-in.
- Deletes go through shared ConfirmDelete; log_deletion snapshots rows into deletion_log; FKs on loads/quotes/leads are ON DELETE SET NULL.
- ITS-imported loads carry loads.source='its' + external_ref (unique per source); enforce_carrier_compliance skips them only for server-side imports with no API request claims, so app users can't bypass it.
- Data API reads cap at 1000 rows; companiesQuery (fetchAllPaged) and bulk-import dedup paginate.
- Combined invoice = qb_sync rows sharing one invoice_number (batchInvoice.ts), sent as one multi-line QB invoice. `isFleetLoad` loads (incl. FLEET_CARRIER_ID, the one internal-fleet carrier) stay out of brokerage reports.
- Load status/date/rate rules live in the `enforce_load_rules` trigger (admins bypass status steps; ITS imports skipped); `log_load_status` writes each status change to load_notes.
