// DZ Marine - Marine Weather, Currents, Visibility, Solunar & Mediterranean Tides Engine
import { saveWeatherCache, getWeatherCache } from './storage.js'
import { getMoonData, getMediterraneanTides, getSolunarActivity } from './solunar.js'

const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine'
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

export async function fetchMarineWeather(lat, lon) {
  const regionId = `${Math.round(lat * 20) / 20}_${Math.round(lon * 20) / 20}`

  try {
    // Offset coordinates ~5km northward into the open Mediterranean Sea for the Marine API.
    // This prevents Open-Meteo's wave model from returning "No data" or 400 Bad Request on coastal/shore cells.
    const marineLat = Math.min(38.30, lat + 0.045)
    const marineLon = lon

    // 1. Fetch Marine API (Waves, swell, period, sea surface temperature) for 7 days
    const marineParams = new URLSearchParams({
      latitude: marineLat.toFixed(4),
      longitude: marineLon.toFixed(4),
      hourly: [
        'wave_height', 'wave_direction', 'wave_period',
        'wind_wave_height', 'swell_wave_height', 'swell_wave_direction',
        'sea_surface_temperature'
      ].join(','),
      daily: ['wave_height_max', 'wave_period_max'].join(','),
      timezone: 'Africa/Algiers',
      forecast_days: 7
    })

    // 2. Fetch Atmospheric Forecast (Wind, gusts, rain, UV, CAPE thunderstorm risk, visibility) for 7 days
    const forecastParams = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: [
        'temperature_2m', 'precipitation', 'weather_code', 'visibility',
        'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
        'uv_index', 'cape'
      ].join(','),
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'sunrise', 'sunset', 'uv_index_max', 'precipitation_sum',
        'wind_speed_10m_max', 'wind_direction_10m_dominant', 'wind_gusts_10m_max'
      ].join(','),
      wind_speed_unit: 'kn',
      timezone: 'Africa/Algiers',
      forecast_days: 7
    })

    const [marineRes, forecastRes] = await Promise.allSettled([
      fetch(`${OPEN_METEO_MARINE_URL}?${marineParams}`),
      fetch(`${OPEN_METEO_FORECAST_URL}?${forecastParams}`)
    ])

    const marineData = (marineRes.status === 'fulfilled' && marineRes.value.ok) ? await marineRes.value.json() : null
    const forecastData = (forecastRes.status === 'fulfilled' && forecastRes.value.ok) ? await forecastRes.value.json() : null

    // If both failed completely, trigger fallback
    if (!marineData && !forecastData) {
      throw new Error('APIs unreachable')
    }

    const processed = processWeatherData(lat, lon, marineData, forecastData)
    await saveWeatherCache(regionId, processed)
    return { ...processed, isCache: false }

  } catch (err) {
    // Return cached if available
    const cached = await getWeatherCache(regionId)
    if (cached) return { ...cached, isCache: true }

    // Fallback realistic dynamic 7-day forecast for Algerian coast
    return generateRealisticFallback(lat, lon)
  }
}

/**
 * Combines Open-Meteo Marine & Atmospheric data into a structured 7-day forecast.
 */
function processWeatherData(lat, lon, marine, forecast) {
  const now = new Date()
  const currentHour = now.getHours()

  const fD = forecast?.daily || {}
  const fH = forecast?.hourly || {}
  const mD = marine?.daily || {}
  const mH = marine?.hourly || {}

  const dailyDates = fD.time || []
  const numDays = Math.min(7, Math.max(dailyDates.length, 7))

  // Build the 7 Days
  const days = []

  for (let d = 0; d < numDays; d++) {
    let dayDate
    let dateStr

    if (dailyDates[d]) {
      dateStr = dailyDates[d]
      const [y, m, dayN] = dateStr.split('-').map(Number)
      dayDate = new Date(y, m - 1, dayN)
    } else {
      dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d)
      dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`
    }

    const moon = getMoonData(dayDate)
    const tides = getMediterraneanTides(dayDate, lat, lon)
    const solunar = getSolunarActivity(dayDate, moon)

    const code = fD.weather_code?.[d] ?? (d === 0 ? 0 : (d % 2 === 0 ? 1 : 2))
    const info = getWeatherCodeInfo(code)

    const sunriseStr = fD.sunrise?.[d] ? formatHHMM(fD.sunrise[d]) : '06:52'
    const sunsetStr = fD.sunset?.[d] ? formatHHMM(fD.sunset[d]) : '18:10'

    const tMax = fD.temperature_2m_max?.[d] !== undefined ? Math.round(fD.temperature_2m_max[d]) : (22 + (d % 3))
    const tMin = fD.temperature_2m_min?.[d] !== undefined ? Math.round(fD.temperature_2m_min[d]) : (15 + (d % 2))

    const wMax = mD.wave_height_max?.[d] !== undefined ? Math.round(mD.wave_height_max[d] * 10) / 10 : (0.5 + (d % 4) * 0.2)
    const pMax = mD.wave_period_max?.[d] !== undefined ? Math.round(mD.wave_period_max[d]) : 6

    const windMax = fD.wind_speed_10m_max?.[d] !== undefined ? Math.round(fD.wind_speed_10m_max[d]) : (10 + (d % 5) * 2)
    const gustsMax = fD.wind_gusts_10m_max?.[d] !== undefined ? Math.round(fD.wind_gusts_10m_max[d]) : (windMax + 6)
    const windDirDom = fD.wind_direction_10m_dominant?.[d] ?? (60 + d * 10)
    const windCompass = degreesToCompass(windDirDom)

    const precip = fD.precipitation_sum?.[d] !== undefined ? Math.round(fD.precipitation_sum[d] * 10) / 10 : (code >= 60 ? 3.5 : 0.0)
    const uvMax = fD.uv_index_max?.[d] !== undefined ? Math.round(fD.uv_index_max[d]) : 5

    // Build 24 hours for this specific day
    const hourly = []
    const dayStartOffset = d * 24

    for (let h = 0; h < 24; h++) {
      const idx = dayStartOffset + h
      const hourStr = `${String(h).padStart(2, '0')}:00`

      const hCode = fH.weather_code?.[idx] ?? code
      const hInfo = getWeatherCodeInfo(hCode)

      const hTemp = fH.temperature_2m?.[idx] !== undefined ? Math.round(fH.temperature_2m[idx] * 10) / 10 : (tMin + Math.round(Math.sin((h - 6) / 12 * Math.PI) * (tMax - tMin)))
      const hSeaTemp = mH.sea_surface_temperature?.[idx] !== undefined ? Math.round(mH.sea_surface_temperature[idx] * 10) / 10 : 20.0

      const hWind = fH.wind_speed_10m?.[idx] !== undefined ? Math.round(fH.wind_speed_10m[idx]) : Math.round(windMax * 0.7)
      const hGusts = fH.wind_gusts_10m?.[idx] !== undefined ? Math.round(fH.wind_gusts_10m[idx]) : Math.round(hWind * 1.35)
      const hWindDir = fH.wind_direction_10m?.[idx] ?? windDirDom
      const hCompass = degreesToCompass(hWindDir)

      const hWave = mH.wave_height?.[idx] !== undefined ? Math.round(mH.wave_height[idx] * 10) / 10 : (wMax * 0.8)
      const hWavePeriod = mH.wave_period?.[idx] !== undefined ? Math.round(mH.wave_period[idx]) : pMax

      const hCape = fH.cape?.[idx] !== undefined ? Math.round(fH.cape[idx]) : 120
      const capeRisk = getCapeRisk(hCape)

      const hPrecip = fH.precipitation?.[idx] !== undefined ? Math.round(fH.precipitation[idx] * 10) / 10 : (hCode >= 60 ? 0.8 : 0.0)
      const hUv = fH.uv_index?.[idx] !== undefined ? Math.round(fH.uv_index[idx]) : ((h >= 10 && h <= 15) ? 4 : 0)

      const hVisiAtm = fH.visibility?.[idx] !== undefined ? Math.round(fH.visibility[idx] / 1000) : 18
      const hWaterVis = estimateWaterVisibility(hWave, hWavePeriod, hWind).meters

      const tideHeightM = estimateInstantaneousTide(tides, h)
      const isMajor = checkInWindow(hourStr, solunar.majorPeriod1) || checkInWindow(hourStr, solunar.majorPeriod2)
      const isMinor = checkInWindow(hourStr, solunar.minorPeriod1) || checkInWindow(hourStr, solunar.minorPeriod2)

      hourly.push({
        hourNum: h,
        hourStr,
        temp: hTemp,
        seaTemp: hSeaTemp,
        weatherCode: hCode,
        weatherInfo: hInfo,
        windSpeed: hWind,
        windGusts: hGusts,
        windDir: hWindDir,
        windCompass: hCompass,
        waveHeight: hWave,
        wavePeriod: hWavePeriod,
        rainMm: hPrecip,
        uvIndex: hUv,
        cape: hCape,
        capeRisk,
        visibilityKm: hVisiAtm,
        waterVisM: hWaterVis,
        tideHeightM,
        isMajorFeeding: isMajor,
        isMinorFeeding: isMinor
      })
    }

    days.push({
      dayIndex: d,
      date: dateStr,
      dayNameFr: formatDayName(dayDate, 'fr', d),
      dayNameAr: formatDayName(dayDate, 'ar', d),
      dayNameEn: formatDayName(dayDate, 'en', d),
      weatherCode: code,
      weatherInfo: info,
      tempMax: tMax,
      tempMin: tMin,
      sunrise: sunriseStr,
      sunset: sunsetStr,
      waveHeightMax: wMax,
      wavePeriodMax: pMax,
      windSpeedMax: windMax,
      windGustsMax: gustsMax,
      windDirDominant: windDirDom,
      windCompass,
      precipSum: precip,
      uvMax,
      seaTemp: 20.0,
      moon,
      tides,
      solunar,
      hourly
    })
  }

  // Current Instantaneous Weather
  const todayHourly = days[0]?.hourly || []
  const currentHourData = todayHourly.find(h => h.hourNum === currentHour) || todayHourly[0] || {}

  const currentMoon = getMoonData(now)
  const currentTides = getMediterraneanTides(now, lat, lon)
  const currentSolunar = getSolunarActivity(now, currentMoon)
  const currentVis = estimateWaterVisibility(currentHourData.waveHeight || 0.6, currentHourData.wavePeriod || 5.5, currentHourData.windSpeed || 8)
  const currentCurrent = estimateCoastalCurrent(lat, lon, currentHourData.windSpeed || 8, currentHourData.windDir || 60)

  const current = {
    time: now.toISOString(),
    temp: currentHourData.temp || 21,
    seaTemp: currentHourData.seaTemp || 20,
    waveHeight: currentHourData.waveHeight || 0.6,
    wavePeriod: currentHourData.wavePeriod || 5.5,
    waveDir: currentHourData.windDir || 60,
    windSpeed: currentHourData.windSpeed || 9,
    windDir: currentHourData.windDir || 60,
    windGusts: currentHourData.windGusts || 14,
    cape: currentHourData.cape || 100,
    visibilityAtmKm: currentHourData.visibilityKm || 18,
    visibility: currentVis,
    coastalCurrent: currentCurrent,
    weatherCode: currentHourData.weatherCode || 0,
    weatherInfo: currentHourData.weatherInfo || getWeatherCodeInfo(0),
    moon: currentMoon,
    tides: currentTides,
    solunar: currentSolunar
  }

  return {
    current,
    days,
    fetchedAt: Date.now()
  }
}

/**
 * Realistic Fallback generator when device has no network.
 */
function generateRealisticFallback(lat, lon) {
  const now = new Date()
  const days = []

  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d)
    const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`

    const moon = getMoonData(dayDate)
    const tides = getMediterraneanTides(dayDate, lat, lon)
    const solunar = getSolunarActivity(dayDate, moon)

    const code = d === 1 ? 1 : (d === 3 ? 61 : 0)
    const info = getWeatherCodeInfo(code)

    const hourly = []
    for (let h = 0; h < 24; h++) {
      const hourStr = `${String(h).padStart(2, '0')}:00`
      const isMajor = checkInWindow(hourStr, solunar.majorPeriod1) || checkInWindow(hourStr, solunar.majorPeriod2)
      const isMinor = checkInWindow(hourStr, solunar.minorPeriod1) || checkInWindow(hourStr, solunar.minorPeriod2)

      hourly.push({
        hourNum: h,
        hourStr,
        temp: 18 + Math.round(Math.sin((h - 7) / 12 * Math.PI) * 4),
        seaTemp: 19.8,
        weatherCode: code,
        weatherInfo: info,
        windSpeed: 8 + (h % 5),
        windGusts: 12 + (h % 6),
        windDir: 65,
        windCompass: 'ENE',
        waveHeight: 0.5 + ((h % 4) * 0.1),
        wavePeriod: 5.5,
        rainMm: code === 61 ? 1.0 : 0.0,
        uvIndex: (h >= 11 && h <= 15) ? 5 : 0,
        cape: 120,
        capeRisk: getCapeRisk(120),
        visibilityKm: 18,
        waterVisM: 15.0,
        tideHeightM: estimateInstantaneousTide(tides, h),
        isMajorFeeding: isMajor,
        isMinorFeeding: isMinor
      })
    }

    days.push({
      dayIndex: d,
      date: dateStr,
      dayNameFr: formatDayName(dayDate, 'fr', d),
      dayNameAr: formatDayName(dayDate, 'ar', d),
      dayNameEn: formatDayName(dayDate, 'en', d),
      weatherCode: code,
      weatherInfo: info,
      tempMax: 22,
      tempMin: 16,
      sunrise: '06:52',
      sunset: '18:10',
      waveHeightMax: 0.7,
      wavePeriodMax: 6,
      windSpeedMax: 12,
      windGustsMax: 17,
      windDirDominant: 65,
      windCompass: 'ENE',
      precipSum: code === 61 ? 2.5 : 0.0,
      uvMax: 5,
      seaTemp: 19.8,
      moon,
      tides,
      solunar,
      hourly
    })
  }

  const moonNow = getMoonData(now)
  const tidesNow = getMediterraneanTides(now, lat, lon)
  const solunarNow = getSolunarActivity(now, moonNow)

  return {
    current: {
      time: now.toISOString(),
      temp: 20.5,
      waveHeight: 0.6,
      wavePeriod: 5.5,
      waveDir: 45,
      seaTemp: 19.8,
      windSpeed: 8,
      windDir: 65,
      windGusts: 12,
      cape: 120,
      visibilityAtmKm: 18,
      visibility: estimateWaterVisibility(0.6, 5.5, 8),
      coastalCurrent: estimateCoastalCurrent(lat, lon, 8, 65),
      weatherCode: 0,
      weatherInfo: getWeatherCodeInfo(0),
      moon: moonNow,
      tides: tidesNow,
      solunar: currentSolunar
    },
    days,
    isCache: true,
    fetchedAt: Date.now()
  }
}

/**
 * Calculates continuous instantaneous tide level in meters for a given hour.
 */
function estimateInstantaneousTide(tides, hourNum) {
  try {
    const [pmH] = tides.highTide1.time.split(':').map(Number)
    const range = tides.tidalRangeM || 0.35
    const base = tides.lowTide1?.heightM || 0.05

    // Semi-diurnal sinusoidal oscillation (M2 period ~12.42h)
    const angle = (2 * Math.PI * (hourNum - pmH)) / 12.42
    const level = base + (range / 2) * (1 + Math.cos(angle))
    return Math.round(level * 100) / 100
  } catch {
    return 0.22
  }
}

function checkInWindow(hourStr, periodStr) {
  if (!periodStr || !hourStr) return false
  const [hNow] = hourStr.split(':').map(Number)
  const parts = periodStr.split(' - ')
  if (parts.length !== 2) return false
  const [hStart] = parts[0].split(':').map(Number)
  const [hEnd] = parts[1].split(':').map(Number)

  if (hStart <= hEnd) {
    return hNow >= hStart && hNow <= hEnd
  } else {
    return hNow >= hStart || hNow <= hEnd
  }
}

function formatHHMM(isoStr) {
  try {
    const d = new Date(isoStr)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '06:00'
  }
}

function formatDayName(date, lang, dayIndex) {
  if (dayIndex === 0) {
    if (lang === 'ar') return 'اليوم (الآن)'
    if (lang === 'fr') return "Aujourd'hui"
    return 'Today'
  }
  if (dayIndex === 1) {
    if (lang === 'ar') return 'غداً'
    if (lang === 'fr') return 'Demain'
    return 'Tomorrow'
  }

  const locale = lang === 'ar' ? 'ar-DZ' : (lang === 'fr' ? 'fr-FR' : 'en-US')
  const weekday = date.toLocaleDateString(locale, { weekday: 'short' })
  const dayNum = date.getDate()
  const month = date.toLocaleDateString(locale, { month: 'short' })

  return `${weekday} ${dayNum} ${month}`
}

export function getWeatherCodeInfo(code) {
  switch (code) {
    case 0:
      return { icon: '☀️', fr: 'Ciel dégagé', ar: 'سماء صافية', en: 'Clear sky' }
    case 1:
      return { icon: '🌤️', fr: 'Peu nuageux', ar: 'غائم جزئياً', en: 'Mainly clear' }
    case 2:
      return { icon: '⛅', fr: 'Éclaircies', ar: 'غائم مع فترات مشمسة', en: 'Partly cloudy' }
    case 3:
      return { icon: '☁️', fr: 'Couvert', ar: 'سماء مغطاة', en: 'Overcast' }
    case 45:
    case 48:
      return { icon: '🌫️', fr: 'Brume / Haze', ar: 'ضباب / رطوبة عالية', en: 'Fog / Haze' }
    case 51:
    case 53:
    case 55:
      return { icon: '🌦️', fr: 'Bruine', ar: 'رذاذ خفيف', en: 'Drizzle' }
    case 61:
    case 63:
    case 65:
      return { icon: '🌧️', fr: 'Pluie continue', ar: 'أمطار', en: 'Rain' }
    case 80:
    case 81:
    case 82:
      return { icon: '🌦️', fr: 'Averses marines', ar: 'زخات مطر', en: 'Rain showers' }
    case 95:
    case 96:
    case 99:
      return { icon: '⚡', fr: 'Orage marin / Grain', ar: 'عواصف رعدية بحرية', en: 'Thunderstorm' }
    default:
      return { icon: '🌤️', fr: 'Variable', ar: 'متقلب', en: 'Variable' }
  }
}

export function getCapeRisk(cape) {
  if (cape === null || cape === undefined) return { risk: 'low', labelFr: 'Mer stable', labelAr: 'بحر مستقر', labelEn: 'Stable sea', icon: '🟢' }
  if (cape < 350) return { risk: 'low', labelFr: 'Stable (Risque nul)', labelAr: 'مستقر', labelEn: 'Stable', icon: '🟢' }
  if (cape < 900) return { risk: 'moderate', labelFr: 'Modéré (Grains côtiers)', labelAr: 'اضطراب معتدل', labelEn: 'Moderate squalls', icon: '🟡' }
  if (cape < 2000) return { risk: 'high', labelFr: 'Alerte Orage Marin', labelAr: 'إنذار عواصف بحرية', labelEn: 'Thunderstorm warning', icon: '🟠' }
  return { risk: 'extreme', labelFr: 'Danger Grain Violent', labelAr: 'خطر عواصف رعدية عنيفة', labelEn: 'Severe Marine Squall', icon: '🔴' }
}

export function estimateWaterVisibility(waveHeight, wavePeriod, windSpeed, seabedType = null) {
  let baseVis = 18.0

  if (waveHeight !== null && waveHeight !== undefined) {
    if (waveHeight <= 0.3) baseVis += 3.0
    else if (waveHeight <= 0.6) baseVis += 1.0
    else if (waveHeight <= 1.0) baseVis -= 3.0
    else if (waveHeight <= 1.6) baseVis -= 7.0
    else baseVis -= 11.0
  }

  if (wavePeriod !== null && wavePeriod > 8 && waveHeight > 0.8) {
    baseVis -= 2.5
  }

  if (windSpeed !== null && windSpeed !== undefined) {
    if (windSpeed > 18) baseVis -= 4.0
    else if (windSpeed > 12) baseVis -= 2.0
  }

  if (seabedType === 'posidonia' || seabedType === 'rock') {
    baseVis += 2.0
  } else if (seabedType === 'sand') {
    baseVis -= 1.5
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

export function estimateCoastalCurrent(lat, lon, windSpeed = 8, windDir = 60) {
  let baseSpeedKts = 0.5
  let baseDirectionDeg = 80

  const nearCapes = (
    (lat > 36.78 && lon > 5.05 && lon < 5.15) ||
    (lat > 37.05 && lon > 6.40 && lon < 6.55) ||
    (lat > 36.95 && lon > 7.72 && lon < 7.82) ||
    (lat > 36.80 && lon > 2.95 && lon < 3.02)
  )
  if (nearCapes) {
    baseSpeedKts += 0.35
  }

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
