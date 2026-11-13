# src/routes/_authenticated

- Dispatch: heavy dialogs (load builder, bulk loads) mount only while open, and the search box keeps its own text and updates the board after a pause, so typing never redraws the whole board.
- Accounting summary totals and detail windows share filters; paged invoice reads drive AR, shared carrier-pay math drives AP/fees independently of QB bills and customer paid status; refresh every minute. Why: carrier payables exist before queuing bills.
- Checked Accounting actions reuse existing handlers/RLS and review dialogs; links/packets dedupe combined invoices, line edits do not. Why: batch controls must retain financial safeguards and correct per-load amounts.
- Accounting history uses `accountingLoadScope.ts` to include paid/closed loads in existing edit/link controls without status writes; AR/AP remain based on unpaid records. Why: invoice corrections must not reopen loads or inflate balances.
