# Fix header crowding and brand overlap

The top bar packs the Clearwater Cargo brand, 9 nav links, Connect Gmail, an email picker, the role badge, and the signed-in email into one fixed-height row. At normal screen widths it overflows: the brand text spills below the bar and the nav overlaps it.

## Changes (src/components/AppShell.tsx only)

1. **Brand block** — lock it to a fixed footprint (`shrink-0`, `whitespace-nowrap`) so "Clearwater Cargo / Staley, NC · TMS" can never wrap or spill outside the bar.
2. **Nav links** — let the nav take the remaining space and scroll horizontally if needed (`flex-1 min-w-0 overflow-x-auto`), with `whitespace-nowrap` on each link, so items never overlap the brand or the right-side controls.
3. **Right side** — hide the signed-in email address on narrower screens (show from xl up), keep Connect Gmail, the email picker, role badge, and sign-out always visible and `shrink-0`.
4. Slightly tighter gaps so everything breathes at 1280px and up.

## Verify

- Re-capture the header at 1280px and a narrow width in the preview: no overlap, no clipped brand text, all controls reachable.
- Type-check and build clean.
