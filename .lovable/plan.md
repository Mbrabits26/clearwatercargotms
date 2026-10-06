# Mentions, carrier load offers, lane history, rate tools and customer quotes

## Answers to your questions
- **Lane rates:** the app already shows 30-day and 90-day averages, but only from Clearwater's own past loads. Live market rates (DAT RateView, Truckstop) need a paid account with them; we'd connect it once you have API access. Until then, pricing comes from your own history.
- **Customer quoting:** this isn't built yet. It's added below.

## 1. @mentions in chat and notes
- Typing "@" shows a list of teammates. Picking one tags them.
- Tagged people get a pop-up, plus a badge on the chat bubble, even if the message wasn't sent to them directly.

## 2. Mass load offers to carriers
- On any Available load, click **Offer to carriers**.
- The app suggests carriers: first, those who have run that lane before; second, those matching the equipment and region. Only vetted carriers can be picked; Do Not Use carriers are excluded.
- Each carrier gets their own email with a private link. The page shows the lane, dates, equipment, weight and offered rate.
- The carrier can **Accept**, **Reject**, or **Counter** with a rate, and add a note.
- Responses appear live on the load in an "Offers" panel. One click books the winning carrier, and the existing compliance checks still apply.
- **Sending, with a "Send from" switch:**
  - **My email (default):** sends from the signed-in person's Google Workspace Gmail. The app opens one prefilled Gmail draft per carrier, each with that carrier's private link.
  - **Dispatch email:** sends automatically from dispatch@clearwatercargo.com. This turns on after a one-time email domain setup.

## 3. Carrier lane history
- Every delivered load is recorded on the carrier's profile, with lane, date, rate, rate per mile and equipment.
- A new **Lanes run** tab on each carrier shows how many times they've run each lane, their average rate, and when they last ran it.
- Carriers who accepted or countered offers are also logged, as "interested in lane".

## 4. Rate tool and pricing a load
- **Rate View** panel in the Load Builder and dispatch cockpit, for the origin to destination lane, with a matching radius in miles:
  - 30, 90 and 365-day averages for customer rate and carrier pay
  - all-in total and rate per mile (CPM)
  - low, average and high values, plus load count
  - margin, broken out by equipment type
- **Price this load:** enter a target margin and get a suggested customer price and target carrier pay.

## 4b. Public market rates (spot and contract)
- A **Market rates** button on the Rate View, quotes and RFPs looks up current public numbers for the lane and equipment. Sources include FreightWaves' free market articles and index snapshots, DAT's public trendlines, and Freightview's published rate reports.
- AI reads those pages and returns spot and contract rate per mile (national or regional), the date, and a link to each source. Results are cached for 24 hours.
- Market numbers appear next to Clearwater's own history, labeled "Public market estimate", so nobody mistakes them for live paid data like FreightWaves SONAR or DAT RateView.

## 5. Customer quotes (new Quotes tab)
- Build a quote for a new or existing customer: lane, equipment, miles, dates and accessorials.
- The Rate View history fills in a suggested CPM and all-in price, which you can edit.
- Quotes produce a branded PDF with the owl logo and 24-hour expiry, and can be emailed to the customer.
- Status: Draft, Sent, Won, Lost or Expired. **Won** turns the quote into a load. Lost quotes keep a reason.
- Quote history per customer and lane feeds future pricing.
- **RFP mode:** upload a customer's lane spreadsheet. Each lane gets a suggested contract rate from our history plus the public market rates. You can edit any rate, then export a filled-in spreadsheet to return to the customer.

## Technical details
- Mentions: a `chat_mentions` table, filled when messages or notes are saved (user_id, source, read flag). RLS: users see only their own mentions.
- Offers: `load_offers` (load_id, carrier_id, token, offered_rate, status sent/accepted/rejected/countered, counter_rate, note, responded_at) with staff RLS. The public `/offer/$token` page uses token-validated server functions, following the same pattern as onboarding.
- Mass email: Lovable's built-in email sending, which needs domain verification. Gmail BCC is the fallback.
- Lane history: a `carrier_lane_history` view built from loads (carrier, origin and destination city/state, equipment, count, average rate, last run), plus offer responses.
- Rate tool: a shared helper in tms.ts that runs over the loads visible to the user. Brokers only see their own loads' margins, so the privacy rules hold.
- Market rates: a staff-only server function uses a web search/scrape connector (Firecrawl or Perplexity, connected when we build) to search public pages. Lovable AI pulls the figures into strict JSON (spot_cpm, contract_cpm, scope, as_of, source_url), and results are cached in a `market_rate_cache` table.
- Send-from preference: a per-user setting (mine/dispatch), with mine as the default.
- Quotes: a `quotes` table with staff RLS; brokers see only their own. A jsPDF quote layout reuses the rate con branding. Converting a quote creates a load through the existing builder.
