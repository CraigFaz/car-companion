import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { FuelEntry } from '../types'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
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

const INPUT: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '8px 12px',
  fontSize: '0.875rem',
  width: '100%',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  color: 'var(--sub)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 4,
}

interface Props { vehicleId: string }

export default function FuelLog({ vehicleId }: Props) {
  const [entries, setEntries] = useState<FuelEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), odometer_km: '', liters: '', price_per_liter: '', station: '', notes: '' })

  useEffect(() => { load() }, [vehicleId])

  async function load() {
    const { data } = await supabase.from('fuel_entries').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false })
    if (data) setEntries(data)
  }

  const l100Map = computeL100Map(entries)
  const validL100 = [...l100Map.values()].filter((v): v is number => v !== null && v > 5 && v < 22)
  const avgL100 = validL100.length ? validL100.reduce((a, b) => a + b, 0) / validL100.length : null
  const totalCost = entries.reduce((s, e) => s + (e.total_cost || 0), 0)
  const totalLiters = entries.reduce((s, e) => s + (e.liters || 0), 0)

  const chartData = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => { const v = l100Map.get(e.id); return { date: fmtDate(e.date), l100: (v !== null && v !== undefined && v > 5 && v < 22) ? +v.toFixed(2) : null } })
    .filter(d => d.l100 !== null)

  async function handleSave() {
    if (!form.date || !form.odometer_km || !form.liters || !form.price_per_liter) return
    setSaving(true)
    await supabase.from('fuel_entries').insert({
      vehicle_id: vehicleId,
      date: form.date,
      odometer_km: parseFloat(form.odometer_km),
      liters: parseFloat(form.liters),
      price_per_liter: parseFloat(form.price_per_liter),
      station: form.station || null,
      notes: form.notes || null,
    })
    setForm({ date: new Date().toISOString().slice(0, 10), odometer_km: '', liters: '', price_per_liter: '', station: '', notes: '' })
    setShowForm(false)
    setSaving(false)
    load()
  }

  const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Stats */}
      <div className="grid-stats">
        {[
          { label: 'Fillups', value: entries.length.toString() },
          { label: 'Total Liters', value: totalLiters.toFixed(1) + 'L' },
          { label: 'Total Spent', value: '$' + totalCost.toFixed(2) },
          { label: 'Avg L/100km', value: avgL100 ? avgL100.toFixed(1) : '—' },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', margin: '4px 0' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '1rem' }}>Fuel Economy — L/100km</div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={chartData} margin={{ left: -10, right: 10 }}>
              <XAxis dataKey="date" tick={{ fill: '#5a6480', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#5a6480', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                formatter={(val) => [Number(val).toFixed(1) + ' L/100km', 'Economy']}
              />
              {avgL100 && <ReferenceLine y={+avgL100.toFixed(2)} stroke="#5a6480" strokeDasharray="4 4" label={{ value: 'avg', fill: '#5a6480', fontSize: 10 }} />}
              <Line type="monotone" dataKey="l100" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Header + add button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>All Fillups</div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif' }}
        >
          + Add Fillup
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={card}>
          <div className="grid-form-3">
            <div><label style={LABEL}>Date</label><input type="date" style={INPUT} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><label style={LABEL}>Odometer (km)</label><input type="number" style={INPUT} value={form.odometer_km} onChange={e => setForm(f => ({ ...f, odometer_km: e.target.value }))} placeholder="272500" /></div>
            <div><label style={LABEL}>Liters</label><input type="number" step="0.001" style={INPUT} value={form.liters} onChange={e => setForm(f => ({ ...f, liters: e.target.value }))} placeholder="50.000" /></div>
            <div><label style={LABEL}>Price per Liter ($)</label><input type="number" step="0.001" style={INPUT} value={form.price_per_liter} onChange={e => setForm(f => ({ ...f, price_per_liter: e.target.value }))} placeholder="1.499" /></div>
            <div><label style={LABEL}>Station</label><input type="text" style={INPUT} value={form.station} onChange={e => setForm(f => ({ ...f, station: e.target.value }))} placeholder="Ayr Esso" /></div>
            <div><label style={LABEL}>Notes</label><input type="text" style={INPUT} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" /></div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowForm(false)} style={{ background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-scroll" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Date', 'Station', 'Odometer', 'Liters', '$/L', 'Total', 'L/100km'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const l100 = l100Map.get(e.id)
              const l100ok = l100 !== null && l100 !== undefined && l100 > 5 && l100 < 22
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '9px 14px', color: 'var(--sub)', whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: '9px 14px' }}>{e.station || '—'}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>{e.odometer_km.toLocaleString()}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>{e.liters.toFixed(3)}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>${e.price_per_liter.toFixed(3)}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem', color: 'var(--amber)' }}>${e.total_cost?.toFixed(2)}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem', color: l100ok ? 'var(--green)' : 'var(--sub)' }}>
                    {l100ok ? l100!.toFixed(1) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
