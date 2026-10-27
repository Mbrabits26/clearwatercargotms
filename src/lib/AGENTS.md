# src/lib

- Doc extraction runs server-side in `extract.server.ts` (Lovable AI, strict JSON); spreadsheets are converted to CSV in the browser first. All document AI reads share `readDocJson`; carrier packets use `extractCarrierPacket` plus a review step before writing to carriers.
- `fixCarrierWithAi` reads carrier-docs + FMCSA, fills blanks only, preview-then-apply.
- Carrier duplicate matching/merging (DOT, MC, normalized name; fill blanks only) lives in `carrierMerge.ts`; cross-table merges run in `mergeCarriers` (carriers.functions.ts).

- Finance review assistant: AI (`planReview`) only turns a plain-English request into a filter; listing/matching is deterministic (`reviewAssistant.ts` + qbMatch) and every change needs row selection + confirm.
- Report/list exports share `reportExport.ts` (ReportSpec → plain black-on-white landscape jsPDF + CSV) via the `ReportExport` buttons; build specs from on-screen filtered rows and never include bank account numbers.
- Carrier pay due: `carrierPay.ts`, clock = loads.pod_received_at (trigger-stamped); carrier_paid_* finance-only (stamp_load_pay_fields); bank info in finance-only carrier_payment_accounts. Carrier page "Carrier payments" window (CarrierPayments.tsx) classifies via carrierPayState/carrierPaySummary; Mark paid finance-only.
- Reports' billing stage / invoice # come from `src/lib/reportBilling.ts` (paged qb_sync; a sent or linked customer invoice beats load status, except Paid/Cancelled).
- MCP tools in `mcp/`: read-only, use `supabaseForUser` so RLS applies as the OAuth caller; never the admin client. Consent at `src/routes/[.]lovable.oauth.consent.tsx`; /auth honors a validated `next` (oauthReturnPath) through password + Google. Browser-agent (WebMCP) tools live in the screen that renders the controls (Dispatch) and share its handlers.
