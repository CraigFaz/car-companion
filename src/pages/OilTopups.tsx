import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { OilTopup } from '../types'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props { vehicleId: string }

const EMPTY = { date: '', odometer_km: '', amount_liters: '', brand: '', notes: '' }

export default function OilTopups({ vehicleId }: Props) {
  const [topups, setTopups] = useState<OilTopup[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [vehicleId])

  function load() {
    supabase
      .from('oil_topups')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('date', { ascending: false })
      .then(({ data }) => { if (data) setTopups(data as OilTopup[]) })
  }

  const totalLiters = topups.reduce((s, t) => s + t.amount_liters, 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.date) { setError('Date is required'); return }
    if (!form.amount_liters || isNaN(Number(form.amount_liters))) { setError('Amount is required'); return }

    setSaving(true)
    const { error: err } = await supabase.from('oil_topups').insert({
      vehicle_id: vehicleId,
      date: form.date,
      odometer_km: form.odometer_km ? parseInt(form.odometer_km) : null,
      amount_liters: parseFloat(form.amount_liters),
      brand: form.brand.trim() || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm(EMPTY)
    setShowForm(false)
    load()
  }

  const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }
  const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.75rem', color: 'var(--text)', fontSize: '0.875rem', width: '100%', boxSizing: 'border-box' }
  const label: React.CSSProperties = { color: 'var(--sub)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 4 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Oil Top-ups</div>
          {topups.length > 0 && (
            <div style={{ color: 'var(--sub)', fontSize: '0.78rem', marginTop: 2 }}>
              {topups.length} {topups.length === 1 ? 'entry' : 'entries'} · {totalLiters.toFixed(2)} L total added
            </div>
          )}
        </div>
        <button
          onClick={() => { setShowForm(s => !s); setError('') }}
          style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 7, padding: '0.45rem 1rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '1rem' }}>New Top-up</div>
          <form onSubmit={handleSubmit}>
            <div className="grid-two" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={label}>Date *</label>
                <input type="date" style={input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label style={label}>Amount (L) *</label>
                <input type="number" step="0.01" min="0" placeholder="e.g. 0.75" style={input} value={form.amount_liters} onChange={e => setForm(f => ({ ...f, amount_liters: e.target.value }))} />
              </div>
              <div>
                <label style={label}>Odometer (km)</label>
                <input type="number" placeholder="e.g. 272500" style={input} value={form.odometer_km} onChange={e => setForm(f => ({ ...f, odometer_km: e.target.value }))} />
              </div>
              <div>
                <label style={label}>Brand</label>
                <input type="text" placeholder="e.g. Castrol, Mobil 1" style={input} value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={label}>Notes</label>
              <input type="text" placeholder="Optional notes" style={input} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</div>}
            <button type="submit" disabled={saving} style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 7, padding: '0.5rem 1.25rem', fontWeight: 700, fontSize: '0.875rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        </div>
      )}

      {/* List */}
      {topups.length === 0 && !showForm && (
        <div style={{ ...card, color: 'var(--sub)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem' }}>
          No oil top-ups recorded yet.
        </div>
      )}

      {topups.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {topups.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.65rem 0',
                borderBottom: i < topups.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: 'var(--sub)', fontSize: '0.72rem' }}>{fmtDate(t.date)}</span>
                    {t.brand && <span style={{ background: 'var(--bg4)', borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', color: 'var(--sub)' }}>{t.brand}</span>}
                  </div>
                  {t.odometer_km && (
                    <div style={{ color: 'var(--sub)', fontSize: '0.72rem', marginTop: 2, fontFamily: 'DM Mono, monospace' }}>
                      {t.odometer_km.toLocaleString()} km
                    </div>
                  )}
                  {t.notes && <div style={{ color: 'var(--sub)', fontSize: '0.72rem', marginTop: 2, fontStyle: 'italic' }}>{t.notes}</div>}
                </div>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.4rem', fontWeight: 700, color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                  {t.amount_liters.toFixed(2)} L
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
