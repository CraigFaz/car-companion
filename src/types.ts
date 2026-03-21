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
