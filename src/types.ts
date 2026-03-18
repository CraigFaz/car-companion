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
  liters: number
  price_per_liter: number
  total_cost: number
  station: string | null
  full_tank: boolean
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
