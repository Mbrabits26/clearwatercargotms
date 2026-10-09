# Directory: multi-list companies + spreadsheet import

## 1. Add a company to more than one list at once

Today the Directory's "Add customer / shipper / consignee" dialog saves to only the list you're viewing.

- The Add dialog gains an **"Also add as"** row of checkboxes for the other two lists.
  - Adding a **customer** → checkboxes: "Also a shipper", "Also a consignee".
  - Adding a **shipper** → "Also a customer", "Also a consignee".
  - Adding a **consignee** → "Also a customer", "Also a shipper".
- On save, one entry is created per checked list, all with the same name, contact, phone, email and address. The company then shows up on each of those Directory tabs and in the matching pickers in the load builder and quote tools.
- Success message says what happened, e.g. "Added as customer and shipper".

## 2. Three-spreadsheet import (waiting on your uploads)

When you upload the three Excel files (customers, shippers, consignees):

- Each company is added **only under the list its file represents** — a shipper or consignee never becomes a customer unless it's also on the customer list.
- A name appearing on more than one file gets an entry on each of those lists, details filled in once.
- Names already in the Directory are skipped, with blank details (phone, email, address, contact) filled in — nothing existing is overwritten.
- You get a summary: how many added, how many updated, how many skipped per list.

## Technical details

- `src/routes/_authenticated/directory.tsx`: add `alsoAs` state (checkboxes for the other kinds); `save()` inserts one `companies` row per selected kind in a single batch; duplicates guarded by normalized-name check against existing rows.
- Import: files parsed in the browser, matched against existing companies by normalized name, fill-blanks only (same merge rule as carrier import), inserted per list kind.
- No database changes needed — `companies.kind` already supports customer / shipper / consignee.

## Spreadsheet contents (read)

- Customers.xlsx: 139 companies (name, address, billing, contact, phone, email, payment terms, notes).
- Shipper.xlsx: 411 shippers (address, contact, phone, email, appointments, shipping hours, notes).
- Consignee.xlsx: 1,602 consignees (same, with receiving hours).

Import mapping: name, contact, phone (+ext), email, street address, city, state, ZIP go into the Directory fields; shipping/receiving hours, appointment info and notes go into each company's notes. Matching is by name + city so two different locations of the same company stay separate. This is a one-time import done directly, followed by a counts summary.
