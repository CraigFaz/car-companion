import Tesseract from 'tesseract.js'

export interface OcrResult {
  date: string
  liters: string
  price_per_liter: string
  total_cost: string
  station: string
  raw: string
}

/** Run Tesseract on an image File and return parsed fuel receipt fields */
export async function scanFuelReceipt(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<OcrResult> {
  const { data } = await Tesseract.recognize(file, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100))
      }
    },
  })

  const raw = data.text
  return { ...parse(raw), raw }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parse(text: string): Omit<OcrResult, 'raw'> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const upper = text.toUpperCase()

  return {
    liters: parseVolume(upper),
    price_per_liter: parsePricePerLiter(upper),
    total_cost: parseTotalCost(upper),
    date: parseDate(lines),
    station: parseStation(lines),
  }
}

/** Matches patterns like:  47.832L  |  47.832 L  |  VOLUME 47.832  |  LITRES 47.832 */
function parseVolume(text: string): string {
  const patterns = [
    /(\d{1,3}\.\d{3})\s*(?:LITRES?|LIT|L\b)/,
    /(?:VOLUME|VOL|QTY|LITRES?)\s*:?\s*(\d{1,3}\.\d{1,3})/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1]
  }
  return ''
}

/**
 * Matches patterns like:  1.499/L  |  149.9¢/L  |  PRICE/L 1.499  |  UNIT PRICE 1.499
 * Canadian pumps sometimes print cents (e.g. 149.9) — convert if > 10.
 */
function parsePricePerLiter(text: string): string {
  const patterns = [
    /(\d{1,3}\.\d{1,3})\s*[¢C]?\s*\/\s*L/,
    /(?:UNIT\s*PRICE|PRICE\s*\/\s*L|PER\s*LITRE?)\s*:?\s*\$?\s*(\d{1,3}\.\d{1,3})/,
    /FUEL\s+PRICE\s*:?\s*\$?\s*(\d{1,3}\.\d{1,3})/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      let val = parseFloat(m[1])
      // If value looks like cents (e.g. 149.9), convert to dollars
      if (val > 10) val = val / 100
      return val.toFixed(3)
    }
  }
  return ''
}

/** Matches patterns like:  TOTAL $74.95  |  TOTAL: 74.95  |  AMOUNT DUE 74.95 */
function parseTotalCost(text: string): string {
  const patterns = [
    /(?:TOTAL|AMOUNT\s*DUE|SALE\s*TOTAL|TRANSACTION\s*TOTAL)\s*:?\s*\$?\s*(\d{1,4}\.\d{2})/,
    /\$\s*(\d{1,4}\.\d{2})\s*(?:TOTAL|DUE)/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1]
  }
  return ''
}

function parseDate(lines: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    // YYYY-MM-DD or YYYY/MM/DD
    [/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, m => `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`],
    // MM/DD/YYYY or DD/MM/YYYY — ambiguous; assume MM/DD/YYYY for now
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
          // Basic sanity check — must be within ±5 years of today
          const yr = parseInt(result.slice(0, 4))
          const now = new Date().getFullYear()
          if (yr >= now - 5 && yr <= now + 1) return result
        } catch { /* skip */ }
      }
    }
  }

  return today
}

/** Best-effort: take the first non-numeric line as a station name */
function parseStation(lines: string[]): string {
  const skip = /^[\d\s$.,/:-]+$|RECEIPT|WELCOME|THANK|CUSTOMER|TRANSACTION|PUMP|GRADE/i
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 3 && !skip.test(line)) return line
  }
  return ''
}
