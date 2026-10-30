// DZ Marine - Anchor Drag Alarm (Haversine)
let anchorState = {
  active: false,
  lat: null,
  lon: null,
  radius: 50,
  alarmTriggered: false,
  watchId: null,
  onDrift: null,
  onSafe: null,
}

const R = 6371000 // Earth radius in meters

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function bearingTo(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180
  const toDeg = r => (r * 180 / Math.PI + 360) % 360
  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
  return Math.round(toDeg(Math.atan2(y, x)))
}

export function setAnchor(lat, lon, radiusMeters = 50) {
  anchorState.lat = lat
  anchorState.lon = lon
  anchorState.radius = radiusMeters
  anchorState.active = true
  anchorState.alarmTriggered = false
}

export function clearAnchor() {
  anchorState.active = false
  anchorState.alarmTriggered = false
  stopAlarmSound()
}

export function getAnchorState() { return { ...anchorState } }

export function isAnchorActive() { return anchorState.active }

export function checkAnchorDrift(currentLat, currentLon) {
  if (!anchorState.active || anchorState.lat === null) return { safe: true, distance: 0 }
  const dist = haversineDistance(anchorState.lat, anchorState.lon, currentLat, currentLon)
  const safe = dist <= anchorState.radius
  if (!safe && !anchorState.alarmTriggered) {
    anchorState.alarmTriggered = true
    triggerAlarmSound()
    anchorState.onDrift?.({ distance: Math.round(dist), bearing: bearingTo(anchorState.lat, anchorState.lon, currentLat, currentLon) })
  } else if (safe && anchorState.alarmTriggered) {
    anchorState.alarmTriggered = false
    stopAlarmSound()
    anchorState.onSafe?.()
  }
  return { safe, distance: Math.round(dist), bearing: bearingTo(anchorState.lat, anchorState.lon, currentLat, currentLon) }
}

export function setAnchorCallbacks(onDrift, onSafe) {
  anchorState.onDrift = onDrift
  anchorState.onSafe = onSafe
}

// Simple alarm sound via Web Audio API
let alarmCtx = null
let alarmOscillator = null
let alarmInterval = null

function triggerAlarmSound() {
  try {
    alarmInterval = setInterval(() => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.2)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    }, 1500)
  } catch (e) { /* audio not available */ }
}

function stopAlarmSound() {
  if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null }
}

// Coordinate formatting
export function formatCoordDD(lat, lon) {
  return `${lat.toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${lon.toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`
}

export function formatCoordDMS(lat, lon) {
  return `${toDMS(lat, lat >= 0 ? 'N' : 'S')} ${toDMS(lon, lon >= 0 ? 'E' : 'W')}`
}

function toDMS(dd, dir) {
  const d = Math.floor(Math.abs(dd))
  const mAll = (Math.abs(dd) - d) * 60
  const m = Math.floor(mAll)
  const s = ((mAll - m) * 60).toFixed(1)
  return `${d}°${m}'${s}"${dir}`
}

export function msToKnots(ms) { return (ms * 1.94384).toFixed(1) }
export function msToKmh(ms) { return (ms * 3.6).toFixed(1) }
export function metersToFathoms(m) { return (m / 1.8288).toFixed(1) }
