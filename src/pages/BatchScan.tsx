import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { BatchItem, BatchPair, BatchFlag, AutoScanResult, ScanPrefill } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const CONCURRENCY = 2
const MAX_RETRIES  = 1
const GRADES = ['Regular 87', 'Plus 89', 'Premium 91', 'Premium 93']

const FLAG_META: Record<BatchFlag, { label: string; color: string }> = {
  unpaired_receipt:   { label: 'No odometer photo',   color: '#ef4444' },
  unpaired_odometer:  { label: 'No receipt photo',    color: '#ef4444' },
  scan_failed:        { label: 'Scan error',           color: '#ef4444' },
  not_fuel_photo:     { label: 'Unrecognized photo',   color: '#ef4444' },
  missing_fields:     { label: 'Missing fields',       color: '#f59e0b' },
  low_confidence:     { label: 'Low confidence',       color: '#f59e0b' },
  math_mismatch:      { label: "Math doesn't add up",  color: '#f59e0b' },
  multi_image_day:    { label: 'Multiple photos',      color: '#3b82f6' },
  possible_duplicate: { label: 'Possible duplicate',   color: '#3b82f6' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Inline JPEG EXIF reader — no external dependency. Reads first 128 KB only. */
async function readExifDate(file: File): Promise<{ date: string; ts: number }> {
  const fallback = { date: new Date(file.lastModified).toISOString().slice(0, 10), ts: file.lastModified }
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
  if (!isJpeg) return fallback
  try {
    const buf  = await file.slice(0, 131072).arrayBuffer()
    const view = new DataView(buf)
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return fallback
    let off = 2
    while (off + 4 <= view.byteLength) {
      const marker = view.getUint16(off)
      const segLen = view.getUint16(off + 2)
      if (marker === 0xFFE1 && segLen > 6) {
        const sig = String.fromCharCode(view.getUint8(off+4), view.getUint8(off+5), view.getUint8(off+6), view.getUint8(off+7))
        if (sig === 'Exif') {
          const tiffBase = off + 10
          const le   = view.getUint16(tiffBase) === 0x4949
          const ifd0 = tiffBase + view.getUint32(tiffBase + 4, le)
          const n    = view.getUint16(ifd0, le)
          for (let i = 0; i < n; i++) {
            const e = ifd0 + 2 + i * 12
            if (e + 12 > view.byteLength) break
            if (view.getUint16(e, le) === 0x8769) {           // ExifIFD pointer
              const exifBase = tiffBase + view.getUint32(e + 8, le)
              const ne = view.getUint16(exifBase, le)
              for (let j = 0; j < ne; j++) {
                const ef = exifBase + 2 + j * 12
                if (ef + 12 > view.byteLength) break
                const tag = view.getUint16(ef, le)
                if (tag === 0x9003 || tag === 0x9004) {        // DateTimeOriginal / Digitized
                  const vOff = tiffBase + view.getUint32(ef + 8, le)
                  let s = ''
                  for (let k = 0; k < 19 && vOff + k < view.byteLength; k++) {
                    const c = view.getUint8(vOff + k)
                    if (c === 0) break
                    s += String.fromCharCode(c)
                  }
                  if (s.length >= 10) {
                    const date = s.slice(0,4) + '-' + s.slice(5,7) + '-' + s.slice(8,10)
                    const dt   = new Date(date + 'T' + (s.length >= 19 ? s.slice(11) : '00:00:00'))
                    if (!isNaN(dt.getTime())) return { date, ts: dt.getTime() }
                  }
                }
              }
            }
          }
        }
      }
      if (segLen < 2) break
      off += 2 + segLen
    }
  } catch { /* ignore parse errors */ }
  return fallback
}

async function resizeToJpeg(file: File, maxDim = 1600): Promise<{ data: string; mediaType: 'image/jpeg' }> {
  let blob: Blob = file

  // Convert HEIC/HEIF (iPhone default format) to JPEG before canvas decoding
  const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name)
  if (isHeic) {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
    blob = Array.isArray(converted) ? converted[0] : converted
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1)
      const w = Math.round(img.naturalWidth * ratio)
      const h = Math.round(img.naturalHeight * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve({ data: canvas.toDataURL('image/jpeg', 0.92).split(',')[1], mediaType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode image')) }
    img.src = url
  })
}

async function callAutoScan(file: File): Promise<AutoScanResult> {
  const { data, mediaType } = await resizeToJpeg(file)

  // Step 1: receipt scan
  const { data: rData, error: rErr } = await supabase.functions.invoke('scan-receipt', {
    body: { image: data, mediaType, type: 'receipt' },
  })
  if (rErr) throw new Error(rErr.message ?? 'Edge function error')
  if (rData?.error) throw new Error(rData.error)

  // If the edge function already returned a classified imageType (new auto mode), use it directly
  if (rData?.imageType) return rData as AutoScanResult

  // Otherwise check whether receipt fields were found
  const fields = rData?.fields ?? {}
  const hasReceiptData = ['volume_l', 'price_per_l', 'total_cost'].some((k: string) => fields[k]?.value != null)
  if (hasReceiptData) return { imageType: 'receipt', fields }

  // Step 2: no receipt data — try odometer
  const { data: oData, error: oErr } = await supabase.functions.invoke('scan-receipt', {
    body: { image: data, mediaType, type: 'odometer' },
  })
  if (oErr) throw new Error(oErr.message ?? 'Edge function error')
  if (oData?.error) throw new Error(oData.error)

  if (oData?.odometer_km?.value != null) return { imageType: 'odometer', odometer_km: oData.odometer_km }

  return { imageType: 'unknown', reason: 'Image not recognized as a fuel receipt or odometer' }
}

function buildPairs(items: BatchItem[], existingDates: Set<string>): BatchPair[] {
  const byDate = new Map<string, BatchItem[]>()
  for (const item of items) {
    const arr = byDate.get(item.effectiveDate) ?? []
    arr.push(item)
    byDate.set(item.effectiveDate, arr)
  }

  return [...byDate.entries()].map(([date, group]) => {
    group.sort((a, b) => a.effectiveTs - b.effectiveTs)

    const receipts  = group.filter(i => i.status === 'done' && i.imageType === 'receipt')
    const odometers = group.filter(i => i.status === 'done' && i.imageType === 'odometer')
    const unknowns  = group.filter(i => i.status === 'done' && i.imageType === 'unknown')
    const errors    = group.filter(i => i.status === 'error')

    const receipt  = receipts[0] ?? null
    const odometer = odometers[0] ?? null
    const extras   = [...receipts.slice(1), ...odometers.slice(1), ...unknowns, ...errors]

    // Build prefill
    const prefill: Partial<ScanPrefill> = {}
    if (receipt?.result?.fields) {
      const f = receipt.result.fields
      if (f.date?.value)              prefill.date            = String(f.date.value)
      if (f.station?.value)           prefill.station         = String(f.station.value)
      if (f.grade?.value)             prefill.grade           = String(f.grade.value)
      if (f.volume_l?.value != null)    prefill.liters          = String(f.volume_l.value)
      if (f.price_per_l?.value != null) prefill.price_per_liter = String(f.price_per_l.value)
      if (f.total_cost?.value != null)  prefill.total_cost      = String(f.total_cost.value)
      if (f.odometer_km?.value != null) prefill.odometer_km     = String(f.odometer_km.value)
    }
    if (odometer?.result?.odometer_km?.value != null) {
      prefill.odometer_km = String(odometer.result.odometer_km.value)
    }

    // Compute flags
    const flags: BatchFlag[] = []
    if (errors.length > 0)   flags.push('scan_failed')
    if (unknowns.length > 0) flags.push('not_fuel_photo')
    if (receipt && !odometer && errors.length === 0)  flags.push('unpaired_receipt')
    if (!receipt && odometer)                         flags.push('unpaired_odometer')
    if (receipts.length > 1 || odometers.length > 1) flags.push('multi_image_day')
    if (existingDates.has(date))                      flags.push('possible_duplicate')

    if (receipt?.result?.fields) {
      const f = receipt.result.fields
      const hasDate  = !!f.date?.value
      const hasValue = f.volume_l?.value != null || f.price_per_l?.value != null || f.total_cost?.value != null
      if (!hasDate || !hasValue) flags.push('missing_fields')

      const keyFields = ['volume_l', 'price_per_l', 'total_cost'] as const
      if (keyFields.some(k => f[k]?.confidence === 'low')) flags.push('low_confidence')

      const L = Number(f.volume_l?.value)
      const P = Number(f.price_per_l?.value)
      const T = Number(f.total_cost?.value)
      if (L > 0 && P > 0 && T > 0 && Math.abs(L * P - T) / T > 0.02) flags.push('math_mismatch')
    }

    return {
      id: crypto.randomUUID(),
      date, receipt, odometer, extras, flags, prefill,
      reviewStatus: flags.length === 0 ? 'approved' : 'needs_review',
      editedPrefill: {},
    } satisfies BatchPair
  }).sort((a, b) => a.date.localeCompare(b.date))
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem',
}
const INPUT: React.CSSProperties = {
  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 5,
  color: 'var(--text)', padding: '5px 8px', fontSize: '0.8rem',
  width: '100%', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.6rem', color: 'var(--sub)',
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3,
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FlagBadge({ flag }: { flag: BatchFlag }) {
  const { label, color } = FLAG_META[flag]
  return (
    <span style={{
      background: color + '18', color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: '2px 7px', fontSize: '0.65rem', fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function StatusPill({ item }: { item: BatchItem }) {
  if (item.status === 'pending')  return <span style={{ fontSize: '0.6rem', color: 'var(--sub)', background: 'var(--bg3)', borderRadius: 10, padding: '1px 6px' }}>Pending</span>
  if (item.status === 'scanning') return <span style={{ fontSize: '0.6rem', color: 'var(--amber)', background: 'var(--amber)18', borderRadius: 10, padding: '1px 6px' }}>Scanning…</span>
  if (item.status === 'error')    return <span style={{ fontSize: '0.6rem', color: '#ef4444', background: '#ef444418', borderRadius: 10, padding: '1px 6px' }}>Error</span>
  if (item.imageType === 'receipt')  return <span style={{ fontSize: '0.6rem', color: '#22c55e', background: '#22c55e18', borderRadius: 10, padding: '1px 6px' }}>Receipt</span>
  if (item.imageType === 'odometer') return <span style={{ fontSize: '0.6rem', color: '#3b82f6', background: '#3b82f618', borderRadius: 10, padding: '1px 6px' }}>Odometer</span>
  return <span style={{ fontSize: '0.6rem', color: '#f59e0b', background: '#f59e0b18', borderRadius: 10, padding: '1px 6px' }}>Unknown</span>
}

function Thumb({ item, maxH = 120 }: { item: BatchItem; maxH?: number }) {
  const [imgErr, setImgErr] = useState(false)
  return (
    <div style={{ position: 'relative', flex: '1 1 0', minWidth: 80 }}>
      {imgErr ? (
        <div style={{
          width: '100%', height: maxH, background: 'var(--bg3)', borderRadius: 6,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          <span style={{ fontSize: '1.25rem' }}>🚫</span>
          <span style={{ fontSize: '0.55rem', color: 'var(--sub)', textAlign: 'center', padding: '0 4px' }}>
            Cannot preview — use JPEG/PNG
          </span>
        </div>
      ) : (
        <img
          src={item.previewUrl}
          alt=""
          onError={() => setImgErr(true)}
          style={{ width: '100%', height: maxH, objectFit: 'cover', borderRadius: 6, display: 'block', background: 'var(--bg3)' }}
        />
      )}
      <div style={{ position: 'absolute', bottom: 4, left: 4 }}>
        <StatusPill item={item} />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  vehicleId: string
  onSaved: (count: number) => void
}

export default function BatchScan({ vehicleId, onSaved }: Props) {
  const [items,         setItems]         = useState<BatchItem[]>([])
  const [pairs,         setPairs]         = useState<BatchPair[]>([])
  const [phase,         setPhase]         = useState<'upload' | 'scanning' | 'review' | 'saving'>('upload')
  const [scanDone,      setScanDone]      = useState(false)
  const [existingDates, setExistingDates] = useState<Set<string>>(new Set())
  const [dragOver,      setDragOver]      = useState(false)
  const [saveError,     setSaveError]     = useState<string | null>(null)

  const itemsRef   = useRef<BatchItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch existing fuel entry dates for duplicate detection
  useEffect(() => {
    supabase.from('fuel_entries').select('date').eq('vehicle_id', vehicleId)
      .then(({ data }) => { if (data) setExistingDates(new Set(data.map(e => e.date))) })
  }, [vehicleId])

  // ── Item state helper ──────────────────────────────────────────────────────

  const updateItem = useCallback((id: string, patch: Partial<BatchItem>) => {
    itemsRef.current = itemsRef.current.map(i => i.id === id ? { ...i, ...patch } : i)
    setItems([...itemsRef.current])
  }, [])

  // ── File ingestion ─────────────────────────────────────────────────────────

  async function handleFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!valid.length) return

    const newItems: BatchItem[] = await Promise.all(valid.map(async file => {
      const { date, ts } = await readExifDate(file)
      return {
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        exifDate: date,
        effectiveDate: date,
        effectiveTs: ts,
        status: 'pending',
        imageType: null,
        result: null,
        error: null,
        retryCount: 0,
      } satisfies BatchItem
    }))

    itemsRef.current = [...itemsRef.current, ...newItems]
    setItems([...itemsRef.current])
  }

  // ── Queue processing ───────────────────────────────────────────────────────

  async function processItem(item: BatchItem) {
    updateItem(item.id, { status: 'scanning' })
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callAutoScan(item.file)
        updateItem(item.id, { status: 'done', imageType: result.imageType, result, retryCount: attempt })
        return
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          updateItem(item.id, {
            status: 'error', imageType: null,
            error: err instanceof Error ? err.message : String(err),
            retryCount: attempt,
          })
        } else {
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 1500))
        }
      }
    }
  }

  async function startScan() {
    if (!itemsRef.current.length) return
    setPhase('scanning')

    const pending = [...itemsRef.current]
    let idx = 0

    await new Promise<void>(resolve => {
      let active = 0
      function dispatch() {
        if (idx >= pending.length && active === 0) { resolve(); return }
        while (active < CONCURRENCY && idx < pending.length) {
          const item = pending[idx++]
          active++
          processItem(item).finally(() => { active--; dispatch() })
        }
      }
      dispatch()
    })

    setScanDone(true)
    // Don't auto-advance — let user review errors on thumbnails before proceeding
  }

  function proceedToReview() {
    const built = buildPairs(itemsRef.current, existingDates)
    setPairs(built)
    setPhase('review')
  }

  // ── Retry a single errored item ────────────────────────────────────────────

  async function retryItem(itemId: string) {
    const item = itemsRef.current.find(i => i.id === itemId)
    if (!item) return
    await processItem(item)
    const built = buildPairs(itemsRef.current, existingDates)
    setPairs(built)
  }

  // ── Pair review actions ────────────────────────────────────────────────────

  function approvePair(id: string) {
    setPairs(ps => ps.map(p => p.id === id ? { ...p, reviewStatus: 'approved' } : p))
  }

  function skipPair(id: string) {
    setPairs(ps => ps.map(p => p.id === id ? { ...p, reviewStatus: 'skipped' } : p))
  }

  function editField(pairId: string, field: keyof ScanPrefill, value: string) {
    setPairs(ps => ps.map(p => p.id === pairId
      ? { ...p, editedPrefill: { ...p.editedPrefill, [field]: value } }
      : p
    ))
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveError(null)
    setPhase('saving')
    const toSave = pairs.filter(p => p.reviewStatus === 'approved')

    const entries = toSave.map(pair => {
      const merged = { ...pair.prefill, ...pair.editedPrefill }
      return {
        vehicle_id:     vehicleId,
        date:           merged.date ?? pair.date,
        odometer_km:    merged.odometer_km ? parseInt(merged.odometer_km) : 0,
        liters:         merged.liters          ? parseFloat(merged.liters)          : null,
        price_per_liter: merged.price_per_liter ? parseFloat(merged.price_per_liter) : null,
        total_cost:     merged.total_cost      ? parseFloat(merged.total_cost)      : null,
        grade:          merged.grade  ?? null,
        station:        merged.station ?? null,
        flagged:        pair.flags.some(f => ['missing_fields', 'low_confidence', 'math_mismatch'].includes(f)),
        ocr_raw:        pair.receipt?.result ? JSON.stringify(pair.receipt.result) : null,
        ocr_meta:       { flags: pair.flags, source: 'batch_scan' },
      }
    })

    const { error } = await supabase.from('fuel_entries').insert(entries)
    if (error) {
      setSaveError(error.message)
      setPhase('review')
      return
    }
    onSaved(entries.length)
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true) }
  function onDragLeave()                   { setDragOver(false) }
  function onDrop(e: React.DragEvent)      { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }

  // ── Derived values ─────────────────────────────────────────────────────────

  const doneCount     = items.filter(i => i.status === 'done' || i.status === 'error').length
  const approvedPairs = pairs.filter(p => p.reviewStatus === 'approved')
  const reviewPairs   = pairs.filter(p => p.reviewStatus === 'needs_review')
  const skippedPairs  = pairs.filter(p => p.reviewStatus === 'skipped')

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '5rem' }}>

      {/* ── Upload phase ── */}
      {phase === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Batch Import</div>
            <div style={{ color: 'var(--sub)', fontSize: '0.8rem' }}>
              Drop all your fuel-up photos at once. Receipts and odometer photos are automatically paired by the date they were taken.
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--amber)' : 'var(--border)'}`,
              borderRadius: 12, padding: '2.5rem 1.5rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
              cursor: 'pointer', background: dragOver ? 'var(--amber)08' : 'var(--bg)',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>📦</span>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              {items.length > 0 ? `${items.length} photo${items.length !== 1 ? 's' : ''} selected` : 'Drop photos here'}
            </div>
            <div style={{ color: 'var(--sub)', fontSize: '0.78rem', textAlign: 'center' }}>
              JPEG, PNG, WEBP, HEIC · Any number · Any order<br />
              Receipt + odometer pairs are matched by photo date
            </div>
            {items.length === 0 && (
              <div style={{
                marginTop: 4, background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '6px 18px', fontSize: '0.825rem', color: 'var(--sub)',
              }}>
                or click to browse
              </div>
            )}
          </div>
          <input
            ref={fileInputRef} type="file" multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
          />

          {/* File list preview */}
          {items.length > 0 && (
            <div style={card}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
                {items.map(item => (
                  <div key={item.id} style={{ position: 'relative' }}>
                    <img
                      src={item.previewUrl}
                      alt=""
                      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, display: 'block' }}
                    />
                    <div style={{
                      position: 'absolute', bottom: 2, left: 2, right: 2,
                      fontSize: '0.55rem', color: '#fff', background: 'rgba(0,0,0,0.55)',
                      borderRadius: 3, padding: '1px 3px', textAlign: 'center',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {item.effectiveDate}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                onClick={startScan}
                style={{
                  background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6,
                  padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: '0.925rem',
                  fontFamily: 'Barlow, sans-serif',
                }}
              >
                Scan {items.length} photo{items.length !== 1 ? 's' : ''} →
              </button>
              <button
                onClick={() => { itemsRef.current = []; setItems([]) }}
                style={{
                  background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '10px 16px', cursor: 'pointer', fontSize: '0.875rem',
                  fontFamily: 'Barlow, sans-serif',
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Scanning phase ── */}
      {phase === 'scanning' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ fontWeight: 600 }}>
            Scanning… {doneCount} / {items.length}
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'var(--amber)', borderRadius: 3,
              width: `${items.length ? (doneCount / items.length) * 100 : 0}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>

          {/* Thumbnail grid */}
          <div style={card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
              {items.map(item => (
                <div key={item.id} style={{ position: 'relative' }} title={item.error ?? undefined}>
                  <img
                    src={item.previewUrl}
                    alt=""
                    style={{
                      width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, display: 'block',
                      opacity: item.status === 'pending' ? 0.45 : 1, transition: 'opacity 0.2s',
                      outline: item.status === 'error' ? '2px solid #ef4444' : 'none',
                    }}
                  />
                  <div style={{ position: 'absolute', bottom: 4, left: 4 }}>
                    <StatusPill item={item} />
                  </div>
                  {item.status === 'error' && item.error && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      background: 'rgba(0,0,0,0.6)', borderRadius: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 4,
                    }}>
                      <span style={{ fontSize: '0.55rem', color: '#fca5a5', textAlign: 'center', wordBreak: 'break-word' }}>
                        {item.error.slice(0, 60)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {!scanDone && (
            <div style={{ color: 'var(--sub)', fontSize: '0.78rem' }}>
              Processing {CONCURRENCY} at a time. Failed scans retry once automatically.
            </div>
          )}

          {/* Scan complete summary — stays visible until user advances */}
          {scanDone && (() => {
            const errored = items.filter(i => i.status === 'error')
            const succeeded = items.filter(i => i.status === 'done')
            const uniqueErrors = [...new Set(errored.map(i => i.error ?? 'Unknown error'))]
            return (
              <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  Scan complete — {succeeded.length} of {items.length} succeeded
                </div>
                {errored.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {uniqueErrors.map((msg, i) => (
                      <div key={i} style={{ fontSize: '0.78rem', color: '#ef4444', display: 'flex', gap: '0.4rem' }}>
                        <span>✗</span>
                        <span>{errored.filter(e => e.error === msg).length}× {msg}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={proceedToReview}
                  style={{
                    alignSelf: 'flex-start', background: 'var(--amber)', color: '#000',
                    border: 'none', borderRadius: 6, padding: '8px 20px',
                    cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', fontFamily: 'Barlow, sans-serif',
                  }}
                >
                  View Results →
                </button>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Review phase ── */}
      {(phase === 'review' || phase === 'saving') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Summary header */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>
              {items.length} photos · {pairs.length} date{pairs.length !== 1 ? 's' : ''}
            </div>
            {reviewPairs.length > 0 && (
              <span style={{ background: '#ef444418', color: '#ef4444', border: '1px solid #ef444433', borderRadius: 10, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600 }}>
                {reviewPairs.length} need{reviewPairs.length === 1 ? 's' : ''} review
              </span>
            )}
            {approvedPairs.length > 0 && (
              <span style={{ background: '#22c55e18', color: '#22c55e', border: '1px solid #22c55e33', borderRadius: 10, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600 }}>
                {approvedPairs.length} ready to save
              </span>
            )}
          </div>

          {saveError && (
            <div style={{ ...card, border: '1px solid #ef444444', color: '#ef4444', fontSize: '0.875rem' }}>
              Save failed: {saveError}
            </div>
          )}

          {/* ── Review Required section ── */}
          {reviewPairs.length > 0 && (
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
                Review Required ({reviewPairs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {reviewPairs.map(pair => <ReviewCard key={pair.id} pair={pair} onApprove={approvePair} onSkip={skipPair} onEdit={editField} onRetry={retryItem} />)}
              </div>
            </div>
          )}

          {/* ── Ready to Save section ── */}
          {approvedPairs.length > 0 && (
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
                Ready to Save ({approvedPairs.length})
              </div>
              <div style={card}>
                {approvedPairs.map((pair, i) => {
                  const merged = { ...pair.prefill, ...pair.editedPrefill }
                  return (
                    <div key={pair.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.55rem 0',
                      borderBottom: i < approvedPairs.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--sub)', fontSize: '0.75rem', fontFamily: 'DM Mono, monospace' }}>{pair.date}</span>
                        {merged.station && <span style={{ fontSize: '0.82rem' }}>{merged.station}</span>}
                        {merged.grade && (
                          <span style={{ background: 'var(--bg3)', borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', color: 'var(--sub)' }}>
                            {merged.grade}
                          </span>
                        )}
                        {merged.odometer_km && (
                          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.75rem', color: 'var(--sub)' }}>
                            {parseInt(merged.odometer_km).toLocaleString()} km
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {merged.total_cost && (
                          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1.25rem', fontWeight: 700, color: 'var(--amber)' }}>
                            ${parseFloat(merged.total_cost).toFixed(2)}
                          </span>
                        )}
                        <button
                          onClick={() => skipPair(pair.id)}
                          title="Remove from save list"
                          style={{ background: 'none', border: 'none', color: 'var(--sub)', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Skipped section (compact) */}
          {skippedPairs.length > 0 && (
            <div style={{ color: 'var(--sub)', fontSize: '0.78rem' }}>
              {skippedPairs.length} skipped ·{' '}
              <button
                onClick={() => setPairs(ps => ps.map(p => p.reviewStatus === 'skipped' ? { ...p, reviewStatus: 'needs_review' } : p))}
                style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', padding: 0, fontSize: '0.78rem' }}
              >
                Undo all skips
              </button>
            </div>
          )}

        </div>
      )}

      {/* ── Sticky save bar ── */}
      {(phase === 'review' || phase === 'saving') && approvedPairs.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
          padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center',
          zIndex: 100,
        }}>
          <button
            onClick={handleSave}
            disabled={phase === 'saving'}
            style={{
              background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 6,
              padding: '10px 24px', cursor: phase === 'saving' ? 'wait' : 'pointer',
              fontWeight: 700, fontSize: '0.925rem', fontFamily: 'Barlow, sans-serif',
              opacity: phase === 'saving' ? 0.7 : 1,
            }}
          >
            {phase === 'saving' ? 'Saving…' : `Save ${approvedPairs.length} fuel entr${approvedPairs.length !== 1 ? 'ies' : 'y'} →`}
          </button>
          <button
            onClick={() => setPairs(ps => ps.map(p => p.reviewStatus === 'needs_review' ? { ...p, reviewStatus: 'approved' } : p))}
            style={{
              background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '10px 14px', cursor: 'pointer', fontSize: '0.825rem',
              fontFamily: 'Barlow, sans-serif',
            }}
          >
            Approve all flagged
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── ReviewCard ────────────────────────────────────────────────────────────────

interface ReviewCardProps {
  pair: BatchPair
  onApprove: (id: string) => void
  onSkip:    (id: string) => void
  onEdit:    (pairId: string, field: keyof ScanPrefill, value: string) => void
  onRetry:   (itemId: string) => void
}

function ReviewCard({ pair, onApprove, onSkip, onEdit, onRetry }: ReviewCardProps) {
  const merged = { ...pair.prefill, ...pair.editedPrefill }
  const hasCritical = pair.flags.some(f => ['scan_failed', 'not_fuel_photo', 'unpaired_receipt', 'unpaired_odometer'].includes(f))

  return (
    <div style={{
      ...card,
      border: `1px solid ${hasCritical ? '#ef444433' : '#f59e0b33'}`,
    }}>
      {/* Flags row */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {pair.flags.map(f => <FlagBadge key={f} flag={f} />)}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* Thumbnails */}
        <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.4rem', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {pair.receipt  && <Thumb item={pair.receipt}  />}
            {pair.odometer && <Thumb item={pair.odometer} />}
            {!pair.receipt && !pair.odometer && pair.extras.map(e => <Thumb key={e.id} item={e} />)}
          </div>
          {pair.extras.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--sub)' }}>
              +{pair.extras.length} extra photo{pair.extras.length !== 1 ? 's' : ''}
            </div>
          )}
          {/* Retry button for errored items */}
          {[pair.receipt, pair.odometer, ...pair.extras]
            .filter((i): i is BatchItem => !!i && i.status === 'error')
            .map(item => (
              <button
                key={item.id}
                onClick={() => onRetry(item.id)}
                style={{
                  background: 'transparent', border: '1px solid var(--border)', borderRadius: 5,
                  color: 'var(--sub)', fontSize: '0.72rem', cursor: 'pointer', padding: '3px 10px',
                }}
              >
                ↺ Retry scan
              </button>
            ))
          }
        </div>

        {/* Editable fields */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 0.6rem' }}>
            <div>
              <label style={LABEL}>Date</label>
              <input type="date" style={INPUT} value={merged.date ?? ''} onChange={e => onEdit(pair.id, 'date', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Odometer (km)</label>
              <input type="number" style={INPUT} value={merged.odometer_km ?? ''} placeholder="e.g. 145230" onChange={e => onEdit(pair.id, 'odometer_km', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={LABEL}>Station</label>
              <input type="text" style={INPUT} value={merged.station ?? ''} placeholder="e.g. Petro-Canada" onChange={e => onEdit(pair.id, 'station', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Grade</label>
              <select style={INPUT} value={merged.grade ?? ''} onChange={e => onEdit(pair.id, 'grade', e.target.value)}>
                <option value="">—</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>Litres</label>
              <input type="number" step="0.001" style={INPUT} value={merged.liters ?? ''} placeholder="e.g. 48.312" onChange={e => onEdit(pair.id, 'liters', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Price / Litre</label>
              <input type="number" step="0.001" style={INPUT} value={merged.price_per_liter ?? ''} placeholder="e.g. 1.649" onChange={e => onEdit(pair.id, 'price_per_liter', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Total ($)</label>
              <input type="number" step="0.01" style={INPUT} value={merged.total_cost ?? ''} placeholder="e.g. 79.62" onChange={e => onEdit(pair.id, 'total_cost', e.target.value)} />
            </div>
          </div>

          {/* Unknown photo reason */}
          {pair.extras.filter(e => e.imageType === 'unknown' && e.result?.reason).map(e => (
            <div key={e.id} style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--sub)', fontStyle: 'italic' }}>
              Unrecognized: {e.result!.reason}
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
        <button
          onClick={() => onApprove(pair.id)}
          style={{
            background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 5,
            padding: '7px 18px', cursor: 'pointer', fontWeight: 700, fontSize: '0.825rem',
            fontFamily: 'Barlow, sans-serif',
          }}
        >
          Approve
        </button>
        <button
          onClick={() => onSkip(pair.id)}
          style={{
            background: 'transparent', color: 'var(--sub)', border: '1px solid var(--border)',
            borderRadius: 5, padding: '7px 14px', cursor: 'pointer', fontSize: '0.825rem',
            fontFamily: 'Barlow, sans-serif',
          }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
