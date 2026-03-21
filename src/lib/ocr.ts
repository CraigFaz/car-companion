import Tesseract from 'tesseract.js'
import heic2any from 'heic2any'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Fields that map directly to fuel_entries columns */
export interface OcrResult {
  date: string
  liters: string
  price_per_liter: string
  total_cost: string
  station: string
  grade: string          // normalised to app grade strings, e.g. "Regular 87"
  /** All extra fields extracted from the receipt that have no dedicated column */
  meta: OcrMeta
  raw: string
}

/** Extra receipt data stored in fuel_entries.ocr_meta */
export interface OcrMeta {
  time?: string           // "16:31:40"
  pump?: string           // "5"
  transaction_id?: string // "577757"
  station_id?: string     // "00324241"
  hst_num?: string        // "796000008"
  gst_amount?: string     // "4.25"
  hst_amount?: string     // "6.81"
  pst_amount?: string
  address?: string        // "AYR, ON NOB 1E0"
  grade_raw?: string      // raw string before normalisation, e.g. "EREG"
  subtotal?: string
}

export interface OdometerResult {
  odometer_km: string
  raw: string
}

// ---------------------------------------------------------------------------
// HEIC → JPEG conversion (iPhone/Samsung HEIF format)
// ---------------------------------------------------------------------------

async function toJpeg(file: File): Promise<File | Blob> {
  const isHeic = file.type === 'image/heic' || file.type === 'image/heif'
    || /\.(heic|heif)$/i.test(file.name)
  if (!isHeic) return file
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  return Array.isArray(converted) ? converted[0] : converted
}

async function runOcr(file: File, onProgress?: (pct: number) => void) {
  const image = await toJpeg(file)
  return Tesseract.recognize(image, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100))
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Public scan functions
// ---------------------------------------------------------------------------

export async function scanFuelReceipt(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<OcrResult> {
  const { data } = await runOcr(file, onProgress)
  const raw = data.text
  return { ...parseReceipt(raw), raw }
}

export async function scanOdometer(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<OdometerResult> {
  const { data } = await runOcr(file, onProgress)
  const raw = data.text
  return { odometer_km: parseOdometer(raw), raw }
}

// ---------------------------------------------------------------------------
// Receipt parsing
// ---------------------------------------------------------------------------

function parseReceipt(text: string): Omit<OcrResult, 'raw'> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const upper = text.toUpperCase()

  // Try the combined "NN.NNNL AT $P.PPP/L" line first (Esso, some others)
  const combo = parseComboLine(upper)

  const gradeRaw = parseGradeRaw(upper)

  return {
    liters: combo.liters || parseVolume(upper),
    price_per_liter: combo.price_per_liter || parsePricePerLiter(upper),
    total_cost: parseTotalCost(upper),
    date: parseDate(lines),
    station: parseStation(lines),
    grade: normaliseGrade(gradeRaw),
    meta: parseMeta(lines, upper, gradeRaw),
  }
}

// ---------------------------------------------------------------------------
// Combined-line extraction
// Handles formats like:
//   Esso:         "58.317L AT $1.649/L"
//   Petro/Shell:  "58.317 L @ $1.649/L"
//   Costco:       "58.317L @ 1.649 = $96.16"
//   Generic:      "58.317 LITRES @ 1.649"
// ---------------------------------------------------------------------------

function parseComboLine(upper: string): { liters: string; price_per_liter: string } {
  const patterns = [
    // "58.317L AT $1.649/L"  or  "58.317 L @ $1.649/L"
    /(\d{1,3}\.\d{3})\s*L(?:ITRES?)?\s+(?:AT|@)\s+\$?(\d{1,3}\.\d{3})\s*\/\s*L/,
    // "58.317L @ 1.649 = $96.16"  (Costco-style)
    /(\d{1,3}\.\d{3})\s*L\s+@\s+(\d{1,3}\.\d{3})\s*=/,
    // "VOLUME 58.317  PRICE 1.649"  (some generics)
    /VOLUME\s+(\d{1,3}\.\d{3})\s+PRICE\s+(\d{1,3}\.\d{3})/,
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) return { liters: m[1], price_per_liter: m[2] }
  }
  return { liters: '', price_per_liter: '' }
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

function parseVolume(upper: string): string {
  const patterns = [
    /(\d{1,3}\.\d{3})\s*(?:LITRES?|LIT|L\b)/,
    /(?:VOLUME|VOL|QTY|LITRES?)\s*:?\s*(\d{1,3}\.\d{1,3})/,
    /(\d{1,3}\.\d{3})\s*(?:@|AT)\s+\$?\d/,   // "58.317 @ $1.6…" fallback
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) return m[1]
  }
  return ''
}

// ---------------------------------------------------------------------------
// Price per litre
// Handles: $1.649/L | 149.9¢/L | 149.9 ¢/L | PRICE/L 1.649 | AT $1.649/L
// Canadian pumps sometimes print cents — convert if > 10.
// ---------------------------------------------------------------------------

function parsePricePerLiter(upper: string): string {
  const patterns = [
    /AT\s+\$?(\d{1,3}\.\d{3})\s*\/\s*L/,                                          // AT $1.649/L
    /@\s+\$?(\d{1,3}\.\d{3})\s*\/\s*L/,                                            // @ $1.649/L
    /(\d{1,3}\.\d{3})\s*\/\s*L/,                                                   // bare 1.649/L
    /(\d{3,5}\.?\d*)\s*[¢C]\s*\/\s*L/,                                             // 149.9¢/L
    /(?:UNIT\s*PRICE|PRICE\s*\/\s*L|PER\s*LITRE?)\s*:?\s*\$?\s*(\d{1,3}\.\d{3})/,
    /FUEL\s+PRICE\s*:?\s*\$?\s*(\d{1,3}\.\d{3})/,
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) {
      let val = parseFloat(m[1])
      if (val > 10) val = val / 100   // cents → dollars
      return val.toFixed(3)
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// Total cost
// Handles: TOTAL : CAD$ 96.16 | TOTAL $96.16 | AMOUNT DUE | SUBTOTAL
// ---------------------------------------------------------------------------

function parseTotalCost(upper: string): string {
  const patterns = [
    // "TOTAL : CAD$ 96.16"  or  "TOTAL $96.16"  or  "TOTAL: 96.16"
    /(?:GRAND\s+TOTAL|TOTAL)\s*:?\s*(?:[A-Z]{2,3})?\s*\$?\s*(\d{1,4}\.\d{2})/,
    /(?:AMOUNT\s*DUE|SALE\s*TOTAL|TRANSACTION\s*TOTAL)\s*:?\s*(?:[A-Z]{2,3})?\s*\$?\s*(\d{1,4}\.\d{2})/,
    /\$\s*(\d{1,4}\.\d{2})\s*(?:TOTAL|DUE)/,
    // Esso "EREG $ 96.16" — grade code then dollar amount
    /^E?REG\s+\$\s*(\d{1,4}\.\d{2})/m,
    // Shell / Petro-Canada "SUBTOTAL  $96.16" when no TAX line follows
    /SUBTOTAL\s*:?\s*\$?\s*(\d{1,4}\.\d{2})/,
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) return m[1]
  }
  return ''
}

// ---------------------------------------------------------------------------
// Date
// Handles: YYYY-MM-DD [HH:MM:SS] | MM/DD/YYYY | DD-MMM-YYYY
// ---------------------------------------------------------------------------

function parseDate(lines: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const fmts: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+\d{2}:\d{2})?/,
      m => `${m[1]}-${m[2]}-${m[3]}`],
    [/(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      m => `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`],
    [/(\d{1,2})[-\s]([A-Z]{3})[-\s](\d{4})/i, m => {
      const mo: Record<string,string> = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'}
      return `${m[3]}-${mo[m[2].toUpperCase()]||'01'}-${m[1].padStart(2,'0')}`
    }],
  ]
  for (const line of lines) {
    for (const [p, fmt] of fmts) {
      const m = line.match(p)
      if (!m) continue
      try {
        const result = fmt(m)
        const yr = parseInt(result.slice(0, 4))
        const now = new Date().getFullYear()
        if (yr >= now - 5 && yr <= now + 1) return result
      } catch { /* skip */ }
    }
  }
  return today
}

// ---------------------------------------------------------------------------
// Station name
// ---------------------------------------------------------------------------

function parseStation(lines: string[]): string {
  const skip = /^[\d\s$.,/*:-]+$|RECEIPT|WELCOME|THANK|CUSTOMER|TRANS|PUMP|GRADE|EXPRESS\s+PAY|HST|GST|INCLUDED|STATION\s*#/i
  for (const line of lines.slice(0, 12)) {
    if (line.length >= 3 && !skip.test(line)) return line
  }
  return ''
}

// ---------------------------------------------------------------------------
// Grade detection
// Raw strings → normalised app grade labels
// ---------------------------------------------------------------------------

const GRADE_MAP: [RegExp, string][] = [
  [/PREM(?:IUM)?(?:\s*9[13])?|SUPER|E?PREM/i, 'Premium 91'],
  [/MID(?:GRADE)?|PLUS|E?MID|E?PLUS/i,          'Plus 89'],
  [/REG(?:ULAR)?|E?REG|UNL(?:EADED)?/i,          'Regular 87'],
  [/DIESEL|DSL/i,                                 'Diesel'],
]

function parseGradeRaw(upper: string): string {
  // Look for grade code on its own line or before a price/volume
  const m = upper.match(/\b(E?(?:PREM(?:IUM)?|MID(?:GRADE)?|PLUS|REG(?:ULAR)?|UNL(?:EADED)?|DIESEL|DSL|SUPER))\b/)
  return m ? m[1] : ''
}

function normaliseGrade(raw: string): string {
  if (!raw) return ''
  for (const [p, label] of GRADE_MAP) {
    if (p.test(raw)) return label
  }
  return raw  // return as-is if unrecognised
}

// ---------------------------------------------------------------------------
// Meta / overflow fields
// ---------------------------------------------------------------------------

function parseMeta(lines: string[], upper: string, gradeRaw: string): OcrMeta {
  const meta: OcrMeta = {}

  // Time (from datetime line like "2026-03-19 16:31:40")
  const timeM = upper.match(/\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/)
  if (timeM) meta.time = timeM[1]

  // Pump number
  const pumpM = upper.match(/PUMP\s*[#:]?\s*(\w+)/)
  if (pumpM) meta.pump = pumpM[1]

  // Transaction ID
  const transM = upper.match(/TRANS(?:ACTION)?\s*[#:]\s*(\d+)/)
  if (transM) meta.transaction_id = transM[1]

  // Station ID
  const stationIdM = upper.match(/STATION\s*[#:]\s*(\d+)/)
  if (stationIdM) meta.station_id = stationIdM[1]

  // HST registration number
  const hstNumM = upper.match(/HST\s*[#:]\s*(\d+)/)
  if (hstNumM) meta.hst_num = hstNumM[1]

  // GST amount
  const gstM = upper.match(/GST\s+(?:INCLUDED|AMOUNT)?\s*\$?\s*(\d{1,4}\.\d{2})/)
  if (gstM) meta.gst_amount = gstM[1]

  // HST amount (tax collected, not the registration number)
  const hstAmtM = upper.match(/HST\s+(?:INCLUDED|AMOUNT)?\s*\$?\s*(\d{1,4}\.\d{2})/)
  if (hstAmtM) meta.hst_amount = hstAmtM[1]

  // PST amount
  const pstM = upper.match(/PST\s+(?:INCLUDED|AMOUNT)?\s*\$?\s*(\d{1,4}\.\d{2})/)
  if (pstM) meta.pst_amount = pstM[1]

  // Subtotal
  const subM = upper.match(/SUBTOTAL\s*:?\s*\$?\s*(\d{1,4}\.\d{2})/)
  if (subM) meta.subtotal = subM[1]

  // Address — look for a postal-code-like line: 2-3 letters, space, 3 chars (Canadian)
  const addrLine = lines.find(l => /[A-Z]\d[A-Z]\s*\d[A-Z]\d/i.test(l))
  if (addrLine) meta.address = addrLine

  // Raw grade string before normalisation
  if (gradeRaw) meta.grade_raw = gradeRaw

  // Strip empty keys
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== '')) as OcrMeta
}

// ---------------------------------------------------------------------------
// Odometer parsing
// ---------------------------------------------------------------------------

function parseOdometer(text: string): string {
  const upper = text.toUpperCase()

  // 1. Best signal: number immediately before "km" (e.g. "272480 km")
  const beforeKm = upper.match(/(\d[\d\s,]{4,7})\s*KM\b/)
  if (beforeKm) {
    const v = beforeKm[1].replace(/[\s,]/g, '')
    const n = parseInt(v, 10)
    if (n >= 10_000 && n <= 999_999) return String(n)
  }

  // 2. Number after ODO/ODOMETER label
  const labeled = upper.match(/(?:ODO(?:METER)?|MILEAGE)\s*[:\s]\s*([\d][\d\s,]{4,7})/)
  if (labeled) {
    const v = labeled[1].replace(/[\s,]/g, '')
    const n = parseInt(v, 10)
    if (n >= 10_000 && n <= 999_999) return String(n)
  }

  // 3. Largest standalone 5–6 digit number in plausible range
  const normalised = text.replace(/,/g, '').replace(/(\d)\s(\d)/g, '$1$2')
  const candidates: number[] = []
  for (const m of normalised.matchAll(/\b(\d{5,6})\b/g)) {
    const n = parseInt(m[1], 10)
    if (n >= 10_000 && n <= 999_999) candidates.push(n)
  }
  if (candidates.length === 0) return ''
  return String(Math.max(...candidates))
}
