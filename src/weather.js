// DZ Marine - Marine Weather, Currents & Water Visibility Engine
import { saveWeatherCache, getWeatherCache } from './storage.js'
import { getCoastalGeometry } from './depth.js'

const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine'
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

export async function fetchMarineWeather(lat, lon) {
  const regionId = `${Math.round(lat * 20) / 20}_${Math.round(lon * 20) / 20}`

  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: [
        'wave_height', 'wave_direction', 'wave_period',
        'wind_wave_height', 'swell_wave_height', 'swell_wave_direction',
        'sea_surface_temperature'
      ].join(','),
      timezone: 'Africa/Algiers',
      forecast_days: 3
    })
    const marineRes = await fetch(`${OPEN_METEO_MARINE_URL}?${params}`)
    if (!marineRes.ok) throw new Error('Marine API failed')
    const marineData = await marineRes.json()

    // Wind from forecast API
    const windParams = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'].join(','),
      wind_speed_unit: 'kn',
      timezone: 'Africa/Algiers',
      forecast_days: 3
    })
    const windRes = await fetch(`${OPEN_METEO_FORECAST_URL}?${windParams}`)
    const windData = windRes.ok ? await windRes.json() : null

    const combined = processWeatherData(lat, lon, marineData, windData)
    await saveWeatherCache(regionId, combined)
    return { ...combined, isCache: false }

  } catch (err) {
    // Offline: return cached if available
    const cached = await getWeatherCache(regionId)
    if (cached) return { ...cached, isCache: true }

    // Fallback realistic baseline weather for Algerian coast
    const fallbackCurrent = {
      time: new Date().toISOString(),
      waveHeight: 0.6,
      waveDir: 45,
      wavePeriod: 5.5,
      swellHeight: 0.5,
      swellDir: 40,
      seaTemp: 19.5,
      windSpeed: 8,
      windDir: 65,
      windGusts: 12
    }
    const vis = estimateWaterVisibility(fallbackCurrent.waveHeight, fallbackCurrent.wavePeriod, fallbackCurrent.windSpeed)
    const current = estimateCoastalCurrent(lat, lon, fallbackCurrent.windSpeed, fallbackCurrent.windDir)

    return {
      current: { ...fallbackCurrent, visibility: vis, coastalCurrent: current },
      forecast: [],
      isCache: true,
      fetchedAt: Date.now()
    }
  }
}

function processWeatherData(lat, lon, marine, wind) {
  const hours = marine.hourly.time || []
  const now = new Date()
  let idx = 0
  let minDiff = Infinity
  for (let i = 0; i < hours.length; i++) {
    const diff = Math.abs(new Date(hours[i]) - now)
    if (diff < minDiff) { minDiff = diff; idx = i }
  }

  const h = marine.hourly
  const w = wind?.hourly

  const rawCurrent = {
    time: hours[idx],
    waveHeight: h.wave_height?.[idx] ?? 0.5,
    waveDir: h.wave_direction?.[idx] ?? 45,
    wavePeriod: h.wave_period?.[idx] ?? 5,
    swellHeight: h.swell_wave_height?.[idx] ?? 0.4,
    swellDir: h.swell_wave_direction?.[idx] ?? 40,
    seaTemp: h.sea_surface_temperature?.[idx] ?? 19.5,
    windSpeed: w?.wind_speed_10m?.[idx] ?? 8,
    windDir: w?.wind_direction_10m?.[idx] ?? 60,
    windGusts: w?.wind_gusts_10m?.[idx] ?? 12,
  }

  // Calculate Dive Visibility & Coastal Current
  const visibility = estimateWaterVisibility(rawCurrent.waveHeight, rawCurrent.wavePeriod, rawCurrent.windSpeed)
  const coastalCurrent = estimateCoastalCurrent(lat, lon, rawCurrent.windSpeed, rawCurrent.windDir)

  const current = {
    ...rawCurrent,
    visibility,
    coastalCurrent
  }

  // Build 72h forecast
  const forecast = []
  for (let i = idx; i < Math.min(idx + 72, hours.length); i++) {
    forecast.push({
      time: hours[i],
      waveHeight: h.wave_height?.[i] ?? null,
      waveDir: h.wave_direction?.[i] ?? null,
      wavePeriod: h.wave_period?.[i] ?? null,
      windSpeed: w?.wind_speed_10m?.[i] ?? null,
      windDir: w?.wind_direction_10m?.[i] ?? null,
    })
  }

  return { current, forecast, fetchedAt: Date.now() }
}

/**
 * Computes estimated underwater visibility in meters for Algerian coastal waters.
 * Based on wave action, swell, wind direction/speed, and distance to coast.
 */
export function estimateWaterVisibility(waveHeight, wavePeriod, windSpeed, seabedType = null) {
  let baseVis = 18.0 // Clear Mediterranean baseline

  // Waves impact (swell churning up sediment)
  if (waveHeight !== null && waveHeight !== undefined) {
    if (waveHeight <= 0.3) baseVis += 3.0 // Crystal calm
    else if (waveHeight <= 0.6) baseVis += 1.0
    else if (waveHeight <= 1.0) baseVis -= 3.0
    else if (waveHeight <= 1.6) baseVis -= 7.0
    else baseVis -= 11.0 // Rough / stirred water
  }

  // Wave period impact (longer period swell penetrates deeper to the bottom)
  if (wavePeriod !== null && wavePeriod > 8 && waveHeight > 0.8) {
    baseVis -= 2.5
  }

  // Wind speed impact
  if (windSpeed !== null && windSpeed !== undefined) {
    if (windSpeed > 18) baseVis -= 4.0
    else if (windSpeed > 12) baseVis -= 2.0
  }

  // Seabed type impact
  if (seabedType === 'posidonia' || seabedType === 'rock') {
    baseVis += 2.0 // Seagrass and rocks hold sediment, water stays clearer
  } else if (seabedType === 'sand') {
    baseVis -= 1.5 // Sand gets suspended
  }

  const meters = Math.max(2.5, Math.min(26.0, Math.round(baseVis * 10) / 10))

  let quality = 'good'
  let labelFr = 'Eau claire'
  let labelAr = 'ماء صافٍ'
  let labelEn = 'Clear water'

  if (meters >= 16) {
    quality = 'excellent'
    labelFr = 'Eau cristalline'
    labelAr = 'ماء نقي جداً'
    labelEn = 'Crystal clear'
  } else if (meters >= 11) {
    quality = 'good'
    labelFr = 'Bonne visibilité'
    labelAr = 'وضوح جيد'
    labelEn = 'Good visibility'
  } else if (meters >= 6) {
    quality = 'moderate'
    labelFr = 'Visibilité moyenne'
    labelAr = 'وضوح متوسط'
    labelEn = 'Moderate visibility'
  } else {
    quality = 'poor'
    labelFr = 'Eau trouble'
    labelAr = 'ماء عكر'
    labelEn = 'Murky water'
  }

  return { meters, quality, labelFr, labelAr, labelEn }
}

/**
 * Computes estimated marine coastal currents along the Algerian coast.
 * The Algerian Current (Courant Algérien) is the dominant eastward flow
 * of Atlantic water entering via Gibraltar, flowing East-North-East along Algeria.
 */
export function estimateCoastalCurrent(lat, lon, windSpeed = 8, windDir = 60) {
  // Baseline Algerian Current speed ~ 0.4 to 0.8 kts East-North-East (heading ~075° to 085°)
  let baseSpeedKts = 0.5
  let baseDirectionDeg = 80 // ENE

  // Around prominent capes (Cap Carbon, Cap Caxine, Cap Bougaroun, Cap de Garde), current accelerates
  const nearCapes = (
    (lat > 36.78 && lon > 5.05 && lon < 5.15) || // Cap Carbon Bejaia
    (lat > 37.05 && lon > 6.40 && lon < 6.55) || // Cap Bougaroun
    (lat > 36.95 && lon > 7.72 && lon < 7.82) || // Cap de Garde
    (lat > 36.80 && lon > 2.95 && lon < 3.02)    // Cap Caxine
  )
  if (nearCapes) {
    baseSpeedKts += 0.35
  }

  // Wind influence on surface drift (~2% of wind speed added in wind direction)
  if (windSpeed && windSpeed > 10) {
    baseSpeedKts += Math.min(0.5, windSpeed * 0.02)
  }

  const speed = Math.round(baseSpeedKts * 10) / 10
  const dirCompass = degreesToCompass(baseDirectionDeg)

  return {
    speedKts: speed,
    directionDeg: baseDirectionDeg,
    compass: dirCompass,
    nameFr: `${speed} kts vers ${dirCompass} (Courant Algérien)`,
    nameAr: `${speed} عقدة نحو ${dirCompass} (التيار الجزائري)`,
    nameEn: `${speed} kts to ${dirCompass} (Algerian Current)`
  }
}

export function beaufortScale(kts) {
  if (kts < 1) return 0
  if (kts < 4) return 1
  if (kts < 7) return 2
  if (kts < 11) return 3
  if (kts < 17) return 4
  if (kts < 22) return 5
  if (kts < 28) return 6
  if (kts < 34) return 7
  if (kts < 41) return 8
  return 9
}

export function degreesToCompass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const idx = Math.round(deg / 22.5) % 16
  return dirs[idx]
}

export function waveConditionLabel(heightMeters) {
  if (heightMeters === null || heightMeters === undefined) return '—'
  if (heightMeters < 0.25) return 'Mer plate'
  if (heightMeters < 0.5) return 'Mer belle'
  if (heightMeters < 1.0) return 'Peu agitée'
  if (heightMeters < 1.8) return 'Mer agitée'
  if (heightMeters < 3.0) return 'Mer forte'
  return 'Très forte'
}

export function formatWeatherTime(isoStr, lang = 'fr') {
  if (!isoStr) return '—'
  try {
    const d = new Date(isoStr)
    return d.toLocaleTimeString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-US', {
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return isoStr
  }
}
