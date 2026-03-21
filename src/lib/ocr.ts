import Tesseract from 'tesseract.js'
import heic2any from 'heic2any'

export interface OcrResult {
  date: string
  liters: string
  price_per_liter: string
  total_cost: string
  station: string
  raw: string
}

export interface OdometerResult {
  odometer_km: string
  raw: string
}

/**
 * Convert HEIC/HEIF files (iPhone default format) to JPEG before OCR,
 * since browsers cannot decode HEIC natively. Other formats pass through.
 */
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

/** Run Tesseract on an image File and return parsed fuel receipt fields */
export async function scanFuelReceipt(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<OcrResult> {
  const { data } = await runOcr(file, onProgress)
  const raw = data.text
  return { ...parseReceipt(raw), raw }
}

/**
 * Run Tesseract on a dashboard/odometer photo and return the odometer reading.
 *
 * Strategy:
 * 1. Prefer numbers immediately after an ODO/ODOMETER label.
 * 2. Otherwise pick the largest 5–6 digit number in a plausible km range (10 000–999 999).
 * 3. Strip commas/spaces from digit groups (e.g. "272 500" or "272,500").
 */
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

  // Try to pull litres + price from the Esso-style combined line first:
  //   "58.317L AT $1.649/L"
  const combo = parseComboLine(upper)

  return {
    liters: combo.liters || parseVolume(upper),
    price_per_liter: combo.price_per_liter || parsePricePerLiter(upper),
    total_cost: parseTotalCost(upper),
    date: parseDate(lines),
    station: parseStation(lines),
  }
}

/**
 * Esso (and many Canadian pumps) print one line like:
 *   58.317L AT $1.649/L
 * Pull both values at once so a single clear line fills two fields.
 */
function parseComboLine(upper: string): { liters: string; price_per_liter: string } {
  const m = upper.match(/(\d{1,3}\.\d{3})L?\s+AT\s+\$?(\d{1,3}\.\d{3})\/L/)
  if (m) return { liters: m[1], price_per_liter: m[2] }
  return { liters: '', price_per_liter: '' }
}

/** Matches patterns like:  47.832L  |  47.832 L  |  VOLUME 47.832  |  LITRES 47.832 */
function parseVolume(upper: string): string {
  const patterns = [
    /(\d{1,3}\.\d{3})\s*(?:LITRES?|LIT|L\b)/,
    /(?:VOLUME|VOL|QTY|LITRES?)\s*:?\s*(\d{1,3}\.\d{1,3})/,
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) return m[1]
  }
  return ''
}

/**
 * Matches patterns like:  1.499/L  |  149.9¢/L  |  UNIT PRICE 1.499
 * Canadian pumps sometimes print cents (e.g. 149.9) — convert if > 10.
 */
function parsePricePerLiter(upper: string): string {
  const patterns = [
    /AT\s+\$?(\d{1,3}\.\d{3})\/L/,                                           // "AT $1.649/L"
    /(\d{1,3}\.\d{3})\/L/,                                                    // bare "1.649/L"
    /(?:UNIT\s*PRICE|PRICE\s*\/\s*L|PER\s*LITRE?)\s*:?\s*\$?\s*(\d{1,3}\.\d{1,3})/,
    /FUEL\s+PRICE\s*:?\s*\$?\s*(\d{1,3}\.\d{1,3})/,
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) {
      let val = parseFloat(m[1])
      if (val > 10) val = val / 100 // cents → dollars
      return val.toFixed(3)
    }
  }
  return ''
}

/**
 * Matches patterns like:
 *   TOTAL : CAD$ 96.16   (Esso Canada)
 *   TOTAL $74.95
 *   AMOUNT DUE 74.95
 */
function parseTotalCost(upper: string): string {
  const patterns = [
    // Handle optional currency code (CAD, USD, etc.) between label and amount
    /(?:TOTAL|AMOUNT\s*DUE|SALE\s*TOTAL|TRANSACTION\s*TOTAL)\s*:?\s*(?:[A-Z]{2,3})?\s*\$?\s*(\d{1,4}\.\d{2})/,
    /\$\s*(\d{1,4}\.\d{2})\s*(?:TOTAL|DUE)/,
    // Esso "EREG $ 96.16" — grade code followed by total
    /^E?REG\s+\$\s*(\d{1,4}\.\d{2})/m,
  ]
  for (const p of patterns) {
    const m = upper.match(p)
    if (m) return m[1]
  }
  return ''
}

function parseDate(lines: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    // YYYY-MM-DD (with optional time after — Esso format "2026-03-19 16:31:40")
    [/(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+\d{2}:\d{2})?/, m => `${m[1]}-${m[2]}-${m[3]}`],
    // MM/DD/YYYY
    [/(\d{1,2})\/(\d{1,2})\/(\d{4})/, m => `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`],
    // DD-MMM-YYYY (e.g. 21-MAR-2026)
    [/(\d{1,2})[-\s]([A-Z]{3})[-\s](\d{4})/i, m => {
      const months: Record<string,string> = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' }
      const mo = months[m[2].toUpperCase()] || '01'
      return `${m[3]}-${mo}-${m[1].padStart(2,'0')}`
    }],
  ]

  for (const line of lines) {
    for (const [p, fmt] of patterns) {
      const m = line.match(p)
      if (m) {
        try {
          const result = fmt(m)
          const yr = parseInt(result.slice(0, 4))
          const now = new Date().getFullYear()
          if (yr >= now - 5 && yr <= now + 1) return result
        } catch { /* skip */ }
      }
    }
  }

  return today
}

/** Best-effort: take the first non-numeric, non-junk line as a station name */
function parseStation(lines: string[]): string {
  const skip = /^[\d\s$.,/*:-]+$|RECEIPT|WELCOME|THANK|CUSTOMER|TRANSACTION|PUMP|GRADE|EXPRESS|PAY/i
  for (const line of lines.slice(0, 10)) {
    if (line.length >= 3 && !skip.test(line)) return line
  }
  return ''
}

// ---------------------------------------------------------------------------
// Odometer parsing
// ---------------------------------------------------------------------------

function parseOdometer(text: string): string {
  const upper = text.toUpperCase()

  // 1. Best signal: a 5-6 digit number immediately followed by "km" on the display
  //    e.g. "272480 km" or "272 480 km" or "272,480km"
  //    Also handles dot-matrix OCR noise where a space may appear mid-number.
  const beforeKm = upper.match(/(\d[\d\s,]{4,7})\s*KM\b/)
  if (beforeKm) {
    const v = beforeKm[1].replace(/[\s,]/g, '')
    const n = parseInt(v, 10)
    if (n >= 10_000 && n <= 999_999) return String(n)
  }

  // 2. Number right after an ODO/ODOMETER label
  const labeled = upper.match(/(?:ODO(?:METER)?|MILEAGE)\s*[:\s]\s*([\d][\d\s,]{4,7})/)
  if (labeled) {
    const v = labeled[1].replace(/[\s,]/g, '')
    const n = parseInt(v, 10)
    if (n >= 10_000 && n <= 999_999) return String(n)
  }

  // 3. Fall back: largest standalone 5–6 digit number in plausible range
  const normalised = text.replace(/,/g, '').replace(/(\d)\s(\d)/g, '$1$2')
  const candidates: number[] = []
  for (const m of normalised.matchAll(/\b(\d{5,6})\b/g)) {
    const n = parseInt(m[1], 10)
    if (n >= 10_000 && n <= 999_999) candidates.push(n)
  }
  if (candidates.length === 0) return ''
  return String(Math.max(...candidates))
}
