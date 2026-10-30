// DZ Marine - Local Storage Engine (IndexedDB)
const DB_NAME = 'dz-marine-db'
const DB_VERSION = 1

let db = null

export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }
    request.onupgradeneeded = (event) => {
      const database = event.target.result

      // Spots store
      if (!database.objectStoreNames.contains('spots')) {
        const spotsStore = database.createObjectStore('spots', { keyPath: 'id' })
        spotsStore.createIndex('category', 'category', { unique: false })
        spotsStore.createIndex('activity_type', 'activity_type', { unique: false })
      }

      // Weather cache
      if (!database.objectStoreNames.contains('weather_cache')) {
        database.createObjectStore('weather_cache', { keyPath: 'region_id' })
      }

      // Settings
      if (!database.objectStoreNames.contains('user_settings')) {
        database.createObjectStore('user_settings', { keyPath: 'key' })
      }
    }
  })
}

function getDB() {
  if (!db) throw new Error('Database not initialized')
  return db
}

// --- Spots ---
export async function saveSpot(spot) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('spots', 'readwrite')
    const store = tx.objectStore('spots')
    const now = Date.now()
    const record = {
      id: spot.id || `spot_${now}_${Math.random().toString(36).substr(2, 9)}`,
      name: spot.name || 'Spot',
      latitude: spot.latitude,
      longitude: spot.longitude,
      depth_meters: spot.depth_meters || null,
      activity_type: spot.activity_type || 'boat',
      category: spot.category || 'fishing',
      color: spot.color || '#FF3B30',
      visibility_meters: spot.visibility_meters || null,
      seabed_type: spot.seabed_type || null,
      notes: spot.notes || '',
      created_at: spot.created_at || now,
      updated_at: now
    }
    const req = store.put(record)
    req.onsuccess = () => resolve(record)
    req.onerror = () => reject(req.error)
  })
}

export async function getAllSpots() {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('spots', 'readonly')
    const store = tx.objectStore('spots')
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function getSpot(id) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('spots', 'readonly')
    const store = tx.objectStore('spots')
    const req = store.get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteSpot(id) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('spots', 'readwrite')
    const store = tx.objectStore('spots')
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// --- Weather Cache ---
export async function saveWeatherCache(regionId, forecastJson) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('weather_cache', 'readwrite')
    const store = tx.objectStore('weather_cache')
    const req = store.put({
      region_id: regionId,
      timestamp: Date.now(),
      forecast_json: JSON.stringify(forecastJson)
    })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getWeatherCache(regionId) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('weather_cache', 'readonly')
    const store = tx.objectStore('weather_cache')
    const req = store.get(regionId)
    req.onsuccess = () => {
      const result = req.result
      if (!result) return resolve(null)
      // Cache valid for 72h
      const age = Date.now() - result.timestamp
      if (age > 72 * 60 * 60 * 1000) return resolve(null)
      resolve({
        ...result,
        forecast_json: JSON.parse(result.forecast_json),
        isCache: true,
        cacheAge: Math.round(age / 60000) // minutes
      })
    }
    req.onerror = () => reject(req.error)
  })
}

// --- User Settings ---
export async function saveSetting(key, value) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('user_settings', 'readwrite')
    const store = tx.objectStore('user_settings')
    const req = store.put({ key, value: JSON.stringify(value) })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getSetting(key, defaultValue = null) {
  return new Promise((resolve, reject) => {
    const tx = getDB().transaction('user_settings', 'readonly')
    const store = tx.objectStore('user_settings')
    const req = store.get(key)
    req.onsuccess = () => {
      if (!req.result) return resolve(defaultValue)
      try { resolve(JSON.parse(req.result.value)) }
      catch { resolve(defaultValue) }
    }
    req.onerror = () => reject(req.error)
  })
}

export async function loadAllSettings() {
  const keys = ['lang', 'units', 'coordFormat', 'nightMode', 'appMode']
  const defaults = { lang: 'fr', units: 'knots', coordFormat: 'DD', nightMode: false, appMode: 'boat' }
  const settings = { ...defaults }
  for (const key of keys) {
    const val = await getSetting(key, defaults[key])
    settings[key] = val
  }
  return settings
}

// --- GPX Export ---
export async function exportGPX() {
  const spots = await getAllSpots()
  const now = new Date().toISOString()
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="DZ Marine" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>DZ Marine Spots</name>
    <time>${now}</time>
  </metadata>
`
  for (const spot of spots) {
    gpx += `  <wpt lat="${spot.latitude}" lon="${spot.longitude}">
    <name>${escapeXml(spot.name)}</name>
    <desc>${escapeXml(spot.notes || '')} | Cat: ${spot.category} | Depth: ${spot.depth_meters || 'N/A'}m</desc>
    <sym>${spot.category}</sym>
  </wpt>
`
  }
  gpx += `</gpx>`
  return gpx
}

function escapeXml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]))
}

export async function importGPX(gpxText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(gpxText, 'text/xml')
  const wpts = doc.querySelectorAll('wpt')
  const imported = []
  for (const wpt of wpts) {
    const lat = parseFloat(wpt.getAttribute('lat'))
    const lon = parseFloat(wpt.getAttribute('lon'))
    const name = wpt.querySelector('name')?.textContent || 'Imported Spot'
    const desc = wpt.querySelector('desc')?.textContent || ''
    if (!isNaN(lat) && !isNaN(lon)) {
      const spot = await saveSpot({ name, latitude: lat, longitude: lon, notes: desc, category: 'fishing' })
      imported.push(spot)
    }
  }
  return imported
}
