import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Vehicle, FuelEntry, RepairEntry, RepairItem, Issue } from '../types'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function computeL100Map(entries: FuelEntry[]): Map<string, number | null> {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.odometer_km - b.odometer_km)
  const map = new Map<string, number | null>()
  sorted.forEach((e, i) => {
    if (i === 0) { map.set(e.id, null); return }
    const dist = e.odometer_km - sorted[i - 1].odometer_km
    const liters = e.liters ?? 0
    map.set(e.id, dist > 0 && liters > 0 ? (liters / dist) * 100 : null)
  })
  return map
}

interface ServiceAlert {
  label: string
  nextKm: number | null
  nextDate: Date | null
  kmRemaining: number | null
  daysRemaining: number | null
  status: 'overdue' | 'soon' | 'ok'
}

function computeAlerts(repairs: RepairEntry[], currentOdo: number): ServiceAlert[] {
  const today = new Date()

  // Flatten all items with intervals, tag with entry date/odo
  const candidates = repairs.flatMap(e =>
    (e.repair_items || [])
      .filter(i => i.interval_label && i.interval_label.trim() && (i.interval_km || i.interval_months))
      .map(i => ({ item: i, date: e.date, odo: e.odometer_km }))
  )

  // Keep only the most recent entry per interval_label
  const latest = new Map<string, { item: RepairItem; date: string; odo: number | null }>()
  for (const c of candidates) {
    const existing = latest.get(c.item.interval_label!)
    if (!existing || c.date > existing.date) {
      latest.set(c.item.interval_label!, c)
    }
  }

  return [...latest.values()].map(({ item, date, odo }) => {
    const nextKm = item.interval_km && odo ? odo + item.interval_km : null
    const nextDate = item.interval_months ? addMonths(new Date(date + 'T00:00:00'), item.interval_months) : null
    const kmRemaining = nextKm !== null ? nextKm - currentOdo : null
    const daysRemaining = nextDate ? Math.floor((nextDate.getTime() - today.getTime()) / 86400000) : null

    let status: ServiceAlert['status'] = 'ok'
    if ((kmRemaining !== null && kmRemaining <= 0) || (daysRemaining !== null && daysRemaining <= 0)) {
      status = 'overdue'
    } else if ((kmRemaining !== null && kmRemaining <= 500) || (daysRemaining !== null && daysRemaining <= 30)) {
      status = 'soon'
    }

    return { label: item.interval_label!, nextKm, nextDate, kmRemaining, daysRemaining, status }
  }).sort((a, b) => {
    const rank = { overdue: 0, soon: 1, ok: 2 }
    return rank[a.status] - rank[b.status]
  })
}

const SEVERITY_DOT: Record<string, string> = {
  Urgent: 'var(--red)',
  Concerning: 'var(--amber)',
  Monitoring: 'var(--blue)',
}

function MinimizeBtn({ minimized, onToggle }: { minimized: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={minimized ? 'Expand' : 'Minimize'}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sub)',
        padding: '0 2px', lineHeight: 1, fontSize: '0.75rem', display: 'flex',
        alignItems: 'center', transition: 'color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--fg)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--sub)')}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ transform: minimized ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
        <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

interface Props { vehicle: Vehicle }

export default function Dashboard({ vehicle }: Props) {
  const [fuel, setFuel] = useState<FuelEntry[]>([])
  const [repairs, setRepairs] = useState<RepairEntry[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [collapsed, setCollapsed] = useState({ vehicle: false, stats: false, alerts: false, issues: false, fillups: false })

  const toggle = (key: keyof typeof collapsed) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

  useEffect(() => {
    supabase.from('fuel_entries').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).then(({ data }) => { if (data) setFuel(data) })
    supabase.from('repair_entries').select('*, repair_items(*)').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).then(({ data }) => { if (data) setRepairs(data as RepairEntry[]) })
    supabase.from('issues').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).then(({ data }) => { if (data) setIssues(data) })
  }, [vehicle.id])

  const l100Map = computeL100Map(fuel)
  const validL100 = [...l100Map.values()].filter((v): v is number => v !== null && v > 6 && v < 20)
  const avgL100 = validL100.length ? validL100.reduce((a, b) => a + b, 0) / validL100.length : null

  const totalFuel = fuel.reduce((s, e) => s + (e.total_cost || 0), 0)
  const totalMaint = repairs.reduce((s, r) => s + (r.total_cost || 0), 0)
  const lastFill = fuel[0]
  const openIssues = issues.filter(i => i.status === 'Open')

  const alerts = computeAlerts(repairs, vehicle.odometer_km)
  const actionableAlerts = alerts.filter(a => a.status !== 'ok')

  const statCards = [
    { label: 'Fuel Spent', value: '$' + totalFuel.toFixed(2), sub: `${fuel.length} fillups` },
    { label: 'Avg L/100km', value: avgL100 ? avgL100.toFixed(1) : '—', sub: 'valid fills only' },
    { label: 'Last Fillup', value: lastFill ? fmtDate(lastFill.date) : '—', sub: lastFill?.station || '' },
    { label: 'Maintenance', value: '$' + totalMaint.toFixed(2), sub: `${repairs.length} visits` },
  ]

  const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Vehicle card */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed.vehicle ? 0 : '0.75rem' }}>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: '1.75rem', letterSpacing: '0.02em' }}>
              {vehicle.name}
            </div>
            <div style={{ color: 'var(--sub)', fontSize: '0.85rem', marginTop: 2 }}>
              {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.trim}
            </div>
          </div>
          <MinimizeBtn minimized={collapsed.vehicle} onToggle={() => toggle('vehicle')} />
        </div>
        {!collapsed.vehicle && (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            {([['Odometer', vehicle.odometer_km.toLocaleString() + ' km'], ['Plate', vehicle.plate || '—'], ['VIN', vehicle.vin || '—']] as [string,string][]).map(([label, val]) => (
              <div key={label}>
                <div style={{ color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.82rem', marginTop: 3 }}>{val}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ ...card, padding: '0.6rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed.stats ? 0 : '0.75rem' }}>
          <div style={{ color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Stats</div>
          <MinimizeBtn minimized={collapsed.stats} onToggle={() => toggle('stats')} />
        </div>
        {!collapsed.stats && (
          <div className="grid-stats" style={{ margin: '0 -0.25rem' }}>
            {statCards.map(s => (
              <div key={s.label} style={{ padding: '0.5rem 0.25rem' }}>
                <div style={{ color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</div>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', margin: '4px 0 2px' }}>{s.value}</div>
                <div style={{ color: 'var(--sub)', fontSize: '0.73rem' }}>{s.sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Service Alerts */}
      {actionableAlerts.length > 0 && (
        <div style={{ ...card, border: `1px solid ${actionableAlerts[0].status === 'overdue' ? 'var(--red)' : 'var(--amber)'}44` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed.alerts ? 0 : '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Service Due
              <span style={{
                background: actionableAlerts[0].status === 'overdue' ? 'var(--red)' : 'var(--amber)',
                color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: '0.65rem', fontWeight: 700,
              }}>
                {actionableAlerts.length}
              </span>
            </div>
            <MinimizeBtn minimized={collapsed.alerts} onToggle={() => toggle('alerts')} />
          </div>
          {!collapsed.alerts && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {actionableAlerts.map(alert => {
                const color = alert.status === 'overdue' ? 'var(--red)' : 'var(--amber)'
                const parts: string[] = []
                if (alert.kmRemaining !== null) {
                  if (alert.kmRemaining <= 0) parts.push(`${Math.abs(alert.kmRemaining).toLocaleString()} km overdue`)
                  else parts.push(`${alert.kmRemaining.toLocaleString()} km remaining`)
                }
                if (alert.daysRemaining !== null) {
                  if (alert.daysRemaining <= 0) parts.push(`${Math.abs(alert.daysRemaining)}d overdue`)
                  else parts.push(`${alert.daysRemaining}d remaining`)
                }
                return (
                  <div key={alert.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: color + '12', borderRadius: 7, borderLeft: `3px solid ${color}` }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{alert.label}</div>
                      <div style={{ color: 'var(--sub)', fontSize: '0.72rem', marginTop: 2 }}>
                        {parts.join(' · ')}
                        {alert.nextKm && <span> · due at {alert.nextKm.toLocaleString()} km</span>}
                      </div>
                    </div>
                    <span style={{ color, fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {alert.status === 'overdue' ? 'Overdue' : 'Soon'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Two column: open issues + recent fills */}
      <div className="grid-two">
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed.issues ? 0 : '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Open Issues <span style={{ color: 'var(--sub)', fontWeight: 400 }}>({openIssues.length})</span>
            </div>
            <MinimizeBtn minimized={collapsed.issues} onToggle={() => toggle('issues')} />
          </div>
          {!collapsed.issues && (
            <>
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
            </>
          )}
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed.fillups ? 0 : '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Recent Fillups</div>
            <MinimizeBtn minimized={collapsed.fillups} onToggle={() => toggle('fillups')} />
          </div>
          {!collapsed.fillups && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {fuel.slice(0, 5).map(f => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--sub)', fontSize: '0.72rem', marginRight: 8 }}>{fmtDate(f.date)}</span>
                    {f.liters != null ? f.liters.toFixed(1) : '—'}L · ${f.price_per_liter != null ? f.price_per_liter.toFixed(3) : '—'}/L
                  </div>
                  <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--amber)', fontSize: '0.8rem' }}>
                    ${f.total_cost?.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
