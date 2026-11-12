# src/routes/_authenticated

- Dispatch: heavy dialogs (load builder, bulk loads) mount only while open, and the search box keeps its own text and updates the board after a pause, so typing never redraws the whole board.
- Accounting summary totals and detail windows share filters; paged invoice reads drive AR, shared carrier-pay math drives AP/fees independently of QB bills and customer paid status; refresh every minute. Why: carrier payables exist before queuing bills.
