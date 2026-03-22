import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import type { Vehicle, ScanPrefill } from './types'
import Dashboard from './pages/Dashboard'
import FuelLog from './pages/FuelLog'
import Maintenance from './pages/Maintenance'
import Issues from './pages/Issues'
import OilTopups from './pages/OilTopups'
import ScanReceipt from './pages/ScanReceipt'
import BatchScan from './pages/BatchScan'

type Tab = 'dashboard' | 'fuel' | 'maintenance' | 'issues' | 'oil' | 'scan' | 'batch'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard',   label: 'Dashboard',   icon: '⊞' },
  { id: 'fuel',        label: 'Fuel',         icon: '⛽' },
  { id: 'maintenance', label: 'Maintenance',  icon: '🔧' },
  { id: 'issues',      label: 'Issues',       icon: '⚠' },
  { id: 'oil',         label: 'Oil',          icon: '🛢' },
  { id: 'scan',        label: 'Scan',         icon: '📷' },
  { id: 'batch',       label: 'Batch',        icon: '📦' },
]

const CHANGELOG = [
  {
    version: 'v2.2',
    date: '2026-03-22',
    notes: [
      'New Batch tab: drop any number of fuel-up photos at once for historical import',
      'EXIF date metadata auto-pairs receipt + odometer photos taken the same day — upload order does not matter',
      'Queue processor: max 2 concurrent Claude vision scans, failed scans retry once automatically',
      'Auto-classification: single API call per image — Claude identifies receipt, odometer, or unrecognized photo',
      'Flags questionable pairs: unpaired photo, missing fields, low confidence, math mismatch, duplicate date, unrecognized image',
      'Review section: editable fields per pair before saving, approve or skip individually',
      'Batch save writes all approved pairs to fuel_entries with ocr_raw and ocr_meta stored',
    ],
  },
  {
    version: 'v2.1',
    date: '2026-03-21',
    notes: [
      'Scan tab: either receipt or odometer photo can now be uploaded first — no forced order',
      'Both upload zones are active from the start; uploading either one opens the full scan layout',
      'Receipt card in expanded view shows an upload zone when receipt hasn\'t been added yet, mirroring the odometer panel',
    ],
  },
  {
    version: 'v2.0',
    date: '2026-03-21',
    notes: [
      'Scan tab: two-photo session — upload receipt first, then optionally add an odometer photo',
      'Odometer photo scanned separately with a dedicated prompt, km value merged into the combined result',
      'Odometer hint shown in fields panel when km is missing from receipt, prompting user to add photo',
      'Receipt and odometer images shown side by side; "Use These Values" sends the combined data to the fuel form',
      '"Replace photo" link on odometer panel to re-scan if needed',
    ],
  },
  {
    version: 'v1.9',
    date: '2026-03-21',
    notes: [
      'New Scan tab: upload a receipt photo and Claude AI extracts date, station, grade, litres, price/L, total, and odometer',
      'Results shown side-by-side with the receipt image — each field colour-coded with confidence indicator',
      '"Use These Values" pre-fills the fuel log form and switches to the Fuel tab automatically',
      'Replaced Tesseract.js OCR (client-side, poor accuracy) with Claude Opus via Supabase edge function',
      'Receipt is auto-resized to JPEG before sending — handles all image formats including HEIC on supported browsers',
    ],
  },
  {
    version: 'v1.5',
    date: '2026-03-21',
    notes: [
      'New Oil tab: log engine oil top-ups with date, amount (L), odometer, and brand',
      'Shows total litres added across all top-ups',
    ],
  },
  {
    version: 'v1.4',
    date: '2026-03-21',
    notes: [
      'Dashboard: Service Due alerts card — shows overdue and upcoming maintenance based on repair item intervals',
      'Oil Change flagged as due soon (389 km remaining)',
      'Alert card border colour reflects urgency (amber = soon, red = overdue)',
    ],
  },
  {
    version: 'v1.3',
    date: '2026-03-21',
    notes: [
      'Maintenance tab rebuilt: repair visits now show individual line items (type, parts, warranty, service intervals)',
      'Add Visit form supports multiple line items per shop visit',
      'Service interval badges shown on scheduled maintenance items (↻ Oil Change, Cabin Air Filter, Spark Plugs, etc.)',
      'Dashboard maintenance stat now sourced from repair_entries',
    ],
  },
  {
    version: 'v1.2',
    date: '2026-03-21',
    notes: [
      'Fixed: page content no longer hidden behind bottom navigation bar',
    ],
  },
  {
    version: 'v1.1',
    date: '2026-03-21',
    notes: [
      'Fuel form: any-two-of-three math — enter litres + price/L, or litres + total, or price/L + total; third auto-calculates',
      'Calculated field highlighted with blue border so you know which value was derived',
      'Fuel grade dropdown: Regular 87 / Plus 89 / Premium 91 / Premium 93',
      'Flagged entries: L/100km outside 8–20 shown in yellow with warning icon — not hidden',
    ],
  },
  {
    version: 'v1.0',
    date: '2026-03-18',
    notes: [
      'Initial release',
      'Dashboard with vehicle stats, open issues, recent fillups',
      'Fuel log with L/100km chart and add fillup form',
      'Maintenance records with category badges and add form',
      'Issues tracker with severity colour coding',
      'All historical data imported from previous app',
    ],
  },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)
  const [scanPrefill, setScanPrefill] = useState<ScanPrefill | null>(null)

  function handleUseScan(prefill: ScanPrefill) {
    setScanPrefill(prefill)
    setTab('fuel')
  }

  useEffect(() => {
    supabase.from('vehicles').select('*').single().then(({ data }) => {
      if (data) setVehicle(data)
    })
  }, [])

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100svh', color: 'var(--text)' }}>
      {/* Header */}
      <header style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 1rem', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem', height: 54 }}>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: '1.15rem', color: 'var(--amber)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            CAR COMPANION
          </span>

          {/* Version badge */}
          <button
            onClick={() => setShowChangelog(true)}
            style={{ background: 'var(--bg4)', color: 'var(--sub)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 8px', fontSize: '0.7rem', fontFamily: 'DM Mono, monospace', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {CHANGELOG[0].version}
          </button>

          {/* Desktop nav */}
          <nav className="desktop-nav" style={{ gap: 2 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: tab === t.id ? 'var(--bg4)' : 'transparent',
                color: tab === t.id ? 'var(--text)' : 'var(--sub)',
                border: 'none', borderRadius: 6, padding: '5px 13px',
                cursor: 'pointer', fontFamily: 'Barlow, sans-serif',
                fontSize: '0.875rem', fontWeight: tab === t.id ? 600 : 400,
              }}>
                {t.label}
              </button>
            ))}
          </nav>

          {vehicle && (
            <span style={{ marginLeft: 'auto', color: 'var(--sub)', fontSize: '0.75rem', fontFamily: 'DM Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {vehicle.name} · {vehicle.odometer_km.toLocaleString()} km
            </span>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="main-content" style={{ maxWidth: 1100, margin: '0 auto', padding: '1rem 1rem calc(1rem + 60px + env(safe-area-inset-bottom))' }}>
        {!vehicle && <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--sub)' }}>Loading…</div>}
        {vehicle && tab === 'dashboard'   && <Dashboard vehicle={vehicle} />}
        {vehicle && tab === 'fuel'        && <FuelLog vehicleId={vehicle.id} prefill={scanPrefill} onClearPrefill={() => setScanPrefill(null)} />}
        {vehicle && tab === 'maintenance' && <Maintenance vehicleId={vehicle.id} />}
        {vehicle && tab === 'issues'      && <Issues vehicleId={vehicle.id} />}
        {vehicle && tab === 'oil'         && <OilTopups vehicleId={vehicle.id} />}
        {vehicle && tab === 'scan'        && <ScanReceipt onUseScan={handleUseScan} />}
        {vehicle && tab === 'batch'       && <BatchScan vehicleId={vehicle.id} onSaved={() => setTab('fuel')} />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--bg2)', borderTop: '1px solid var(--border)',
        zIndex: 10, justifyContent: 'space-around', padding: '6px 0 max(6px, env(safe-area-inset-bottom))',
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: tab === t.id ? 'var(--amber)' : 'var(--sub)',
            padding: '4px 0',
          }}>
            <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: '0.65rem', fontFamily: 'Barlow, sans-serif', fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Changelog modal */}
      {showChangelog && (
        <div
          onClick={() => setShowChangelog(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.05em' }}>Changelog</span>
              <button onClick={() => setShowChangelog(false)} style={{ background: 'none', border: 'none', color: 'var(--sub)', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
            </div>
            {CHANGELOG.map(entry => (
              <div key={entry.version} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ background: 'var(--amber)', color: '#000', borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{entry.version}</span>
                  <span style={{ color: 'var(--sub)', fontSize: '0.78rem' }}>{entry.date}</span>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {entry.notes.map((note, i) => (
                    <li key={i} style={{ fontSize: '0.875rem', color: 'var(--text)', display: 'flex', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--sub)' }}>·</span> {note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
