# Make Clearwater Cargo TMS work well on phones and tablets

## Goal

Create a dedicated responsive interface while preserving the current desktop workflow and all existing permissions, data, and features.

## Navigation

- Replace the crowded desktop header on phones with a compact Clearwater Cargo bar and a fixed bottom navigation.
- Put the most-used areas in the bottom bar: **Dispatch**, **Carriers**, **Directory**, and **More**.
- Open **More** as a mobile menu containing Fleet, Leads, Quotes, Reports, QuickBooks, Admin, Gmail, role/account details, and sign out, filtered by the user's existing permissions.
- Keep the current desktop header at desktop widths; use a tablet-friendly condensed version between phone and desktop.
- Move the chat launcher above the bottom bar and make its conversation window fit the available phone screen.

## Dispatch board

- On phones, show the load queue first. Tapping a load opens a full-width details screen with a clear Back button; do not squeeze the queue and cockpit side by side.
- On tablets, use the split queue/details layout only when it fits comfortably; otherwise use the same list-to-details flow.
- Make alerts, search, filters, Export, and New Load wrap into stable rows with touch-sized controls.
- Make load cards, status controls, cockpit heading, action buttons, and Load/Carrier/Money/Docs tabs fit without horizontal clipping.
- Preserve the existing tab organization and every dispatch action.

## Forms, lists, and detail screens

- Make the load builder and other dialogs full-screen or near-full-screen on phones, with single-column fields and actions that remain reachable above the bottom edge.
- Convert fixed two- and three-column forms to one column on phones and appropriate two-column layouts on tablets.
- Apply the same list-to-details pattern to Carriers and Directory: list first, selected record second, with Back navigation on phones.
- Make wide Reports, QuickBooks, Fleet, Leads, Quotes, and Admin content responsive using compact summary cards or deliberate horizontal table scrolling where tabular comparison must remain intact.
- Remove fixed widths that overflow on phones while preserving dense desktop layouts.

## Accessibility and usability

- Use at least 44px touch targets for primary mobile controls.
- Respect device safe areas so the bottom navigation and actions are not covered by phone UI.
- Keep focus states, keyboard use, labels, status colors, and role-based visibility unchanged.
- Do not change business rules, database policies, calculations, email behavior, or integrations.

## Verification

- Test the authenticated app at representative phone, tablet, and desktop sizes.
- Check navigation, dispatch list-to-details, load creation, carrier details, dialogs, chat, tables, and sign out.
- Confirm there is no unintended page-level horizontal scrolling, clipped text, overlapping controls, or content hidden behind the bottom bar.
- Confirm all content pages retain unique Clearwater Cargo page metadata and the app builds cleanly.

## Technical details

- Centralize responsive shell behavior in `AppShell` and reuse the existing permission-filtered navigation data.
- Use the existing mobile-width hook plus responsive Tailwind utilities; keep desktop rendering unchanged above the chosen breakpoint.
- Track mobile list/detail state locally in Dispatch, Carriers, and Directory; selecting a row opens details and Back returns to the preserved list/filter state.
- Update shared dialogs and targeted page layouts rather than adding a separate mobile application or duplicating business logic.
