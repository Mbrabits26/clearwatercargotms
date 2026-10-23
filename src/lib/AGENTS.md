# src/lib

- Doc extraction runs server-side in `extract.server.ts` (Lovable AI, strict JSON); spreadsheets are converted to CSV in the browser first. All document AI reads share `readDocJson`; carrier packets use `extractCarrierPacket` plus a review step before writing to carriers.
- `fixCarrierWithAi` reads carrier-docs + FMCSA, fills blanks only, preview-then-apply.
- Carrier duplicate matching/merging (DOT, MC, normalized name; fill blanks only) lives in `carrierMerge.ts`; cross-table merges run in `mergeCarriers` (carriers.functions.ts).

- Finance review assistant: AI (`planReview`) only turns a plain-English request into a filter; listing/matching is deterministic (`reviewAssistant.ts` + qbMatch) and every change needs row selection + confirm.
- Report/list exports share `reportExport.ts` (ReportSpec → branded landscape jsPDF + CSV) via the `ReportExport` buttons; build specs from on-screen filtered rows and never include bank account numbers.
