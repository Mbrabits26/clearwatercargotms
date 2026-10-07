# Carrier lookup fills every field + duplicate merging

## What changes for you

**1. Lookups fill in more details**
When you click Look up FMCSA (adding a carrier) or Re-check FMCSA (existing carrier), the app also reads FMCSA's free public company registration file. That file has details the current lookup doesn't, including:
- Email address
- Main contact (company officer name)
- Phone, cell phone and fax
- Mailing address, plus the physical address
- Number of trucks and drivers

It still costs nothing and uses no AI credits. Results stay cached for 24 hours.

**2. Add carrier form shows every field**
The form gets fields for street address, ZIP, contact name, and cargo insurance expiry. The lookup fills all of them in, and you can still edit before saving.

**3. Re-check fills gaps without overwriting your work**
Authority status and safety rating always refresh. Every other field (phone, email, contact, address) is filled only if it's blank, so anything you typed by hand stays.

**4. Duplicates get merged instead of doubled**
A carrier counts as a duplicate when it has the same DOT #, the same MC #, or the same legal name (ignoring capitals, punctuation, and endings like "LLC" or "Inc").
- **Add carrier:** if the carrier already exists, the app tells you and opens the existing record. Any new details are added to it, and no second copy is created.
- **Bulk import:** matched rows fill in the blank fields on the existing carrier instead of being skipped. When the import finishes it shows how many were added, merged, or unchanged.
- **One-time cleanup:** a "Find duplicates" button in Carriers lists carriers that look like the same company and lets you merge each group. Merging keeps one record, combines the details, and moves that carrier's loads, documents, offers and invites onto the record you keep. Do Not Use and vetted status are never lost in a merge.

## Technical details

- New `fetchCensus(dot)` in `fmcsa.server.ts`: queries the public data.transportation.gov FMCSA Company Census dataset (Socrata JSON, no key) by DOT. It returns email, officer name, phone, cell, fax, mailing and physical address, and power units. It runs alongside the QC/SAFER lookup, and the results are merged into `FmcsaCarrier` (new fields: email, contact_name, cell_phone, fax, mailing_address). Cache key stays the same, so old cache entries are bypassed through a version suffix.
- `src/lib/carrierMerge.ts`: `normalizeName`, `findMatch(carriers, row)`, and `mergeFill(existing, incoming)`, which fills only blank fields and never downgrades status or DNU.
- AddCarrier: checks for a match before inserting; if one is found, it updates that record with the filled-in fields and opens it.
- BulkImportDialog (carrier mode): matches on DOT/MC/name and updates blank fields on existing carriers instead of skipping them.
- Duplicate merge: a staff-only server function that repoints `loads`, `carrier_documents`, `load_offers` and `carrier_invites` to the kept carrier, then deletes the duplicate. Its status combines as DNU over vetted over pending. The compliance trigger is unaffected because DNU or vetted status carries over.
- No schema changes needed. Existing carrier columns cover this, and the extra contact info is stored in existing fields (the cell phone goes in phone when phone is blank).
