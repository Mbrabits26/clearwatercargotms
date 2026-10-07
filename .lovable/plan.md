# Declutter the Dispatch Board

The cockpit (right side) has grown to 10+ stacked panels — too much scrolling. Cleanup:

## Layout changes

1. **Tabbed cockpit** — group the right-side panels into tabs so only one group shows at a time:
   - **Load** — freight specs, facility instructions, status, check calls
   - **Carrier** — carrier assignment, compliance checklist, offers, fleet assignment
   - **Money** — financials, rate view & pricing, QuickPay/advance
   - **Docs** — rate con, driver tracking, team notes
2. **Collapsible left queue** — the filter bar collapses to a single row; alert strip only shows when there are alerts.
3. **Header trim** — merge the email-client dropdown into the Gmail button area; keep the role badge and sign-out only.

## What stays the same

- No features removed — every panel still exists, just organized into tabs.
- Left queue, statuses, colors, and all data unchanged.

## Technical details

- `src/routes/_authenticated/dispatch.tsx`: wrap cockpit panels in a `Tabs` component (shadcn, already in project); persist the active tab in component state.
- Queue filters get a show/hide toggle; alerts render conditionally.
- No database or server changes.
