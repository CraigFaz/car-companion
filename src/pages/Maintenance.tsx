import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { MaintenanceRecord } from '../types'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

const CAT_COLOR: Record<string, string> = {
  'Oil Change':            '#f59e0b',
  'Repair':                '#ef4444',
  'Scheduled Maintenance': '#3b82f6',
  'Suspension':            '#a78bfa',
  'Electrical':            '#eab308',
  'Diagnostic':            '#5a6480',
  'Body Work':             '#22c55e',
  'Other':                 '#5a6480',
}

const CATEGORIES = ['Oil Change', 'Repair', 'Scheduled Maintenance', 'Suspension', 'Electrical', 'Diagnostic', 'Body Work', 'Other']

const INPUT: React.CSSProperties = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', padding: '8px 12px', fontSize: '0.875rem',
  width: '100%', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', color: 'var(--sub)',
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4,
}

interface Props { vehicleId: string }

export default function Maintenance({ vehicleId }: Props) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    odometer_km: '', category: 'Repair', description: '', cost: '', shop: '', notes: '',
  })

  useEffect(() => { load() }, [vehicleId])

  async function load() {
    const { data } = await supabase.from('maintenance_records').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false })
    if (data) setRecords(data)
  }

  async function handleSave() {
    if (!form.date || !form.description || !form.category) return
    setSaving(true)
    await supabase.from('maintenance_records').insert({
      vehicle_id: vehicleId,
      date: form.date,
      odometer_km: form.odometer_km ? parseFloat(form.odometer_km) : null,
      category: form.category,
      description: form.description,
      cost: form.cost ? parseFloat(form.cost) : null,
      shop: form.shop || null,
      notes: form.notes || null,
    })
    setForm({ date: new Date().toISOString().slice(0, 10), odometer_km: '', category: 'Repair', description: '', cost: '', shop: '', notes: '' })
    setShowForm(false)
    setSaving(false)
    load()
  }

  const totalCost = records.reduce((s, r) => s + (r.cost || 0), 0)
  const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Maintenance Records</div>
          <div style={{ color: 'var(--sub)', fontSize: '0.78rem', marginTop: 2 }}>
            {records.length} records · Total ${totalCost.toFixed(2)}
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif' }}
        >
          + Add Record
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div><label style={LABEL}>Date</label><input type="date" style={INPUT} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><label style={LABEL}>Odometer (km)</label><input type="number" style={INPUT} value={form.odometer_km} onChange={e => setForm(f => ({ ...f, odometer_km: e.target.value }))} placeholder="272500" /></div>
            <div>
              <label style={LABEL}>Category</label>
              <select style={INPUT} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}><label style={LABEL}>Description</label><input type="text" style={INPUT} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What was done?" /></div>
            <div><label style={LABEL}>Cost ($)</label><input type="number" step="0.01" style={INPUT} value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" /></div>
            <div><label style={LABEL}>Shop</label><input type="text" style={INPUT} value={form.shop} onChange={e => setForm(f => ({ ...f, shop: e.target.value }))} placeholder="Canadian Tire" /></div>
            <div style={{ gridColumn: 'span 2' }}><label style={LABEL}>Notes</label><input type="text" style={INPUT} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" /></div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowForm(false)} style={{ background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* Records */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {records.map(r => {
          const color = CAT_COLOR[r.category] || '#5a6480'
          return (
            <div key={r.id} style={card}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {r.category}
                    </span>
                    <span style={{ color: 'var(--sub)', fontSize: '0.75rem' }}>{fmtDate(r.date)}</span>
                    {r.odometer_km && <span style={{ color: 'var(--sub)', fontSize: '0.75rem', fontFamily: 'DM Mono, monospace' }}>{r.odometer_km.toLocaleString()} km</span>}
                  </div>
                  <div style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>{r.description}</div>
                  {r.shop && <div style={{ color: 'var(--sub)', fontSize: '0.78rem', marginTop: 4 }}>{r.shop}</div>}
                  {r.notes && <div style={{ color: 'var(--sub)', fontSize: '0.78rem', marginTop: 4, fontStyle: 'italic' }}>{r.notes}</div>}
                </div>
                {r.cost != null && (
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.5rem', fontWeight: 700, color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                    ${r.cost.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
