// DZ Marine - Astronomical Ephemeris, Solunar Fishing Activity & Mediterranean Tides
// Provides: Sunrise/Sunset, Moonrise/Moonset, Moon Phase, Mediterranean Tides, and Solunar Fish Activity Rating

/**
 * Calculates Moon Phase and illumination percentage
 * Phase: 0.0 (New Moon), 0.25 (First Quarter), 0.5 (Full Moon), 0.75 (Last Quarter)
 */
export function getMoonData(date = new Date()) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()

  // Julian date calculation
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  const jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045

  // Known new moon reference Julian date (Jan 6 2000, 18:14 UTC = 2451549.5)
  const daysSinceNew = jd - 2451549.5
  const synodicMonth = 29.53058867
  const phase = (daysSinceNew % synodicMonth) / synodicMonth
  const normalizedPhase = (phase + 1) % 1

  // Illumination percentage (0 to 100%)
  const illumination = Math.round(50 * (1 - Math.cos(2 * Math.PI * normalizedPhase)))

  let phaseNameFr = 'Nouvelle Lune'
  let phaseNameAr = 'محاق (قمر جديد)'
  let phaseNameEn = 'New Moon'
  let phaseIcon = '🌑'

  if (normalizedPhase >= 0.03 && normalizedPhase < 0.22) {
    phaseNameFr = 'Premier Croissant'
    phaseNameAr = 'هلال متزايد'
    phaseNameEn = 'Waxing Crescent'
    phaseIcon = '🌒'
  } else if (normalizedPhase >= 0.22 && normalizedPhase < 0.28) {
    phaseNameFr = 'Premier Quartier'
    phaseNameAr = 'تربيع أول'
    phaseNameEn = 'First Quarter'
    phaseIcon = '🌓'
  } else if (normalizedPhase >= 0.28 && normalizedPhase < 0.47) {
    phaseNameFr = 'Lune Gibbeuse Croissante'
    phaseNameAr = 'أحدب متزايد'
    phaseNameEn = 'Waxing Gibbous'
    phaseIcon = '🌔'
  } else if (normalizedPhase >= 0.47 && normalizedPhase < 0.53) {
    phaseNameFr = 'Pleine Lune'
    phaseNameAr = 'بدر مكتمل'
    phaseNameEn = 'Full Moon'
    phaseIcon = '🌕'
  } else if (normalizedPhase >= 0.53 && normalizedPhase < 0.72) {
    phaseNameFr = 'Lune Gibbeuse Décroissante'
    phaseNameAr = 'أحدب متناقص'
    phaseNameEn = 'Waning Gibbous'
    phaseIcon = '🌖'
  } else if (normalizedPhase >= 0.72 && normalizedPhase < 0.78) {
    phaseNameFr = 'Dernier Quartier'
    phaseNameAr = 'تربيع أخير'
    phaseNameEn = 'Last Quarter'
    phaseIcon = '🌗'
  } else if (normalizedPhase >= 0.78 && normalizedPhase < 0.97) {
    phaseNameFr = 'Dernier Croissant'
    phaseNameAr = 'هلال متناقص'
    phaseNameEn = 'Waning Crescent'
    phaseIcon = '🌘'
  }

  // Calculate approximate Moonrise & Moonset times for the day
  const baseHour = (normalizedPhase * 24 + 6) % 24
  const moonriseHour = Math.floor(baseHour)
  const moonriseMin = Math.floor((baseHour % 1) * 60)
  const moonsetHour = (moonriseHour + 12) % 24
  const moonsetMin = (moonriseMin + 20) % 60

  const moonriseStr = `${String(moonriseHour).padStart(2, '0')}:${String(moonriseMin).padStart(2, '0')}`
  const moonsetStr = `${String(moonsetHour).padStart(2, '0')}:${String(moonsetMin).padStart(2, '0')}`

  return {
    phase: normalizedPhase,
    illumination,
    icon: phaseIcon,
    nameFr: phaseNameFr,
    nameAr: phaseNameAr,
    nameEn: phaseNameEn,
    moonrise: moonriseStr,
    moonset: moonsetStr
  }
}

/**
 * Mediterranean Tide Prediction for Algerian Coast.
 * The Algerian coast experiences semi-diurnal micro-tides with a range of 0.20m to 0.50m.
 * Computes 2 High Tides (Pleine Mer) and 2 Low Tides (Basse Mer) daily.
 */
export function getMediterraneanTides(date = new Date(), lat = 36.75, lon = 3.06) {
  const moonData = getMoonData(date)
  
  // Spring tides (Vives-eaux) near Full & New Moon; Neap tides (Mortes-eaux) near Quarters
  const isSpringTide = moonData.illumination > 85 || moonData.illumination < 15
  const maxRangeM = isSpringTide ? 0.45 : 0.25

  // Daily cycle: High tide occurs roughly twice daily, ~12h25m apart
  // Reference base time linked to lunar transit
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24)
  const cycleShiftHours = ((dayOfYear * 0.84) + (lon * 0.25)) % 12.4

  const pm1H = Math.floor((3.2 + cycleShiftHours) % 24)
  const pm1M = Math.floor((((3.2 + cycleShiftHours) % 1) * 60))
  const bm1H = Math.floor((pm1H + 6.2) % 24)
  const bm1M = Math.floor((((pm1H + 6.2) % 1) * 60))
  
  const pm2H = Math.floor((pm1H + 12.4) % 24)
  const pm2M = Math.floor((((pm1H + 12.4) % 1) * 60))
  const bm2H = Math.floor((bm1H + 12.4) % 24)
  const bm2M = Math.floor((((bm1H + 12.4) % 1) * 60))

  const formatT = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

  return {
    highTide1: { time: formatT(pm1H, pm1M), heightM: +(maxRangeM).toFixed(2), typeFr: 'Pleine Mer 1', typeAr: 'مد أول' },
    lowTide1:  { time: formatT(bm1H, bm1M), heightM: 0.05, typeFr: 'Basse Mer 1', typeAr: 'جزر أول' },
    highTide2: { time: formatT(pm2H, pm2M), heightM: +(maxRangeM * 0.95).toFixed(2), typeFr: 'Pleine Mer 2', typeAr: 'مد ثانٍ' },
    lowTide2:  { time: formatT(bm2H, bm2M), heightM: 0.08, typeFr: 'Basse Mer 2', typeAr: 'جزر ثانٍ' },
    coefficient: isSpringTide ? 'Vives-eaux (Coeff. 85)' : 'Mortes-eaux (Coeff. 45)',
    coefficientAr: isSpringTide ? 'مد قوي (مياه حية)' : 'مد معتدل',
    tidalRangeM: +(maxRangeM - 0.05).toFixed(2)
  }
}

/**
 * Solunar Fish Activity Rating (1 to 5 Stars) & Feeding Periods
 * Standard Solunar Theory used in marine fishing GPS (Garmin, Navionics).
 * Major periods: Moon overhead & underfoot (~2 hours)
 * Minor periods: Moonrise & Moonset (~1 hour)
 */
export function getSolunarActivity(date = new Date(), moonData = null) {
  const mData = moonData || getMoonData(date)
  const { phase, illumination } = mData

  // Solunar score base: highest around New Moon (phase ~0) and Full Moon (phase ~0.5)
  const distFromExtreme = Math.min(
    Math.abs(phase - 0.0),
    Math.abs(phase - 0.5),
    Math.abs(phase - 1.0)
  )
  
  // 0.0 distance = 100% score; 0.25 distance = 40% score
  let scorePercent = Math.round(98 - (distFromExtreme / 0.25) * 55)
  scorePercent = Math.max(35, Math.min(99, scorePercent))

  let stars = 3
  let labelFr = 'Activité Modérée'
  let labelAr = 'نشاط معتدل'
  let labelEn = 'Moderate Activity'

  if (scorePercent >= 85) {
    stars = 5
    labelFr = 'Excellente Activité'
    labelAr = 'نشاط ممتاز جداً'
    labelEn = 'Peak Activity'
  } else if (scorePercent >= 70) {
    stars = 4
    labelFr = 'Très Bonne Activité'
    labelAr = 'نشاط جيد جداً'
    labelEn = 'Very Good Activity'
  } else if (scorePercent >= 50) {
    stars = 3
    labelFr = 'Activité Moyenne'
    labelAr = 'نشاط متوسط'
    labelEn = 'Average Activity'
  } else {
    stars = 2
    labelFr = 'Activité Faible'
    labelAr = 'نشاط ضعيف'
    labelEn = 'Low Activity'
  }

  // Major Feeding Windows (Moon Transit and Under-transit)
  const [mrH, mrM] = mData.moonrise.split(':').map(Number)
  const maj1StartH = (mrH + 6) % 24
  const maj1EndH = (maj1StartH + 2) % 24
  const maj2StartH = (maj1StartH + 12) % 24
  const maj2EndH = (maj2StartH + 2) % 24

  // Minor Feeding Windows (Moonrise & Moonset)
  const [msH, msM] = mData.moonset.split(':').map(Number)
  const min1StartH = mrH
  const min1EndH = (min1StartH + 1) % 24
  const min2StartH = msH
  const min2EndH = (min2StartH + 1) % 24

  const fmtW = (h1, m1, h2, m2) => `${String(h1).padStart(2,'0')}:${String(m1).padStart(2,'0')} - ${String(h2).padStart(2,'0')}:${String(m2).padStart(2,'0')}`

  return {
    scorePercent,
    stars,
    starString: '★'.repeat(stars) + '☆'.repeat(5 - stars),
    labelFr,
    labelAr,
    labelEn,
    majorPeriod1: fmtW(maj1StartH, mrM, maj1EndH, mrM),
    majorPeriod2: fmtW(maj2StartH, mrM, maj2EndH, mrM),
    minorPeriod1: fmtW(min1StartH, mrM, min1EndH, mrM),
    minorPeriod2: fmtW(min2StartH, msM, min2EndH, msM)
  }
}
