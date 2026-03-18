import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import type { Vehicle } from './types'
import Dashboard from './pages/Dashboard'
import FuelLog from './pages/FuelLog'
import Maintenance from './pages/Maintenance'
import Issues from './pages/Issues'

type Tab = 'dashboard' | 'fuel' | 'maintenance' | 'issues'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'issues', label: 'Issues' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)

  useEffect(() => {
    supabase.from('vehicles').select('*').single().then(({ data }) => {
      if (data) setVehicle(data)
    })
  }, [])

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100svh', color: 'var(--text)' }}>
      <header style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1.5rem', height: 54 }}>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: '1.15rem', color: 'var(--amber)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            CAR COMPANION
          </span>
          <nav style={{ display: 'flex', gap: 2 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: tab === t.id ? 'var(--bg4)' : 'transparent',
                  color: tab === t.id ? 'var(--text)' : 'var(--sub)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 13px',
                  cursor: 'pointer',
                  fontFamily: 'Barlow, sans-serif',
                  fontSize: '0.875rem',
                  fontWeight: tab === t.id ? 600 : 400,
                  transition: 'all 0.12s',
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {vehicle && (
            <span style={{ marginLeft: 'auto', color: 'var(--sub)', fontSize: '0.78rem', fontFamily: 'DM Mono, monospace' }}>
              {vehicle.name} · {vehicle.odometer_km.toLocaleString()} km
            </span>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem' }}>
        {!vehicle && (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--sub)' }}>Loading...</div>
        )}
        {vehicle && tab === 'dashboard'   && <Dashboard vehicle={vehicle} />}
        {vehicle && tab === 'fuel'        && <FuelLog vehicleId={vehicle.id} />}
        {vehicle && tab === 'maintenance' && <Maintenance vehicleId={vehicle.id} />}
        {vehicle && tab === 'issues'      && <Issues vehicleId={vehicle.id} />}
      </main>
    </div>
  )
}
