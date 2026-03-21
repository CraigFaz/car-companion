# Car Companion — Claude Code Instructions

## Version Badge — ALWAYS UPDATE

**Every commit that changes user-facing behaviour must bump the version in `src/App.tsx`.**

- The version constant lives in the `CHANGELOG` array at the top of `src/App.tsx`
- Add a new entry at the top of the array with the new version, today's date, and bullet points describing what changed
- The badge in the header reads from `CHANGELOG[0].version` — so the newest entry must always be first
- Versioning scheme: v1.0, v1.1, v1.2, … (minor bump per session/PR, no patch versions needed)
- Changelog entry format: Added / Changed / Fixed items as plain English bullets

**Never commit UI or logic changes without a version bump. No exceptions.**

---

## Dev Branch

All work goes on `claude/next-steps-q1X53`. Push to that branch. Never push directly to `main`.

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | App shell, nav, changelog modal, **version constant** |
| `src/types.ts` | All TypeScript interfaces — keep in sync with Supabase schema |
| `src/pages/FuelLog.tsx` | Fuel log + add form (any-two-of-three math) |
| `src/pages/Dashboard.tsx` | Stats cards, recent fillups, open issues |
| `src/pages/Maintenance.tsx` | Repair/service records |
| `src/pages/Issues.tsx` | Issues & noises tracker |
| `src/lib/supabase.ts` | Supabase client (reads from env vars) |
| `docs/craig-fusion-data-v3.json` | Craig's historical data — 16 fillups, 3 repairs, 5 issues |
| `docs/car-companion-handoff.docx` | Full design spec from prototype handoff |

## What's Been Built (as of v1.1)

- React + Vite + TypeScript + Tailwind + Recharts + Supabase
- Dashboard: stats cards, L/100km chart, recent fillups, open issues
- Fuel log: list, chart, add form with any-two-of-three math, grade field, flagged entries
- Maintenance: flat records (needs rebuild as line items — see roadmap)
- Issues: severity colour coding, open/resolved status

## Roadmap (next priorities)

1. **Import Craig's data** — `docs/craig-fusion-data-v3.json` into Supabase (one-time script)
2. **Rebuild Repairs tab** — `repair_entries` + `repair_items` with interval tracking (P2)
3. **Maintenance alerts** on Dashboard from line item intervals (P2)

See `docs/car-companion-handoff.docx` for full spec, schema, UI conventions, and lessons learned.
