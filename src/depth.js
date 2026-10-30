// DZ Marine - High-Accuracy Bathymetry & Water Depth Engine for Algerian Coast
import { haversineDistance } from './anchor.js'

// High-density reference points along the entire Algerian Mediterranean coastline (West to East)
export const DZ_COASTLINE_POINTS = [
  { lat: 35.085, lon: -2.215, name: 'Marsa Ben M\'Hidi' },
  { lat: 35.105, lon: -1.860, name: 'Ghazaouet' },
  { lat: 35.180, lon: -1.650, name: 'Honaine' },
  { lat: 35.250, lon: -1.500, name: 'Plage Madagh' },
  { lat: 35.305, lon: -1.390, name: 'Beni Saf' },
  { lat: 35.430, lon: -1.220, name: 'Cap Figalo' },
  { lat: 35.620, lon: -0.980, name: 'Cap Blanc' },
  { lat: 35.720, lon: -0.850, name: 'Les Andalouses' },
  { lat: 35.750, lon: -0.730, name: 'Ain El Turk / Cap Falcon' },
  { lat: 35.740, lon: -0.680, name: 'Mers El Kebir' },
  { lat: 35.715, lon: -0.630, name: 'Port d\'Oran' },
  { lat: 35.850, lon: -0.530, name: 'Kristel' },
  { lat: 35.890, lon: -0.500, name: 'Cap Carbon (Oran)' },
  { lat: 35.860, lon: -0.310, name: 'Arzew' },
  { lat: 35.840, lon: -0.150, name: 'Golfe d\'Arzew' },
  { lat: 35.930, lon: 0.080,  name: 'Mostaganem' },
  { lat: 36.080, lon: 0.200,  name: 'Cap Ivi' },
  { lat: 36.180, lon: 0.440,  name: 'Sidi Lakhdar' },
  { lat: 36.330, lon: 0.770,  name: 'Cap Kramis' },
  { lat: 36.420, lon: 1.050,  name: 'Plage El Guelta' },
  { lat: 36.520, lon: 1.330,  name: 'Tenes' },
  { lat: 36.550, lon: 1.480,  name: 'Mainis' },
  { lat: 36.560, lon: 1.550,  name: 'Sidi Abderrahmane' },
  { lat: 36.565, lon: 1.830,  name: 'Damous' },
  { lat: 36.570, lon: 1.900,  name: 'Gouraya' },
  { lat: 36.608, lon: 2.190,  name: 'Cherchell' },
  { lat: 36.612, lon: 2.400,  name: 'Mont Chenoua' },
  { lat: 36.595, lon: 2.440,  name: 'Tipaza Port' },
  { lat: 36.620, lon: 2.550,  name: 'Ain Tagourait (Bérard)' },
  { lat: 36.635, lon: 2.650,  name: 'Bouharoun' },
  { lat: 36.640, lon: 2.700,  name: 'Bou Ismail' },
  { lat: 36.715, lon: 2.840,  name: 'Zeralda' },
  { lat: 36.760, lon: 2.850,  name: 'Sidi Fredj' },
  { lat: 36.790, lon: 2.920,  name: 'La Madrague (Ain Benian)' },
  { lat: 36.810, lon: 2.990,  name: 'Cap Caxine / Pointe Pescade' },
  { lat: 36.785, lon: 3.060,  name: 'Bab El Oued' },
  { lat: 36.760, lon: 3.070,  name: 'Port d\'Alger' },
  { lat: 36.745, lon: 3.120,  name: 'Baie d\'Alger (Hussein Dey)' },
  { lat: 36.755, lon: 3.190,  name: 'Bordj El Kiffan' },
  { lat: 36.805, lon: 3.235,  name: 'Tamentfoust (La Pérouse)' },
  { lat: 36.800, lon: 3.290,  name: 'Ain Taya' },
  { lat: 36.795, lon: 3.350,  name: 'Surcouf / Heraoua' },
  { lat: 36.760, lon: 3.470,  name: 'Boumerdes' },
  { lat: 36.800, lon: 3.580,  name: 'Zemmouri El Bahri' },
  { lat: 36.880, lon: 3.720,  name: 'Cap Djinet' },
  { lat: 36.915, lon: 3.910,  name: 'Dellys' },
  { lat: 36.890, lon: 4.120,  name: 'Tigzirt' },
  { lat: 36.900, lon: 4.420,  name: 'Azzefoun' },
  { lat: 36.905, lon: 4.760,  name: 'Cap Sigli' },
  { lat: 36.775, lon: 5.100,  name: 'Cap Carbon (Bejaia)' },
  { lat: 36.750, lon: 5.150,  name: 'Golfe de Bejaia' },
  { lat: 36.640, lon: 5.240,  name: 'Aokas' },
  { lat: 36.620, lon: 5.350,  name: 'Melbou' },
  { lat: 36.670, lon: 5.480,  name: 'Ziama Mansouriah' },
  { lat: 36.780, lon: 5.610,  name: 'El Aouana' },
  { lat: 36.820, lon: 5.770,  name: 'Jijel' },
  { lat: 36.880, lon: 6.100,  name: 'Beni Belaid' },
  { lat: 37.080, lon: 6.470,  name: 'Cap Bougaroun' },
  { lat: 37.010, lon: 6.570,  name: 'Collo' },
  { lat: 37.000, lon: 6.700,  name: 'Tamanart' },
  { lat: 36.900, lon: 6.880,  name: 'Stora' },
  { lat: 36.880, lon: 6.910,  name: 'Skikda' },
  { lat: 36.900, lon: 7.050,  name: 'Filfila' },
  { lat: 37.030, lon: 7.370,  name: 'Chetaibi' },
  { lat: 36.970, lon: 7.780,  name: 'Cap de Garde (Annaba)' },
  { lat: 36.900, lon: 7.770,  name: 'Port d\'Annaba' },
  { lat: 36.880, lon: 7.820,  name: 'Sidi Salem' },
  { lat: 36.880, lon: 7.950,  name: 'El Chatt' },
  { lat: 36.950, lon: 8.240,  name: 'Cap Rosa' },
  { lat: 36.900, lon: 8.440,  name: 'El Kala' },
  { lat: 36.930, lon: 8.650,  name: 'Oum Teboul' },
]

function distancePointToSegmentKm(pLat, pLon, aLat, aLon, bLat, bLon) {
  const dX = bLon - aLon
  const dY = bLat - aLat
  const lenSq = dX * dX + dY * dY

  if (lenSq === 0) {
    return haversineDistance(pLat, pLon, aLat, aLon) / 1000
  }

  let t = ((pLon - aLon) * dX + (pLat - aLat) * dY) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projLat = aLat + t * dY
  const projLon = aLon + t * dX

  return haversineDistance(pLat, pLon, projLat, projLon) / 1000
}

export function getCoastalGeometry(lat, lon) {
  let minDistanceKm = Infinity
  let closestSegment = null

  for (let i = 0; i < DZ_COASTLINE_POINTS.length - 1; i++) {
    const a = DZ_COASTLINE_POINTS[i]
    const b = DZ_COASTLINE_POINTS[i + 1]

    if (Math.abs(lon - a.lon) > 1.2 && Math.abs(lon - b.lon) > 1.2) continue

    const d = distancePointToSegmentKm(lat, lon, a.lat, a.lon, b.lat, b.lon)
    if (d < minDistanceKm) {
      minDistanceKm = d
      closestSegment = { a, b }
    }
  }

  if (minDistanceKm === Infinity) {
    for (const pt of DZ_COASTLINE_POINTS) {
      const d = haversineDistance(lat, lon, pt.lat, pt.lon) / 1000
      if (d < minDistanceKm) minDistanceKm = d
    }
  }

  let isSeaward = true
  if (closestSegment) {
    const { a, b } = closestSegment
    const ratio = (b.lon - a.lon) !== 0 ? (lon - a.lon) / (b.lon - a.lon) : 0
    const clampedRatio = Math.max(0, Math.min(1, ratio))
    const coastLatAtLon = a.lat + clampedRatio * (b.lat - a.lat)

    // Seaward if latitude is north of the coastline segment
    isSeaward = lat >= (coastLatAtLon - 0.0008)
  } else {
    isSeaward = lat >= 35.5
  }

  return { distanceKm: minDistanceKm, isSeaward }
}

/**
 * Checks strictly if a point is in maritime waters of the Algerian Coast.
 * Returns false if the coordinate is inland on Algerian soil.
 */
export function isWaterCoordinate(lat, lon) {
  // Algerian territorial waters bounds
  if (lat < 35.0 || lat > 38.5 || lon < -2.6 || lon > 8.8) {
    return false
  }
  const { distanceKm, isSeaward } = getCoastalGeometry(lat, lon)
  // If point is south of coast by more than 80 meters, it's strictly land!
  if (!isSeaward && distanceKm > 0.08) {
    return false
  }
  return true
}

/**
 * Get accurate hydrographic depth in meters.
 * Queries real EMODnet Bathymetry REST API with fallback to the local Algerian shelf model.
 */
export async function getWaterDepth(lat, lon) {
  const { distanceKm, isSeaward } = getCoastalGeometry(lat, lon)

  if (!isSeaward && distanceKm > 0.08) {
    return { depth: null, isEstimate: false, source: 'land', label: 'Terre' }
  }

  // 1. Live query to real official EMODnet Bathymetry REST API
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const url = `https://rest.emodnet-bathymetry.eu/depth?geom=POINT(${lon.toFixed(4)}%20${lat.toFixed(4)})`
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const data = await res.json()
      if (data && typeof data.depth === 'number') {
        const d = Math.abs(data.depth)
        if (d > 0 && !(distanceKm < 0.6 && d > 100)) {
          return { depth: Math.round(d * 10) / 10, isEstimate: false, source: 'EMODnet-Real' }
        }
      }
    }
  } catch (err) {
    // Continue to calibrated local model
  }

  // 2. High-precision Algerian continental shelf bathymetry model
  let depth = 3

  if (distanceKm <= 0.08) {
    depth = 1.5 + distanceKm * 35
  } else if (distanceKm <= 0.3) {
    depth = 4 + (distanceKm - 0.08) * 35
  } else if (distanceKm <= 0.8) {
    depth = 11 + (distanceKm - 0.3) * 36
  } else if (distanceKm <= 2.0) {
    depth = 29 + (distanceKm - 0.8) * 45
  } else if (distanceKm <= 5.0) {
    depth = 83 + (distanceKm - 2.0) * 55
  } else if (distanceKm <= 12.0) {
    depth = 248 + (distanceKm - 5.0) * 110
  } else {
    depth = Math.min(2650, 1018 + (distanceKm - 12.0) * 75)
  }

  const rounded = depth < 20 ? Math.round(depth * 10) / 10 : Math.round(depth)
  return { depth: rounded, isEstimate: true, source: 'DZ-Marine-Model' }
}

export function formatDepth(meters, unit = 'm') {
  if (meters === null || meters === undefined || isNaN(meters)) return '—'
  if (unit === 'fathom') {
    return `${(meters / 1.8288).toFixed(1)} fm`
  }
  return `${meters < 10 ? meters.toFixed(1) : Math.round(meters)} m`
}
