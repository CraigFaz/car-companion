import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { scanFuelReceipt, scanOdometer } from '../lib/ocr'
import type { OcrResult } from '../lib/ocr'
import type { FuelEntry } from '../types'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const GRADES = ['Regular 87', 'Plus 89', 'Premium 91', 'Premium 93']
const CALC_FIELDS = ['liters', 'price_per_liter', 'total_cost'] as const
type CalcField = typeof CALC_FIELDS[number]

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
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

function isFlagged(l100: number | null | undefined): boolean {
  return l100 !== null && l100 !== undefined && (l100 < 8 || l100 > 20)
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

const INPUT_CALC: React.CSSProperties = {
  ...INPUT,
  border: '1px solid var(--blue)',
  color: 'var(--blue)',
}

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  color: 'var(--sub)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 4,
}

interface FormState {
  date: string
  odometer_km: string
  grade: string
  liters: string
  price_per_liter: string
  total_cost: string
  station: string
  notes: string
}

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  odometer_km: '',
  grade: 'Regular 87',
  liters: '',
  price_per_liter: '',
  total_cost: '',
  station: '',
  notes: '',
}

interface Props { vehicleId: string }

export default function FuelLog({ vehicleId }: Props) {
  const [entries, setEntries] = useState<FuelEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // Tracks the last two calc fields the user touched — the third is always derived
  const [lastTwo, setLastTwo] = useState<CalcField[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanPct, setScanPct] = useState(0)
  const [scanNote, setScanNote] = useState('')
  const [ocrScanning, setOcrScanning] = useState(false)
  const [ocrPct, setOcrPct] = useState(0)
  const [ocrNote, setOcrNote] = useState('')
  const [ocrData, setOcrData] = useState<OcrResult | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const odoRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [vehicleId])

  async function load() {
    const { data } = await supabase
      .from('fuel_entries')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  // --- Any-two-of-three math ---
  function derivedField(): CalcField | null {
    if (lastTwo.length < 2) return null
    return CALC_FIELDS.find(f => !lastTwo.includes(f)) ?? null
  }

  function calcDerived(field: CalcField, value: string, newLastTwo: CalcField[]): Partial<FormState> {
    if (newLastTwo.length < 2) return {}
    const third = CALC_FIELDS.find(f => !newLastTwo.includes(f))!
    const vals: Record<CalcField, string> = {
      liters: field === 'liters' ? value : form.liters,
      price_per_liter: field === 'price_per_liter' ? value : form.price_per_liter,
      total_cost: field === 'total_cost' ? value : form.total_cost,
    }
    const l = parseFloat(vals.liters)
    const p = parseFloat(vals.price_per_liter)
    const t = parseFloat(vals.total_cost)

    if (third === 'total_cost' && !isNaN(l) && !isNaN(p) && l > 0 && p > 0) {
      return { total_cost: (l * p).toFixed(2) }
    }
    if (third === 'price_per_liter' && !isNaN(l) && !isNaN(t) && l > 0 && t > 0) {
      return { price_per_liter: (t / l).toFixed(3) }
    }
    if (third === 'liters' && !isNaN(p) && !isNaN(t) && p > 0 && t > 0) {
      return { liters: (t / p).toFixed(3) }
    }
    return {}
  }

  function handleCalcChange(field: CalcField, value: string) {
    const newLastTwo = [...lastTwo.filter(f => f !== field), field].slice(-2) as CalcField[]
    setLastTwo(newLastTwo)
    const derived = calcDerived(field, value, newLastTwo)
    setForm(f => ({ ...f, [field]: value, ...derived }))
  }

  function openForm() {
    setForm(EMPTY_FORM)
    setLastTwo([])
    setScanNote('')
    setOcrNote('')
    setOcrData(null)
    setShowRaw(false)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setLastTwo([])
    setScanNote('')
    setOcrNote('')
    setOcrData(null)
    setShowRaw(false)
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScanning(true)
    setScanPct(0)
    setScanNote('')
    setOcrData(null)
    setShowRaw(false)
    try {
      const result = await scanFuelReceipt(file, setScanPct)
      setOcrData(result)
      const filled: CalcField[] = (['liters', 'price_per_liter', 'total_cost'] as CalcField[]).filter(f => !!result[f])
      const newLastTwo = filled.slice(-2) as CalcField[]
      setLastTwo(newLastTwo)
      setForm(f => ({
        ...f,
        date: result.date || f.date,
        liters: result.liters || f.liters,
        price_per_liter: result.price_per_liter || f.price_per_liter,
        total_cost: result.total_cost || f.total_cost,
        station: result.station || f.station,
        grade: result.grade || f.grade,
      }))
      const found = [
        result.liters && 'litres',
        result.price_per_liter && 'price/L',
        result.total_cost && 'total',
        result.station && 'station',
        result.grade && 'grade',
      ].filter(Boolean)
      setScanNote(found.length ? `Filled: ${found.join(', ')} — review and correct as needed` : 'No fields recognised — enter manually')
    } catch {
      setScanNote('Scan failed — enter manually')
    }
    setScanning(false)
  }

  async function handleOdoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setOcrScanning(true)
    setOcrPct(0)
    setOcrNote('')
    try {
      const result = await scanOdometer(file, setOcrPct)
      if (result.odometer_km) {
        setForm(f => ({ ...f, odometer_km: result.odometer_km }))
        setOcrNote(`Read: ${Number(result.odometer_km).toLocaleString()} km — correct if needed`)
      } else {
        setOcrNote('No odometer reading found — enter manually')
      }
    } catch {
      setOcrNote('Scan failed — enter manually')
    }
    setOcrScanning(false)
  }

  async function handleSave() {
    const l = parseFloat(form.liters)
    const p = parseFloat(form.price_per_liter)
    const t = parseFloat(form.total_cost)
    if (!form.date || !form.odometer_km || isNaN(l) || isNaN(p) || isNaN(t)) return
    setSaving(true)
    await supabase.from('fuel_entries').insert({
      vehicle_id: vehicleId,
      date: form.date,
      odometer_km: parseFloat(form.odometer_km),
      grade: form.grade,
      liters: l,
      price_per_liter: p,
      total_cost: t,
      station: form.station || null,
      notes: form.notes || null,
      ocr_raw: ocrData?.raw ?? null,
      ocr_meta: ocrData ? (Object.keys(ocrData.meta).length > 0 ? ocrData.meta as unknown as Record<string, unknown> : null) : null,
    })
    setForm(EMPTY_FORM)
    setLastTwo([])
    setShowForm(false)
    setSaving(false)
    load()
  }

  // --- Derived stats ---
  const l100Map = computeL100Map(entries)
  const validL100 = [...l100Map.values()].filter((v): v is number => v !== null && v > 5 && v < 25)
  const avgL100 = validL100.length ? validL100.reduce((a, b) => a + b, 0) / validL100.length : null
  const totalCost = entries.reduce((s, e) => s + (e.total_cost ?? 0), 0)
  const totalLiters = entries.reduce((s, e) => s + (e.liters ?? 0), 0)

  const chartData = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => {
      const v = l100Map.get(e.id)
      return { date: fmtDate(e.date), l100: (v !== null && v !== undefined && v > 5 && v < 25) ? +v.toFixed(2) : null }
    })
    .filter(d => d.l100 !== null)

  const card: React.CSSProperties = {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '1rem 1.25rem',
  }

  const derived = derivedField()

  function inputStyle(field: CalcField): React.CSSProperties {
    return derived === field ? INPUT_CALC : INPUT
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Stats */}
      <div className="grid-stats">
        {[
          { label: 'Fillups', value: entries.length.toString() },
          { label: 'Total Litres', value: totalLiters.toFixed(1) + 'L' },
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
              {avgL100 && (
                <ReferenceLine
                  y={+avgL100.toFixed(2)}
                  stroke="#5a6480"
                  strokeDasharray="4 4"
                  label={{ value: 'avg', fill: '#5a6480', fontSize: 10 }}
                />
              )}
              <Line type="monotone" dataKey="l100" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Header + add button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>All Fillups</div>
        <button
          onClick={openForm}
          style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif' }}
        >
          + Add Fillup
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={card}>

          {/* Scan buttons */}
          <div style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* Receipt scanner — no capture attr so user can pick camera OR existing image */}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScanFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scanning}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', color: scanning ? 'var(--sub)' : 'var(--text)', cursor: scanning ? 'not-allowed' : 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>🧾</span>
                {scanning ? `Scanning… ${scanPct}%` : 'Scan Receipt'}
              </button>
              {scanNote && (
                <span style={{ fontSize: '0.75rem', color: scanNote.startsWith('Filled') ? 'var(--green)' : 'var(--sub)' }}>
                  {scanNote}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* Odometer scanner */}
              <input ref={odoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleOdoFile} />
              <button
                type="button"
                onClick={() => odoRef.current?.click()}
                disabled={ocrScanning}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', color: ocrScanning ? 'var(--sub)' : 'var(--text)', cursor: ocrScanning ? 'not-allowed' : 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>🔢</span>
                {ocrScanning ? `Scanning… ${ocrPct}%` : 'Scan Odometer'}
              </button>
              {ocrNote && (
                <span style={{ fontSize: '0.75rem', color: ocrNote.startsWith('Read') ? 'var(--green)' : 'var(--sub)' }}>
                  {ocrNote}
                </span>
              )}
            </div>
          </div>

          {/* Raw OCR text — collapsible, always stored even if not shown */}
          {ocrData && (
            <div style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowRaw(r => !r)}
                style={{ background: 'none', border: 'none', color: 'var(--sub)', fontSize: '0.72rem', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <span style={{ fontSize: '0.6rem' }}>{showRaw ? '▼' : '▶'}</span>
                Raw OCR text
                {Object.keys(ocrData.meta).length > 0 && (
                  <span style={{ marginLeft: 6, color: 'var(--blue)' }}>
                    +{Object.keys(ocrData.meta).length} extra fields stored
                  </span>
                )}
              </button>
              {showRaw && (
                <pre style={{ marginTop: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.6rem 0.75rem', fontSize: '0.7rem', color: 'var(--sub)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto' }}>
                  {ocrData.raw || '(empty)'}
                </pre>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={LABEL}>Date</label>
              <input type="date" style={INPUT} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label style={LABEL}>Odometer (km)</label>
              <input type="number" style={INPUT} value={form.odometer_km} onChange={e => setForm(f => ({ ...f, odometer_km: e.target.value }))} placeholder="272500" />
            </div>
            <div>
              <label style={LABEL}>Grade</label>
              <select style={INPUT} value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          {/* Any-two-of-three row */}
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
              Enter any two — third auto-calculates
              {derived && (
                <span style={{ color: 'var(--blue)', marginLeft: 8 }}>
                  ({derived === 'liters' ? 'Litres' : derived === 'price_per_liter' ? 'Price/L' : 'Total Cost'} calculated)
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={LABEL}>Litres</label>
                <input
                  type="number" step="0.001"
                  style={inputStyle('liters')}
                  value={form.liters}
                  onChange={e => handleCalcChange('liters', e.target.value)}
                  placeholder="50.000"
                />
              </div>
              <div>
                <label style={LABEL}>Price/L ($)</label>
                <input
                  type="number" step="0.001"
                  style={inputStyle('price_per_liter')}
                  value={form.price_per_liter}
                  onChange={e => handleCalcChange('price_per_liter', e.target.value)}
                  placeholder="1.499"
                />
              </div>
              <div>
                <label style={LABEL}>Total Cost ($)</label>
                <input
                  type="number" step="0.01"
                  style={inputStyle('total_cost')}
                  value={form.total_cost}
                  onChange={e => handleCalcChange('total_cost', e.target.value)}
                  placeholder="74.95"
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={LABEL}>Station</label>
              <input type="text" style={INPUT} value={form.station} onChange={e => setForm(f => ({ ...f, station: e.target.value }))} placeholder="Ayr Esso" />
            </div>
            <div>
              <label style={LABEL}>Notes</label>
              <input type="text" style={INPUT} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={closeForm} style={{ background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-scroll" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Date', 'Station', 'Grade', 'Odometer', 'Litres', '$/L', 'Total', 'L/100km'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--sub)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const l100 = l100Map.get(e.id)
              const flagged = isFlagged(l100)
              const l100Valid = l100 !== null && l100 !== undefined && l100 >= 8 && l100 <= 20
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)', background: flagged ? 'rgba(234,179,8,0.04)' : undefined }}>
                  <td style={{ padding: '9px 14px', color: 'var(--sub)', whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: '9px 14px' }}>{e.station || '—'}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--sub)', fontSize: '0.78rem' }}>{e.grade || '—'}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>{e.odometer_km.toLocaleString()}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>{e.liters != null ? e.liters.toFixed(3) : '—'}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>{e.price_per_liter != null ? '$' + e.price_per_liter.toFixed(3) : '—'}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem', color: 'var(--amber)' }}>{e.total_cost != null ? '$' + e.total_cost.toFixed(2) : '—'}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'DM Mono, monospace', fontSize: '0.8rem' }}>
                    <span style={{ color: flagged ? 'var(--yellow)' : l100Valid ? 'var(--green)' : 'var(--sub)' }}>
                      {l100 != null ? l100.toFixed(1) : '—'}
                    </span>
                    {flagged && (
                      <span title="Suspicious value — verify odometer" style={{ marginLeft: 5, fontSize: '0.7rem', color: 'var(--yellow)' }}>⚠</span>
                    )}
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
