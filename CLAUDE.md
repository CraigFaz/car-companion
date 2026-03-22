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

## What's Been Built (as of v2.2)

- React + Vite + TypeScript + Tailwind + Recharts + Supabase
- Dashboard: stats cards, L/100km chart, recent fillups, open issues, service due alerts
- Fuel log: list, chart, add form with any-two-of-three math, grade field, flagged entries
- Maintenance: repair visits with line items, type badges, warranty, service interval reminders
- Issues: severity colour coding, open/resolved status
- Oil top-ups: dedicated tab, date/amount/brand/odometer tracking
- Scan tab: single-receipt + odometer photo scan via Claude vision (either photo first)
- Batch tab: multi-photo historical import with EXIF pairing, queue processing, flagging, review

## Roadmap (completed)

- [x] **Maintenance alerts** on Dashboard from repair_items interval tracking
- [x] **Oil top-up log** — `oil_topups` table + Oil tab
- [x] **OCR receipt scanning** — Claude vision via Supabase edge function (replaced Tesseract.js)

## Roadmap (next priorities)

1. **Batch scan persistence** — save review queue to Supabase so it survives a page refresh (P2)
2. **Insurance / registration** — new doc types in the scan pipeline (P3)
3. **Export** — CSV download of fuel entries and maintenance records (P3)

See `docs/car-companion-handoff.docx` for full spec, schema, UI conventions, and lessons learned.
