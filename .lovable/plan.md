# FMCSA fix, Sales Leads tab, and Gmail sending

## 1. FMCSA lookup (free sources only)
FMCSA's data service is sending back "403 Forbidden" pages. That's how FMCSA blocks some cloud servers. It doesn't look like a problem with your key.
- **Clearer errors.** The lookup says whether FMCSA blocked it, couldn't find the carrier, or rejected the key.
- **Free backup.** If the main service is blocked, the app reads FMCSA's free public SAFER Company Snapshot directly. It fills in name, DBA, DOT # and MC #, address, phone, operating status, out-of-service date, power units, drivers and safety rating.
- **Saved results.** Each result is kept for 24 hours, so checking the same carrier again that day doesn't make a new request.
- **"Open in SAFER" button.** Opens the carrier's SAFER page, already searched, if both sources are blocked.
- **No paid searches.** It never uses paid search or AI credits.
- **Source label.** Each result shows where it came from and runs the same compliance warnings as today.
- **Testing.** Our test environment is blocked by FMCSA, so I'll check it on the live app after you publish.

## 2. Sales Leads tab
A new "Leads" tab for prospective customers.
- **Lead details.**
  - Company name, contact, phone and email
  - City and state, plus lanes or freight they ship
  - Lead source, the assigned salesperson, and an estimated monthly load count
- **Stages.** New, Contacted, Quoting, Negotiating, Won and Lost (with a reason).
- **Contact log.** Record each time you talk to them: date and time, method (call, email, visit, text), notes, and an optional next follow-up date.
- **Follow-up list.** A "Follow-ups due" list at the top shows leads due today or overdue.
- **One click from a lead.** Create a quote for the lead, or mark it Won to add it to the Directory as a customer.
- **Privacy.** Salespeople see only their own leads. Admins see all of them.
- **Access.** A new "Leads" permission checkbox in Users & permissions.

## 3. Sending email straight from your Gmail
Today the email buttons open a Gmail draft in a new tab, and you click Send. To send directly from inside the app, each person connects their own Google Workspace account one time:
- A **"Connect Gmail"** button in the top bar. You sign in with Google and allow sending.
- After that, carrier invites, rate cons, load offers and quotes **send right away from your own address**. A copy lands in your Gmail Sent folder.
- If someone hasn't connected, the buttons fall back to today's Gmail draft.

**One-time setup you'll need to do (about 10 minutes):** create a free Google sign-in app in your Google Workspace's Google Cloud console. I'll walk you through it step by step when we get there. With it set to "Internal" for your Workspace, no Google review is needed.

## Technical details
- FMCSA: in `fmcsa.functions.ts`, tell an HTML 403 apart from an auth error. Fall back to a plain fetch of `safer.fmcsa.dot.gov/query.asp`, parsed by regex in `fmcsa.server.ts`. Cache with the key `fmcsa:<id>` in `market_rate_cache` for 24h. Add `source` and a SAFER link to `FmcsaSummary`. No Firecrawl.
- Leads: new tables `leads` and `lead_activities`, scoped by owner-or-admin RLS with grants. New route `/_authenticated/leads` and a `leads` key in PERMISSIONS. Converting a lead inserts a `companies` customer row and links the quote prefill.
- Gmail: a google_mail App User Connector (each user's own OAuth). Encrypted per-user connection keys go in `app_user_connections`. A `sendGmail` server fn calls `messages/send`, and `composeEmail` uses it when the user is connected, otherwise it falls back to the compose URL.
