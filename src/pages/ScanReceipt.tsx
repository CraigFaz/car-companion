import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { ScanPrefill } from '../types'

// ── Field display config ────────────────────────────────────────────────────

interface FieldCfg {
  key: string
  label: string
  color: string
  format: (v: string | number) => string
}

const FIELDS: FieldCfg[] = [
  { key: 'date',         label: 'Date',          color: '#3b82f6', format: v => v as string },
  { key: 'station',      label: 'Station',        color: '#a855f7', format: v => v as string },
  { key: 'grade',        label: 'Grade',          color: '#f97316', format: v => v as string },
  { key: 'volume_l',     label: 'Volume',         color: '#22c55e', format: v => `${Number(v).toFixed(3)} L` },
  { key: 'price_per_l',  label: 'Price / Litre',  color: '#06b6d4', format: v => `$${Number(v).toFixed(3)}` },
  { key: 'total_cost',   label: 'Total Cost',     color: '#f59e0b', format: v => `$${Number(v).toFixed(2)}` },
  { key: 'odometer_km',  label: 'Odometer',       color: '#f43f5e', format: v => `${Number(v).toLocaleString()} km` },
]

// ── Types ───────────────────────────────────────────────────────────────────

interface ScanField {
  value: string | number | null
  confidence: 'high' | 'medium' | 'low'
}

interface BoundingBox {
  x: number
  y: number
  w: number
  h: number
}

interface ScanResult {
  fields: Record<string, ScanField>
  boxes: Record<string, BoundingBox>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function resultToPrefill(result: ScanResult): ScanPrefill {
  const get = (key: string) => result.fields[key]?.value
  const GRADES = ['Regular 87', 'Plus 89', 'Premium 91', 'Premium 93']
  const rawGrade = get('grade')
  const grade = (typeof rawGrade === 'string' && GRADES.includes(rawGrade)) ? rawGrade : undefined
  return {
    date:           typeof get('date') === 'string'           ? get('date') as string            : undefined,
    station:        typeof get('station') === 'string'        ? get('station') as string         : undefined,
    grade,
    liters:         get('volume_l')    != null                ? String(get('volume_l'))          : undefined,
    price_per_liter:get('price_per_l') != null                ? String(get('price_per_l'))       : undefined,
    total_cost:     get('total_cost')  != null                ? String(get('total_cost'))        : undefined,
    odometer_km:    get('odometer_km') != null                ? String(get('odometer_km'))       : undefined,
  }
}

// ── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '1rem 1.25rem',
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  onUseScan: (prefill: ScanPrefill) => void
}

export default function ScanReceipt({ onUseScan }: Props) {
  const [imageUrl, setImageUrl]   = useState<string | null>(null)
  const [scanning, setScanning]   = useState(false)
  const [result, setResult]       = useState<ScanResult | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // Show preview immediately
    const previewUrl = URL.createObjectURL(file)
    setImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return previewUrl })
    setResult(null)
    setError(null)
    setScanning(true)

    try {
      const { data, mediaType } = await resizeToJpeg(file)
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('scan-receipt', {
        body: { image: data, mediaType },
      })
      if (fnErr) throw new Error(fnErr.message ?? 'Edge function error')
      if (fnData?.error) throw new Error(fnData.error)
      setResult(fnData as ScanResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setScanning(false)
  }

  function handleReset() {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(null)
    setResult(null)
    setError(null)
  }

  const noFieldsFound = result && Object.values(result.fields).every(f => f.value == null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Upload zone — hidden once image is selected */}
      {!imageUrl && (
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            ...card,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: 200, cursor: 'pointer', gap: '0.75rem',
            border: '2px dashed var(--border)',
            background: 'var(--bg)',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--amber)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>📷</span>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Tap or click to upload a receipt</div>
          <div style={{ color: 'var(--sub)', fontSize: '0.75rem' }}>JPG, PNG, WebP — resized automatically</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
        </div>
      )}

      {/* Image + results panel */}
      {imageUrl && (
        <>
          {/* Scanning indicator */}
          {scanning && (
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--sub)', fontSize: '0.875rem' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Analysing with Claude…
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ ...card, border: '1px solid #f43f5e', color: '#f43f5e', fontSize: '0.875rem' }}>
              <strong>Scan failed:</strong> {error}
            </div>
          )}

          {/* Side-by-side layout */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Image */}
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <div style={card}>
                <img
                  src={imageUrl}
                  alt="Receipt"
                  style={{ width: '100%', borderRadius: 6, display: 'block', maxHeight: 520, objectFit: 'contain' }}
                />
                {/* Note about future highlighting */}
                {result && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--sub)', textAlign: 'center' }}>
                    Field highlighting coming soon
                  </div>
                )}
              </div>
            </div>

            {/* JSON results */}
            {result && (
              <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={card}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '1rem' }}>
                    Extracted Fields
                  </div>

                  {noFieldsFound ? (
                    <div style={{ color: 'var(--sub)', fontSize: '0.875rem' }}>
                      No fields detected — image may be unclear or not a fuel receipt.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {FIELDS.map(cfg => {
                        const field = result.fields[cfg.key]
                        if (!field || field.value == null) return null
                        return (
                          <div
                            key={cfg.key}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.65rem',
                              padding: '0.5rem 0.75rem',
                              background: cfg.color + '12',
                              border: `1px solid ${cfg.color}30`,
                              borderRadius: 7,
                              borderLeft: `3px solid ${cfg.color}`,
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color, marginBottom: 2 }}>
                                {cfg.label}
                              </div>
                              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.9rem', fontWeight: 600 }}>
                                {cfg.format(field.value)}
                              </div>
                            </div>
                            {field.confidence === 'low' && (
                              <span title="Low confidence — verify manually" style={{ fontSize: '0.8rem', color: '#f59e0b' }}>⚠</span>
                            )}
                            {field.confidence === 'high' && (
                              <span title="High confidence" style={{ fontSize: '0.8rem', color: '#22c55e' }}>✓</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {!noFieldsFound && (
                    <button
                      onClick={() => onUseScan(resultToPrefill(result))}
                      style={{
                        flex: 1,
                        background: 'var(--amber)', color: '#000',
                        border: 'none', borderRadius: 6, padding: '10px 16px',
                        cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
                        fontFamily: 'Barlow, sans-serif',
                      }}
                    >
                      Use These Values →
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    style={{
                      background: 'transparent', color: 'var(--sub)',
                      border: '1px solid var(--border)', borderRadius: 6, padding: '10px 16px',
                      cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif',
                    }}
                  >
                    Scan Another
                  </button>
                </div>
              </div>
            )}

            {/* Scan another button when scanning or error */}
            {(scanning || error) && (
              <div>
                <button
                  onClick={handleReset}
                  style={{
                    background: 'transparent', color: 'var(--sub)',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '8px 16px',
                    cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Spinner keyframe — injected once */}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
