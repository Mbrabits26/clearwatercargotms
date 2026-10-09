# Carrier check report, packet clean-up, admin on/off and working passwords

## What the data shows today (21 carriers from the packet app)
- 6 carriers came over with **no documents** (eCapital for WFJ, INSTALTL, KAIRI, Powell, Radhoo, Test Carrier). Their files were either repeat uploads or links that didn't download.
- Several carriers have a **Factoring NOA file**, but the factoring company name is blank (only T Griffin has one). The NOA was saved as a document, but nothing was written into the Factoring / NOA section.
- Insurance limits and expiry dates from the packets were not copied, so most carriers show "Missing".

## 1. Finish the packet carriers (one-time fix)
- Re-pull the 6 carriers' missing documents from the packet app (it is still reachable) and copy them over.
- Fill the **Factoring / NOA section** from each packet: factoring company, remit-to address, NOA checked, and pay option set to Factoring or Factored Quick Pay.
- Fill auto liability and cargo limits plus expiry dates from the packet.
- Delete "Test Carrier LLC".
- After that, turn off the packet app's export password for good.

## 2. "Check carriers" button and report
- New **Check carriers** button on the Carriers tab, and the same report under **Reports → Carrier check**.
- One row per carrier with these problems flagged:
  - Inactive or not-Authorized authority, Do Not Use, conditional approval expired
  - Missing W-9, COI, agreement, NOA (when factoring), or voided check
  - Insurance missing, expired or expiring within 30 days
  - Missing MC #, DOT #, email or phone
  - A checkbox is ticked but there's no file behind it, or the reverse
- Filters, CSV export and print.
- **Fix with AI**, per carrier or for all selected carriers:
  1. The AI reads that carrier's uploaded documents (COI, W-9, NOA, agreement).
  2. It fills only the fields that are blank: insurance limits and dates, factoring company and remit-to, name, address, MC/DOT, and the checkboxes.
  3. Free sources (FMCSA/SAFER) fill authority and contact details.
  4. You see what will change before anything is saved. Hand-entered values are never overwritten.
  5. Anything that can't be fixed stays on the report as "Needs carrier": for example, no COI was ever uploaded. From there you can send the carrier an invite link to upload it.
- **Cost:** each AI fix reads documents and uses a small amount of AI credit. FMCSA checks are free.

## 3. Admin can turn admin on and off for any user
- On **Admin → Users**, each person gets an **Admin access** on/off switch with a confirmation.
- You can't turn off your own admin access, and there must always be at least one admin.
- When admin is off, the person goes back to Broker with their area permissions.

## 4. Passwords that actually work
- First, test a reset end to end: set a password for a user, then sign in with it on the login page. This finds the real cause before changing anything. The user list shows everyone is approved and confirmed, so the likely causes are Google-only accounts that never had a password, or the sign-in page not showing the error clearly.
- **Set password** dialog (replacing the browser pop-up), with type-twice confirmation and a show/hide option. After saving, it checks that the account can sign in with the new password.
- Users with a Google account get a password added, so they can sign in either way.
- Clear sign-in errors, plus a **Forgot password** link on the sign-in page.

## Technical details
- Packet fix: a one-off admin server function that re-fetches the export, matches rows by `carrier_signatures.external_ref`, and maps the payload's insurance, factoring and NOA fields into carriers using fill-blanks merge. Documents are copied to carrier-docs. The export secret is removed afterwards.
- Carrier check: `carrierIssues(carrier, docs)` in tms.ts, shared by the button and a Reports tab. `fixCarrierWithAi` (staff-only server function) reuses `readDocJson`/`extractCarrierPacket` on the stored files (signed URLs), merges with mergeFill, then runs `lookupCarrierFull` for DOT carriers. It works in preview-then-apply mode.
- Admin switch: a `setUserAdmin` server function in users.functions.ts. It verifies the caller with has_role, blocks self-demotion and removal of the last admin, and updates user_roles and approved_users together on the server. This replaces the current browser-side role edit in admin.tsx.
- Passwords: `resetUserPassword` also sets `email_confirm: true`, then verifies with a server-side `signInWithPassword` test using a non-persisting client. The auth page gets a `resetPasswordForEmail` flow plus a `/reset-password` page.
