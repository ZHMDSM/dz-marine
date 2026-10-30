// DZ Marine - Marine Weather (Open-Meteo, no API key)
import { saveWeatherCache, getWeatherCache } from './storage.js'

const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine'
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

export async function fetchMarineWeather(lat, lon) {
  const regionId = `${Math.round(lat * 10) / 10}_${Math.round(lon * 10) / 10}`

  // Try live fetch first
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

    const combined = processWeatherData(marineData, windData)
    await saveWeatherCache(regionId, combined)
    return { ...combined, isCache: false }

  } catch (err) {
    // Offline: return cached if available
    const cached = await getWeatherCache(regionId)
    if (cached) return { ...cached, isCache: true }

    // Fallback baseline weather for Algerian coast
    return {
      current: {
        time: new Date().toISOString(),
        waveHeight: 0.7,
        waveDir: 45,
        wavePeriod: 5,
        swellHeight: 0.5,
        swellDir: 40,
        seaTemp: 19.5,
        windSpeed: 9,
        windDir: 60,
        windGusts: 13
      },
      forecast: [],
      isCache: true,
      fetchedAt: Date.now()
    }
  }
}

function processWeatherData(marine, wind) {
  const hours = marine.hourly.time || []
  const now = new Date()
  // Find closest hour index
  let idx = 0
  let minDiff = Infinity
  for (let i = 0; i < hours.length; i++) {
    const diff = Math.abs(new Date(hours[i]) - now)
    if (diff < minDiff) { minDiff = diff; idx = i }
  }

  const h = marine.hourly
  const w = wind?.hourly

  const current = {
    time: hours[idx],
    waveHeight: h.wave_height?.[idx] ?? null,
    waveDir: h.wave_direction?.[idx] ?? null,
    wavePeriod: h.wave_period?.[idx] ?? null,
    swellHeight: h.swell_wave_height?.[idx] ?? null,
    swellDir: h.swell_wave_direction?.[idx] ?? null,
    seaTemp: h.sea_surface_temperature?.[idx] ?? null,
    windSpeed: w?.wind_speed_10m?.[idx] ?? null,
    windDir: w?.wind_direction_10m?.[idx] ?? null,
    windGusts: w?.wind_gusts_10m?.[idx] ?? null,
  }

  // Build 72h forecast (next 72 hours)
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

export function metersToKnots(ms) { return (ms * 1.94384).toFixed(1) }

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
  if (heightMeters < 0.2) return 'Mer calme'
  if (heightMeters < 0.5) return 'Mer belle'
  if (heightMeters < 1.25) return 'Peu agitée'
  if (heightMeters < 2.5) return 'Mer agitée'
  if (heightMeters < 4.0) return 'Mer forte'
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
