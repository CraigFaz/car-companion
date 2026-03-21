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

Push directly to `main`. No PRs, no feature branches — changes deploy to production immediately via Vercel.

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

## What's Been Built (as of v1.3)

- React + Vite + TypeScript + Tailwind + Recharts + Supabase
- Dashboard: stats cards, L/100km chart, recent fillups, open issues
- Fuel log: list, chart, add form with any-two-of-three math, grade field, flagged entries
- Maintenance: repair visits with line items, type badges, warranty, service interval reminders
- Issues: severity colour coding, open/resolved status

## Roadmap (next priorities)

1. **Maintenance alerts** on Dashboard from repair_items interval tracking (P2)
2. **Oil top-up log** — `oil_topups` table + tab or section (P3)
3. **OCR receipt scanning** — Tesseract.js for fuel receipts (P3)

See `docs/car-companion-handoff.docx` for full spec, schema, UI conventions, and lessons learned.
