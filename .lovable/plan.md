# Lower your TMS costs — staying on Lovable is the cheap option

## What your credits are actually going to (last 13 days, measured)

| Where | Credits | Share |
| --- | --- | --- |
| Building the TMS (our work sessions) | ~252 | 98% |
| Running the app (database, functions, storage, network) | ~1.7 | <1% |
| AI features (document reading, carrier fix) | ~2.6 | ~1% |
| **Total** | **~257** | |

**The finding:** your running TMS costs almost nothing — under 2 credits in two weeks for the database, storage, and hosting combined. The AI features add about 2.6. **98% of your spend is building new features**, not running the app.

## Why moving to Bolt (or anywhere) costs more, not less

- You'd pay to rebuild the entire TMS from scratch — the equivalent of the ~252 build credits already spent, plus migration risk.
- Your safety rules (DNU blocking, unauthorized-carrier checks), 888 loads, 4,854 companies, documents, and signature records would all need to be exported and rebuilt.
- Bolt's running costs for a database-backed app are in the same ballpark — you would not save the ~1.7 credits of runtime; you'd just pay the build cost twice.

## The plan: spend less without moving

1. **Batch your requests.** Build-mode cost is per task. Sending one message with three related fixes costs less than three separate sessions. I'll also keep grouping related work into single passes.
2. **Use plan mode only for big features.** Each plan-mode message costs 1 credit. For small tweaks ("move this button"), skip the plan and just tell me directly — I'll build it straight away.
3. **Keep AI features as-is but use them deliberately.** Document reading and Fix-with-AI are ~1 credit per few uses — cheap, but only run them when needed.
4. **Nothing to cut in the running app.** Database (~0.95 credits/2 weeks on the smallest instance), storage, and network are already near zero. No resize or cleanup would meaningfully change this.
5. **If the monthly credit total itself is the issue**, check Settings → Plans & credits for your plan's credit allowance and top-up options — that's a billing choice, not a platform problem.

## What I will NOT do

- No migration, no rebuild, no export to another platform — it would multiply your costs, not reduce them.

## Technical details

- Evidence: project credit ledger, 2026-09-26 → 2026-10-09, 14 recorded groups, no missing deduction rows. Build = 252.49 credits (build_mode 195.5 + plan_mode 55.9 + chat 1.09); runtime = database 0.95 + functions 0.71 + network/storage/realtime ~0.01; AI gateway = 2.64.
- Cloud compute is on the pico instance (~0.077 credits/instance-hour quoted); recorded usage shows 12.33 instance-hours in the window.
- Cash paid is not visible from this data; figures are recorded credit deductions.
