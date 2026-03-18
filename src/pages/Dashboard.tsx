import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Vehicle, FuelEntry, MaintenanceRecord, Issue } from '../types'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function computeL100Map(entries: FuelEntry[]): Map<string, number | null> {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.odometer_km - b.odometer_km)
  const map = new Map<string, number | null>()
  sorted.forEach((e, i) => {
    if (i === 0) { map.set(e.id, null); return }
    const dist = e.odometer_km - sorted[i - 1].odometer_km
    map.set(e.id, dist > 0 ? (e.liters / dist) * 100 : null)
  })
  return map
}

const SEVERITY_DOT: Record<string, string> = {
  Urgent: 'var(--red)',
  Concerning: 'var(--amber)',
  Monitoring: 'var(--blue)',
}

interface Props { vehicle: Vehicle }

export default function Dashboard({ vehicle }: Props) {
  const [fuel, setFuel] = useState<FuelEntry[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([])
  const [issues, setIssues] = useState<Issue[]>([])

  useEffect(() => {
    supabase.from('fuel_entries').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).then(({ data }) => { if (data) setFuel(data) })
    supabase.from('maintenance_records').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).then(({ data }) => { if (data) setMaintenance(data) })
    supabase.from('issues').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).then(({ data }) => { if (data) setIssues(data) })
  }, [vehicle.id])

  const l100Map = computeL100Map(fuel)
  const validL100 = [...l100Map.values()].filter((v): v is number => v !== null && v > 6 && v < 20)
  const avgL100 = validL100.length ? validL100.reduce((a, b) => a + b, 0) / validL100.length : null

  const totalFuel = fuel.reduce((s, e) => s + (e.total_cost || 0), 0)
  const totalMaint = maintenance.reduce((s, r) => s + (r.cost || 0), 0)
  const lastFill = fuel[0]
  const openIssues = issues.filter(i => i.status === 'Open')

  const statCards = [
    { label: 'Fuel Spent', value: '$' + totalFuel.toFixed(2), sub: `${fuel.length} fillups` },
    { label: 'Avg L/100km', value: avgL100 ? avgL100.toFixed(1) : '—', sub: 'valid fills only' },
    { label: 'Last Fillup', value: lastFill ? fmtDate(lastFill.date) : '—', sub: lastFill?.station || '' },
    { label: 'Maintenance', value: '$' + totalMaint.toFixed(2), sub: `${maintenance.length} records` },
  ]

  const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Vehicle card */}
      <div style={{ ...card, display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: '1.75rem', letterSpacing: '0.02em' }}>
            {vehicle.name}
          </div>
          <div style={{ color: 'var(--sub)', fontSize: '0.85rem', marginTop: 2 }}>
            {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.trim}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {([['Odometer', vehicle.odometer_km.toLocaleString() + ' km'], ['Plate', vehicle.plate || '—'], ['VIN', vehicle.vin || '—']] as [string,string][]).map(([label, val]) => (
            <div key={label}>
              <div style={{ color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.82rem', marginTop: 3 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        {statCards.map(s => (
          <div key={s.label} style={card}>
            <div style={{ color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', margin: '4px 0 2px' }}>{s.value}</div>
            <div style={{ color: 'var(--sub)', fontSize: '0.73rem' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two column: open issues + recent fills */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>
            Open Issues <span style={{ color: 'var(--sub)', fontWeight: 400 }}>({openIssues.length})</span>
          </div>
          {openIssues.length === 0 && <div style={{ color: 'var(--sub)', fontSize: '0.875rem' }}>No open issues</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {openIssues.map(issue => (
              <div key={issue.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: SEVERITY_DOT[issue.severity || ''] || 'var(--sub)', flexShrink: 0, marginTop: 6 }} />
                <div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{issue.description}</div>
                  <div style={{ color: 'var(--sub)', fontSize: '0.72rem', marginTop: 1 }}>{issue.severity} · {issue.frequency}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Recent Fillups</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {fuel.slice(0, 5).map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                <div>
                  <span style={{ color: 'var(--sub)', fontSize: '0.72rem', marginRight: 8 }}>{fmtDate(f.date)}</span>
                  {f.liters.toFixed(1)}L · ${f.price_per_liter.toFixed(3)}/L
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--amber)', fontSize: '0.8rem' }}>
                  ${f.total_cost?.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
