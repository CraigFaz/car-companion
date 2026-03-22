export interface Vehicle {
  id: string
  name: string
  year: number
  make: string
  model: string
  trim: string | null
  color: string | null
  vin: string | null
  plate: string | null
  odometer_km: number
  notes: string | null
}

export interface FuelEntry {
  id: string
  vehicle_id: string
  date: string
  odometer_km: number
  liters: number | null
  price_per_liter: number | null
  total_cost: number | null
  grade: string | null
  station: string | null
  flagged: boolean
  notes: string | null
  ocr_raw: string | null
  ocr_meta: Record<string, unknown> | null
}

export interface MaintenanceRecord {
  id: string
  vehicle_id: string
  date: string
  odometer_km: number | null
  category: string
  description: string
  cost: number | null
  shop: string | null
  notes: string | null
}

export interface RepairItem {
  id: string
  repair_entry_id: string
  type: string
  description: string
  parts: string | null
  cost: number | null
  warranty: string | null
  interval_km: number | null
  interval_months: number | null
  interval_label: string | null
  sort_order: number
}

export interface RepairEntry {
  id: string
  vehicle_id: string
  date: string
  odometer_km: number | null
  shop: string | null
  labour_cost: number | null
  parts_cost: number | null
  tax: number | null
  total_cost: number | null
  notes: string | null
  repair_items: RepairItem[]
}

export interface OilTopup {
  id: string
  vehicle_id: string
  date: string
  odometer_km: number | null
  amount_liters: number
  brand: string | null
  notes: string | null
}

// ── Batch scan ────────────────────────────────────────────────────────────────

export interface AutoScanResult {
  imageType: 'receipt' | 'odometer' | 'unknown'
  fields?: Record<string, { value: string | number | null; confidence: 'high' | 'medium' | 'low' }>
  odometer_km?: { value: number | null; confidence: 'high' | 'medium' | 'low' }
  reason?: string
}

export interface BatchItem {
  id: string
  file: File
  previewUrl: string
  exifDate: string | null
  effectiveDate: string
  effectiveTs: number
  status: 'pending' | 'scanning' | 'done' | 'error'
  imageType: 'receipt' | 'odometer' | 'unknown' | null
  result: AutoScanResult | null
  error: string | null
  retryCount: number
}

export type BatchFlag =
  | 'unpaired_receipt'
  | 'unpaired_odometer'
  | 'missing_fields'
  | 'low_confidence'
  | 'math_mismatch'
  | 'scan_failed'
  | 'multi_image_day'
  | 'not_fuel_photo'
  | 'possible_duplicate'

export interface BatchPair {
  id: string
  date: string
  receipt: BatchItem | null
  odometer: BatchItem | null
  extras: BatchItem[]
  flags: BatchFlag[]
  prefill: Partial<ScanPrefill>
  reviewStatus: 'needs_review' | 'approved' | 'skipped'
  editedPrefill: Partial<ScanPrefill>
}

export interface ScanPrefill {
  date?: string
  station?: string
  grade?: string
  liters?: string
  price_per_liter?: string
  total_cost?: string
  odometer_km?: string
}

export interface Issue {
  id: string
  vehicle_id: string
  date: string
  odometer_km: number | null
  description: string
  frequency: string | null
  severity: string | null
  status: string
  resolved_date: string | null
  notes: string | null
}
