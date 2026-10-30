// DZ Marine - Bathymetry & Water Depth Engine
import { haversineDistance } from './anchor.js'

// Coastline reference points along Algeria (West to East)
// Used for offline continental shelf depth estimation
const DZ_COASTLINE = [
  { lat: 35.08, lon: -2.21 }, // Marsa Ben M'Hidi
  { lat: 35.10, lon: -1.86 }, // Ghazaouet
  { lat: 35.30, lon: -1.40 }, // Beni Saf
  { lat: 35.70, lon: -0.65 }, // Oran / Mers El Kebir
  { lat: 35.80, lon: -0.28 }, // Arzew
  { lat: 35.93, lon: 0.08 },  // Mostaganem
  { lat: 36.51, lon: 1.31 },  // Tenes
  { lat: 36.56, lon: 1.83 },  // Cherchell
  { lat: 36.60, lon: 2.44 },  // Tipaza
  { lat: 36.75, lon: 3.06 },  // Algiers
  { lat: 36.85, lon: 3.48 },  // Zemmouri
  { lat: 36.91, lon: 3.90 },  // Dellys
  { lat: 36.88, lon: 4.54 },  // Azzefoun
  { lat: 36.75, lon: 5.08 },  // Bejaia
  { lat: 36.82, lon: 5.76 },  // Jijel
  { lat: 36.90, lon: 6.90 },  // Skikda
  { lat: 36.90, lon: 7.76 },  // Annaba
  { lat: 36.90, lon: 8.44 },  // El Kala
]

// Approximate distance to closest point on Algerian coastline in km
export function getDistanceToCoastKm(lat, lon) {
  let minDist = Infinity
  for (const pt of DZ_COASTLINE) {
    const d = haversineDistance(lat, lon, pt.lat, pt.lon) / 1000
    if (d < minDist) minDist = d
  }
  return minDist
}

// Check if coordinate is in the Mediterranean Sea north of Algeria
export function isOverMediterranean(lat, lon) {
  if (lat < 35.0 || lat > 38.5) return false
  if (lon < -2.5 || lon > 9.0) return false
  
  // Find closest coast point
  let closestCoastLat = 36.5
  for (const pt of DZ_COASTLINE) {
    if (Math.abs(lon - pt.lon) < 0.5) {
      closestCoastLat = pt.lat
      break
    }
  }
  // If north of the coast, it's sea
  return lat >= closestCoastLat - 0.02
}

/**
 * Estimate or fetch depth in meters for a coordinate
 * Returns { depth: number | null, isEstimate: boolean, source: string }
 */
export async function getWaterDepth(lat, lon) {
  if (!isOverMediterranean(lat, lon)) {
    return { depth: null, isEstimate: false, source: 'land' }
  }

  // 1. Try online EMODnet Bathymetry REST API (fast point query)
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)
    
    // EMODnet point depth query: lat/lon in WGS84
    const url = `https://rest.emodnet-bathymetry.eu/depth?geom=POINT(${lon.toFixed(4)}%20${lat.toFixed(4)})`
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const data = await res.json()
      // EMODnet returns { depth: -45.5 } or { depth: 45.5 }
      if (data && typeof data.depth === 'number') {
        const d = Math.abs(data.depth)
        if (d > 0 && d < 3500) {
          return { depth: Math.round(d * 10) / 10, isEstimate: false, source: 'EMODnet' }
        }
      }
    }
  } catch (err) {
    // Fall through to offline model
  }

  // 2. Offline Mediterranean Continental Shelf Model (Algerian Coast)
  // Distance from coast in km
  const distKm = getDistanceToCoastKm(lat, lon)
  
  let depth = 5
  if (distKm <= 0.3) {
    depth = 3 + distKm * 30 // 3m to 12m
  } else if (distKm <= 1.0) {
    depth = 12 + (distKm - 0.3) * 35 // 12m to 36m (diving & rock zone)
  } else if (distKm <= 3.0) {
    depth = 36 + (distKm - 1.0) * 45 // 36m to 126m (tombants & coastal shelf)
  } else if (distKm <= 6.0) {
    depth = 126 + (distKm - 3.0) * 110 // 126m to 450m (drop-off)
  } else if (distKm <= 15.0) {
    depth = 450 + (distKm - 6.0) * 120 // 450m to 1500m (deep offshore)
  } else {
    depth = Math.min(2700, 1500 + (distKm - 15.0) * 60)
  }

  // Round reasonably
  const rounded = depth < 50 ? Math.round(depth) : Math.round(depth / 5) * 5
  return { depth: rounded, isEstimate: true, source: 'model' }
}

export function formatDepth(meters, unit = 'm') {
  if (meters === null || meters === undefined || isNaN(meters)) return '—'
  if (unit === 'fathom') {
    return `${(meters / 1.8288).toFixed(1)} fm`
  }
  return `${Math.round(meters)} m`
}
