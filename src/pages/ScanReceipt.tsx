import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { ScanPrefill } from '../types'

// ── Field display config ─────────────────────────────────────────────────────

interface FieldCfg {
  key: string
  label: string
  color: string
  format: (v: string | number) => string
}

const FIELDS: FieldCfg[] = [
  { key: 'date',         label: 'Date',         color: '#3b82f6', format: v => v as string },
  { key: 'station',      label: 'Station',       color: '#a855f7', format: v => v as string },
  { key: 'grade',        label: 'Grade',         color: '#f97316', format: v => v as string },
  { key: 'volume_l',     label: 'Volume',        color: '#22c55e', format: v => `${Number(v).toFixed(3)} L` },
  { key: 'price_per_l',  label: 'Price / Litre', color: '#06b6d4', format: v => `$${Number(v).toFixed(3)}` },
  { key: 'total_cost',   label: 'Total Cost',    color: '#f59e0b', format: v => `$${Number(v).toFixed(2)}` },
]

const ODO_COLOR = '#f43f5e'

// ── Types ────────────────────────────────────────────────────────────────────

interface ScanField {
  value: string | number | null
  confidence: 'high' | 'medium' | 'low'
}

interface ScanResult {
  fields: Record<string, ScanField>
  boxes: Record<string, { x: number; y: number; w: number; h: number }>
}

interface OdoResult {
  odometer_km: ScanField
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resizeToJpeg(file: File, maxDim = 1600): Promise<{ data: string; mediaType: 'image/jpeg' }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1)
      const w = Math.round(img.naturalWidth * ratio)
      const h = Math.round(img.naturalHeight * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      resolve({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

async function callEdgeFunction(image: string, mediaType: string, type: 'receipt' | 'odometer') {
  const { data, error } = await supabase.functions.invoke('scan-receipt', {
    body: { image, mediaType, type },
  })
  if (error) throw new Error(error.message ?? 'Edge function error')
  if (data?.error) throw new Error(data.error)
  return data
}

function buildPrefill(result: ScanResult, odoKm: number | null): ScanPrefill {
  const get = (key: string) => result.fields[key]?.value
  const GRADES = ['Regular 87', 'Plus 89', 'Premium 91', 'Premium 93']
  const rawGrade = get('grade')
  return {
    date:            typeof get('date') === 'string'    ? get('date') as string          : undefined,
    station:         typeof get('station') === 'string' ? get('station') as string       : undefined,
    grade:           typeof rawGrade === 'string' && GRADES.includes(rawGrade) ? rawGrade : undefined,
    liters:          get('volume_l')    != null          ? String(get('volume_l'))        : undefined,
    price_per_liter: get('price_per_l') != null          ? String(get('price_per_l'))     : undefined,
    total_cost:      get('total_cost')  != null          ? String(get('total_cost'))      : undefined,
    odometer_km:     odoKm              != null          ? String(odoKm)                  : undefined,
  }
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '1rem 1.25rem',
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  if (confidence === 'high') return <span title="High confidence" style={{ fontSize: '0.8rem', color: '#22c55e' }}>✓</span>
  if (confidence === 'low')  return <span title="Low confidence — verify manually" style={{ fontSize: '0.8rem', color: '#f59e0b' }}>⚠</span>
  return null
}

function UploadZone({ label, hint, icon, onClick, disabled }: {
  label: string; hint: string; icon: string; onClick: () => void; disabled?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '0.5rem', padding: '1.25rem 1rem', borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
        border: `2px dashed ${hovered && !disabled ? 'var(--amber)' : 'var(--border)'}`,
        background: 'var(--bg)', opacity: disabled ? 0.4 : 1,
        transition: 'border-color 0.15s',
      }}
    >
      <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>{icon}</span>
      <div style={{ fontWeight: 600, fontSize: '0.85rem', textAlign: 'center' }}>{label}</div>
      <div style={{ color: 'var(--sub)', fontSize: '0.72rem', textAlign: 'center' }}>{hint}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onUseScan: (prefill: ScanPrefill) => void
}

export default function ScanReceipt({ onUseScan }: Props) {
  // Receipt
  const [receiptUrl,      setReceiptUrl]      = useState<string | null>(null)
  const [receiptResult,   setReceiptResult]   = useState<ScanResult | null>(null)
  const [receiptScanning, setReceiptScanning] = useState(false)
  const [receiptError,    setReceiptError]    = useState<string | null>(null)
  const receiptRef = useRef<HTMLInputElement>(null)

  // Odometer
  const [odoUrl,      setOdoUrl]      = useState<string | null>(null)
  const [odoResult,   setOdoResult]   = useState<OdoResult | null>(null)
  const [odoScanning, setOdoScanning] = useState(false)
  const [odoError,    setOdoError]    = useState<string | null>(null)
  const odoRef = useRef<HTMLInputElement>(null)

  async function handleReceiptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const previewUrl = URL.createObjectURL(file)
    setReceiptUrl(prev => { if (prev) URL.revokeObjectURL(prev); return previewUrl })
    setReceiptResult(null)
    setReceiptError(null)
    setReceiptScanning(true)
    try {
      const { data, mediaType } = await resizeToJpeg(file)
      const result = await callEdgeFunction(data, mediaType, 'receipt')
      setReceiptResult(result as ScanResult)
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : String(err))
    }
    setReceiptScanning(false)
  }

  async function handleOdoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const previewUrl = URL.createObjectURL(file)
    setOdoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return previewUrl })
    setOdoResult(null)
    setOdoError(null)
    setOdoScanning(true)
    try {
      const { data, mediaType } = await resizeToJpeg(file)
      const result = await callEdgeFunction(data, mediaType, 'odometer')
      setOdoResult(result as OdoResult)
    } catch (err) {
      setOdoError(err instanceof Error ? err.message : String(err))
    }
    setOdoScanning(false)
  }

  function handleReset() {
    if (receiptUrl) URL.revokeObjectURL(receiptUrl)
    if (odoUrl)     URL.revokeObjectURL(odoUrl)
    setReceiptUrl(null); setReceiptResult(null); setReceiptError(null)
    setOdoUrl(null);     setOdoResult(null);     setOdoError(null)
  }

  const odoKm = odoResult?.odometer_km?.value != null ? Number(odoResult.odometer_km.value) : null
  const receiptHasFields = receiptResult && Object.values(receiptResult.fields).some(f => f.value != null)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Step 1: Nothing uploaded ── */}
      {!receiptUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ color: 'var(--sub)', fontSize: '0.8rem' }}>
            Upload your receipt first, then optionally add an odometer photo.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div onClick={() => receiptRef.current?.click()} style={{ cursor: 'pointer' }}>
              <UploadZone label="Receipt Photo" hint="Date, station, litres, price, total" icon="🧾" onClick={() => {}} />
            </div>
            <UploadZone label="Odometer Photo" hint="Add after receipt scan" icon="🔢" onClick={() => {}} disabled />
          </div>
          <input ref={receiptRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleReceiptFile} />
        </div>
      )}

      {/* ── Step 2+: Receipt uploaded ── */}
      {receiptUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Scanning banners */}
          {receiptScanning && (
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--sub)', fontSize: '0.875rem' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Reading receipt with Claude…
            </div>
          )}
          {odoScanning && (
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--sub)', fontSize: '0.875rem' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Reading odometer with Claude…
            </div>
          )}

          {/* Main layout: images left, fields right */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Images column */}
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Receipt image */}
              <div style={card}>
                <div style={{ fontSize: '0.65rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Receipt</div>
                <img src={receiptUrl} alt="Receipt" style={{ width: '100%', borderRadius: 6, display: 'block', maxHeight: 400, objectFit: 'contain' }} />
                {receiptError && <div style={{ marginTop: '0.5rem', color: '#f43f5e', fontSize: '0.8rem' }}>Scan failed: {receiptError}</div>}
              </div>

              {/* Odometer zone — always shown once receipt is uploaded */}
              <div style={card}>
                <div style={{ fontSize: '0.65rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Odometer</div>

                {!odoUrl ? (
                  <>
                    <UploadZone
                      label="Add Odometer Photo"
                      hint="Optional — for km reading"
                      icon="🔢"
                      onClick={() => odoRef.current?.click()}
                      disabled={odoScanning}
                    />
                    <input ref={odoRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleOdoFile} />
                  </>
                ) : (
                  <>
                    <img src={odoUrl} alt="Odometer" style={{ width: '100%', borderRadius: 6, display: 'block', maxHeight: 180, objectFit: 'contain' }} />
                    {odoError && <div style={{ marginTop: '0.5rem', color: '#f43f5e', fontSize: '0.8rem' }}>Scan failed: {odoError}</div>}
                    {/* Re-scan odometer */}
                    {!odoScanning && (
                      <button
                        onClick={() => { if (odoUrl) URL.revokeObjectURL(odoUrl); setOdoUrl(null); setOdoResult(null); setOdoError(null); setTimeout(() => odoRef.current?.click(), 50) }}
                        style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--sub)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                      >
                        ↺ Replace photo
                      </button>
                    )}
                    <input ref={odoRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleOdoFile} />
                  </>
                )}
              </div>
            </div>

            {/* Fields column */}
            <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={card}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Extracted Fields</div>

                {!receiptResult && !receiptScanning && !receiptError && (
                  <div style={{ color: 'var(--sub)', fontSize: '0.875rem' }}>Scanning…</div>
                )}

                {receiptResult && !receiptHasFields && (
                  <div style={{ color: 'var(--sub)', fontSize: '0.875rem' }}>No fields detected — image may be unclear or not a fuel receipt.</div>
                )}

                {receiptResult && receiptHasFields && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {FIELDS.map(cfg => {
                      const field = receiptResult.fields[cfg.key]
                      if (!field || field.value == null) return null
                      return (
                        <div key={cfg.key} style={{
                          display: 'flex', alignItems: 'center', gap: '0.65rem',
                          padding: '0.45rem 0.75rem',
                          background: cfg.color + '12', border: `1px solid ${cfg.color}30`,
                          borderRadius: 7, borderLeft: `3px solid ${cfg.color}`,
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color, marginBottom: 2 }}>{cfg.label}</div>
                            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.875rem', fontWeight: 600 }}>{cfg.format(field.value)}</div>
                          </div>
                          <ConfidenceBadge confidence={field.confidence} />
                        </div>
                      )
                    })}

                    {/* Odometer field — from odo scan or receipt */}
                    {(odoKm != null || receiptResult.fields['odometer_km']?.value != null) && (() => {
                      const val   = odoKm ?? Number(receiptResult.fields['odometer_km']!.value)
                      const conf  = odoResult?.odometer_km?.confidence ?? receiptResult.fields['odometer_km']?.confidence ?? 'medium'
                      const fromOdo = odoKm != null
                      return (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '0.65rem',
                          padding: '0.45rem 0.75rem',
                          background: ODO_COLOR + '12', border: `1px solid ${ODO_COLOR}30`,
                          borderRadius: 7, borderLeft: `3px solid ${ODO_COLOR}`,
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: ODO_COLOR, marginBottom: 2 }}>
                              Odometer{fromOdo ? ' (from photo)' : ''}
                            </div>
                            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.875rem', fontWeight: 600 }}>{val.toLocaleString()} km</div>
                          </div>
                          <ConfidenceBadge confidence={conf} />
                        </div>
                      )
                    })()}

                    {/* Odometer missing hint */}
                    {odoKm == null && receiptResult.fields['odometer_km']?.value == null && !odoUrl && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--sub)', padding: '0.4rem 0.75rem', borderRadius: 6, background: 'var(--bg3)' }}>
                        Odometer not on receipt — add a photo on the left
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {receiptHasFields && !receiptScanning && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => onUseScan(buildPrefill(receiptResult!, odoKm))}
                    style={{
                      flex: 1, background: 'var(--amber)', color: '#000',
                      border: 'none', borderRadius: 6, padding: '10px 16px',
                      cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
                      fontFamily: 'Barlow, sans-serif',
                    }}
                  >
                    Use These Values →
                  </button>
                  <button
                    onClick={handleReset}
                    style={{
                      background: 'transparent', color: 'var(--sub)',
                      border: '1px solid var(--border)', borderRadius: 6, padding: '10px 16px',
                      cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif',
                    }}
                  >
                    Start Over
                  </button>
                </div>
              )}

              {(receiptScanning || (!receiptResult && !receiptError)) && (
                <button onClick={handleReset} style={{ background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif' }}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
