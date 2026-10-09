# Clearwater Cargo Flow

Build a complete, fully featured freight broker and asset TMS web app for Clearwater Cargo, LLC (Staley, NC) incorporating the provided brand logo.

Core features & architecture:
1. Branding & Navigation:
   - Use the provided Clearwater Cargo owl logo in the app header, login screen, Rate Confirmations, and spot quote PDFs.
   - Clean professional freight operations UI with company branding (black, deep teal, gold/amber accents).

2. Role-Based Access Control & User Roles:
   - Admin Login: Complete visibility over the brokerage floor, all brokers' loads and accounts, company-wide financials, QuickBooks sync management, broker commission rates/payouts, and system settings.
   - Broker Logins: Shared access to company directories (customers, shippers, consignees, vetted carriers), personal sales CRM leads, and assigned loads. Broker pay privacy: brokers cannot see other brokers' pay rates, margins, or commission earnings.

3. Sales & Leads CRM Pipeline:
   - Broker lead tracker (New Lead, Pitching, Quoting Lanes, Won / Active Customer) with call/meeting logs and target lane records.
   - Branded Spot Quote Generator: Generate formal quote PDFs with 24-hour expiration timers and one-click "Accept Quote" conversion into an active load.
   - Direct promotion of won leads into active billing customers.

4. Google Places Auto-Populate:
   - Integrated into Add Customer, Add Shipper, and Add Consignee modals: typing name or address auto-fills business name, street address, city, state, zip code, phone number, and location coordinates.

5. FMCSA / SAFER Carrier Vetting & Onboarding:
   - Lookup by MC# or DOT# pulling carrier legal name, DBA, address, operating authority status (Authorized vs Inactive/Revoked), safety rating, and active insurance requirements.
   - Compliance gating that prevents booking unauthorized or uninsured carriers.
   - Carrier "Do Not Use" (DNU) list with required reason codes (double-brokering, hostage load, late cancel) that immediately locks assignment across all brokers.
   - External onboarding portal sync: generate onboarding link for carriers to submit W-9, COI, and broker agreement, auto-updating carrier profile to Vetted upon completion.

6. Split Dispatch Board & Interactive Controls:
   - Left side: Active load queue with searchable filters (status, broker, lane, dates).
   - Right side: Detailed load cockpit with freight specifications, facility instructions, compliance checklist, rate con generator, and financials.
   - Color-coded quick-change status dropdowns: Available, Vetting, Booked, Dispatched, Loaded/Rolling, Delivered, Invoiced, Completed/Paid, and Delay/Issue.
   - Proactive Reminders & Alerts: In-transit check call timers, upcoming carrier payment due dates, and overdue customer invoices.

7. Load Builder & Lane Intelligence:
   - Comprehensive freight entry: equipment type (Dry Van, Reefer, Flatbed, etc.), commodity, weight, piece count, temperature, appointment times, facility notes, and line-item accessorials (detention, layover, TONU, lumper).
   - Historical Lane Rate Intelligence: In-app card displaying 30/90-day Clearwater averages (shipper rate, carrier pay, margin %) on the active lane.

8. Load Board CSV Export:
   - One-click bulk export for active available loads formatted to DAT One and Truckstop CSV upload specifications.

9. Asset-Based Fleet Management:
   - Dedicated Internal Fleet tab tracking Clearwater Cargo's own trucks, trailers, and drivers.
   - Assign internal trucks to Clearwater brokerage loads or log loads hauled for third-party outside brokerages (tracking outside broker MC#, external rate con, and billing).

10. Rate Confirmations & Factoring:
    - Automated branded PDF Rate Con generation, digital signing links, and document attachment.
    - Factoring Company / Notice of Assignment (NOA) management routing carrier pay-to info accurately.
    - QuickPay (e.g. 3-5% fee) & Fuel Advance calculation engine automatically deducting fees from carrier AP and logging finance revenue.

11. QuickBooks Online Pipeline:
    - Sync status and triggers for Accounts Receivable (customer invoices upon delivery) and Accounts Payable (carrier bills upon signed POD receipt, routed to factoring if applicable).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://clearwatercargotms.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/748bc66f-22db-4198-bf35-66ebdd814c72).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
