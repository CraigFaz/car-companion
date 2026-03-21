import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { RepairEntry } from '../types'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TYPE_COLOR: Record<string, string> = {
  'Oil Change':            '#f59e0b',
  'Repair':                '#ef4444',
  'Scheduled Maintenance': '#3b82f6',
  'Suspension':            '#a78bfa',
  'Electrical':            '#eab308',
  'Diagnostic':            '#5a6480',
  'Body Work':             '#22c55e',
  'Tire Rotation':         '#06b6d4',
  'Brakes':                '#f97316',
  'Other':                 '#5a6480',
}

const ITEM_TYPES = [
  'Oil Change', 'Tire Rotation', 'Brakes', 'Suspension', 'Electrical',
  'Body Work', 'Scheduled Maintenance', 'Diagnostic', 'Repair', 'Other',
]

const INPUT: React.CSSProperties = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', padding: '8px 12px', fontSize: '0.875rem',
  width: '100%', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', color: 'var(--sub)',
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4,
}

interface NewItem {
  type: string; description: string; parts: string
  warranty: string; interval_km: string; interval_months: string; interval_label: string
}

const blankItem = (): NewItem => ({
  type: 'Repair', description: '', parts: '', warranty: '',
  interval_km: '', interval_months: '', interval_label: '',
})

interface Props { vehicleId: string }

export default function Maintenance({ vehicleId }: Props) {
  const [entries, setEntries] = useState<RepairEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hdr, setHdr] = useState({ date: new Date().toISOString().slice(0, 10), odo: '', shop: '', total_cost: '', notes: '' })
  const [items, setItems] = useState<NewItem[]>([blankItem()])

  useEffect(() => { load() }, [vehicleId])

  async function load() {
    const { data } = await supabase
      .from('repair_entries')
      .select('*, repair_items(*)')
      .eq('vehicle_id', vehicleId)
      .order('date', { ascending: false })
    if (data) setEntries(data as RepairEntry[])
  }

  async function handleSave() {
    const validItems = items.filter(i => i.description.trim())
    if (!hdr.date || !hdr.shop || !validItems.length) return
    setSaving(true)
    const { data: entry } = await supabase.from('repair_entries').insert({
      vehicle_id: vehicleId,
      date: hdr.date,
      odometer_km: hdr.odo ? parseInt(hdr.odo) : null,
      shop: hdr.shop || null,
      total_cost: hdr.total_cost ? parseFloat(hdr.total_cost) : null,
      notes: hdr.notes || null,
    }).select().single()
    if (entry) {
      await supabase.from('repair_items').insert(
        validItems.map((item, idx) => ({
          repair_entry_id: entry.id,
          type: item.type,
          description: item.description,
          parts: item.parts || null,
          warranty: item.warranty || null,
          interval_km: item.interval_km ? parseInt(item.interval_km) : null,
          interval_months: item.interval_months ? parseInt(item.interval_months) : null,
          interval_label: item.interval_label || null,
          sort_order: idx + 1,
        }))
      )
    }
    setHdr({ date: new Date().toISOString().slice(0, 10), odo: '', shop: '', total_cost: '', notes: '' })
    setItems([blankItem()])
    setShowForm(false)
    setSaving(false)
    load()
  }

  function updateItem(idx: number, patch: Partial<NewItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  const totalCost = entries.reduce((s, e) => s + (e.total_cost || 0), 0)
  const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Repair & Maintenance</div>
          <div style={{ color: 'var(--sub)', fontSize: '0.78rem', marginTop: 2 }}>
            {entries.length} visits · Total ${totalCost.toFixed(2)}
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif' }}
        >
          + Add Visit
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>New Repair Visit</div>

          <div className="grid-form-3" style={{ marginBottom: '1rem' }}>
            <div><label style={LABEL}>Date</label><input type="date" style={INPUT} value={hdr.date} onChange={e => setHdr(h => ({ ...h, date: e.target.value }))} /></div>
            <div><label style={LABEL}>Odometer (km)</label><input type="number" style={INPUT} value={hdr.odo} onChange={e => setHdr(h => ({ ...h, odo: e.target.value }))} placeholder="272500" /></div>
            <div><label style={LABEL}>Total Cost ($)</label><input type="number" step="0.01" style={INPUT} value={hdr.total_cost} onChange={e => setHdr(h => ({ ...h, total_cost: e.target.value }))} placeholder="0.00" /></div>
            <div style={{ gridColumn: 'span 2' }}><label style={LABEL}>Shop</label><input type="text" style={INPUT} value={hdr.shop} onChange={e => setHdr(h => ({ ...h, shop: e.target.value }))} placeholder="Canadian Tire" /></div>
            <div><label style={LABEL}>Notes</label><input type="text" style={INPUT} value={hdr.notes} onChange={e => setHdr(h => ({ ...h, notes: e.target.value }))} placeholder="Optional" /></div>
          </div>

          {/* Line items */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Work Done</div>
            {items.map((item, idx) => (
              <div key={idx} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 150px' }}>
                    <label style={LABEL}>Type</label>
                    <select style={INPUT} value={item.type} onChange={e => updateItem(idx, { type: e.target.value })}>
                      {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={LABEL}>Description</label>
                    <input type="text" style={INPUT} value={item.description} onChange={e => updateItem(idx, { description: e.target.value })} placeholder="What was done?" />
                  </div>
                  {items.length > 1 && (
                    <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--sub)', cursor: 'pointer', padding: '4px', marginTop: 20, fontSize: '1.1rem', lineHeight: 1 }}>×</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}><label style={LABEL}>Parts</label><input type="text" style={INPUT} value={item.parts} onChange={e => updateItem(idx, { parts: e.target.value })} placeholder="Part names/numbers" /></div>
                  <div style={{ flex: '1 1 150px' }}><label style={LABEL}>Warranty</label><input type="text" style={INPUT} value={item.warranty} onChange={e => updateItem(idx, { warranty: e.target.value })} placeholder="12 mo / 20,000 km" /></div>
                  <div style={{ flex: '0 0 86px' }}><label style={LABEL}>Interval km</label><input type="number" style={INPUT} value={item.interval_km} onChange={e => updateItem(idx, { interval_km: e.target.value })} placeholder="5000" /></div>
                  <div style={{ flex: '0 0 78px' }}><label style={LABEL}>Interval mo</label><input type="number" style={INPUT} value={item.interval_months} onChange={e => updateItem(idx, { interval_months: e.target.value })} placeholder="6" /></div>
                  <div style={{ flex: '1 1 120px' }}><label style={LABEL}>Reminder label</label><input type="text" style={INPUT} value={item.interval_label} onChange={e => updateItem(idx, { interval_label: e.target.value })} placeholder="Oil Change" /></div>
                </div>
              </div>
            ))}
            <button
              onClick={() => setItems(prev => [...prev, blankItem()])}
              style={{ background: 'transparent', color: 'var(--blue)', border: '1px dashed var(--border)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: '0.825rem', fontFamily: 'Barlow, sans-serif', width: '100%' }}
            >
              + Add Line Item
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowForm(false); setItems([blankItem()]); setHdr({ date: new Date().toISOString().slice(0, 10), odo: '', shop: '', total_cost: '', notes: '' }) }}
              style={{ background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}
            >Cancel</button>
            <button
              onClick={handleSave} disabled={saving}
              style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}
            >{saving ? 'Saving…' : 'Save Visit'}</button>
          </div>
        </div>
      )}

      {/* Entry list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {entries.map(entry => {
          const sortedItems = [...(entry.repair_items || [])].sort((a, b) => a.sort_order - b.sort_order)
          return (
            <div key={entry.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: sortedItems.length ? '0.75rem' : 0 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{entry.shop || '—'}</div>
                  <div style={{ color: 'var(--sub)', fontSize: '0.75rem', marginTop: 3, display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span>{fmtDate(entry.date)}</span>
                    {entry.odometer_km && <span style={{ fontFamily: 'DM Mono, monospace' }}>{entry.odometer_km.toLocaleString()} km</span>}
                  </div>
                  {entry.notes && <div style={{ color: 'var(--sub)', fontSize: '0.78rem', fontStyle: 'italic', marginTop: 4 }}>{entry.notes}</div>}
                </div>
                {entry.total_cost != null && (
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.5rem', fontWeight: 700, color: 'var(--amber)', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                    ${entry.total_cost.toFixed(2)}
                  </div>
                )}
              </div>

              {sortedItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {sortedItems.map(item => {
                    const color = TYPE_COLOR[item.type] || '#5a6480'
                    const hasInterval = item.interval_km || item.interval_months
                    const intervalText = item.interval_label ||
                      [item.interval_km ? `${item.interval_km.toLocaleString()} km` : '', item.interval_months ? `${item.interval_months} mo` : ''].filter(Boolean).join(' / ')
                    return (
                      <div key={item.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.5rem 0.75rem', background: 'var(--bg3)', borderRadius: 7, borderLeft: `3px solid ${color}` }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
                            <span style={{ background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 4, padding: '1px 6px', fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                              {item.type}
                            </span>
                            {hasInterval && (
                              <span style={{ background: 'var(--blue)18', color: 'var(--blue)', border: '1px solid var(--blue)33', borderRadius: 4, padding: '1px 6px', fontSize: '0.6rem', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                                ↻ {intervalText}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{item.description}</div>
                          {item.parts && <div style={{ color: 'var(--sub)', fontSize: '0.75rem', marginTop: 2 }}>{item.parts}</div>}
                          {item.warranty && <div style={{ color: 'var(--sub)', fontSize: '0.72rem', marginTop: 2 }}>Warranty: {item.warranty}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
