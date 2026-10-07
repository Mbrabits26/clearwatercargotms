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

- App data is read/written from the browser client under RLS; privacy rules (broker pay, load visibility) live in database policies — keep them there, not in UI.
- Roles live in `user_roles` with `has_role()`; first signup becomes admin via the `handle_new_user` trigger.
- Carrier booking compliance is enforced by the `enforce_carrier_compliance` DB trigger so no client can bypass it.
- Shared TMS types/helpers live in `src/lib/tms.ts`; query options in `src/lib/queries.ts`; PDFs generated client-side with jsPDF in `src/lib/`.
- QuickBooks sends are recorded in `qb_sync` (admin-only RLS) as a queue; a future server-side worker delivers queued rows once QuickBooks is connected.
- Carrier onboarding portal (/onboard/$token) is public; it only touches data through server functions that validate the invite token, then use the admin client. Documents live in the private carrier-docs bucket.
- Rate cons: one jsPDF layout (`buildRateConPdf`) renders both preview and signed copy; the signing link stores a snapshot so the carrier signs exactly what was sent. RC # = load number. Signed PDFs live in the private load-docs bucket under the load id.
- Named admin emails are granted admin by the grant_named_admins trigger only after email verification; edit that function's list to change them.
- Dispatch document extraction runs server-side in `extract.server.ts` (Lovable AI, strict JSON schema); spreadsheets are converted to CSV text in the browser first. New directory entities typed in the load builder are created on save.
- FMCSA/SAFER lookups run in `lookupFmcsa` (server fn, staff-only) using the FMCSA_WEBKEY secret; results map to carriers.authority_status/safety_rating.
- Outbound emails go through `composeEmail` in src/lib/email.ts: sends directly via the google_mail App User Connector when the user connected Gmail (encrypted keys in app_user_connections, sendGmail in src/lib/gmail.functions.ts), else falls back to a Gmail compose/mailto draft.
- Team chat uses chat_messages channels ('team' or 'dm:<idA>:<idB>' sorted); RLS checks membership from the channel name.
- Load offers: carriers respond on public /offer/$token via token-validated server fns (offers.functions.ts); staff manage offers under load-visibility RLS.
- Public market rates: getMarketRates (staff-only) searches public pages via Firecrawl, Lovable AI summarizes to strict JSON, cached 24h in market_rate_cache.
- Lane pricing math lives in laneStats/RateView (src/components/RateView.tsx), reused by the dispatch cockpit, quotes and RFP tool.
- User create/delete/password reset run in users.functions.ts (admin-verified via has_role, then admin client); area permissions in user_permissions gate the nav (admins bypass).
