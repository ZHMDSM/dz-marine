// DZ Marine - Main Application Entry Point
import './style.css'
import { initMap, updatePosition, panToPosition, toggleLayer, isLayerActive,
  addSpotMarker, removeSpotMarker, clearAllSpotMarkers,
  showAnchorZone, hideAnchorZone, startRuler, clearRuler, setNightMode } from './map.js'
import { initDB, saveSpot, getAllSpots, deleteSpot, exportGPX, importGPX,
  saveSetting, getSetting, loadAllSettings } from './storage.js'
import { fetchMarineWeather, beaufortScale, degreesToCompass,
  waveConditionLabel, formatWeatherTime } from './weather.js'
import { setAnchor, clearAnchor, checkAnchorDrift, setAnchorCallbacks,
  formatCoordDD, formatCoordDMS, msToKnots, msToKmh } from './anchor.js'
import { translations, setLanguage, t, getCurrentLang } from './i18n.js'

// App state
let appState = {
  lang: 'fr',
  units: 'knots',
  coordFormat: 'DD',
  nightMode: false,
  appMode: 'boat', // 'boat' | 'shore'
  gps: { lat: null, lon: null, speed: null, heading: null, accuracy: null },
  watchId: null,
  spots: [],
  anchor: { active: false, lat: null, lon: null, radius: 50 },
  weather: null,
  activePanel: null,
  editingSpot: null,
  rulerActive: false,
}

// ---- Bootstrap ----
async function init() {
  await initDB()
  const settings = await loadAllSettings()
  appState = { ...appState, ...settings }
  setLanguage(appState.lang)
  applyTheme()

  initMap('map')
  await loadSpots()
  renderUI()
  startGPS()
  setupEventListeners()
}

// ---- GPS ----
function startGPS() {
  if (!navigator.geolocation) {
    setHUDStatus('gpsError')
    return
  }
  setHUDStatus('gpsWaiting')
  appState.watchId = navigator.geolocation.watchPosition(
    onGPSUpdate,
    onGPSError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  )
}

function onGPSUpdate(pos) {
  const { latitude: lat, longitude: lon, speed, heading, accuracy } = pos.coords
  appState.gps = { lat, lon, speed, heading, accuracy }
  updatePosition(lat, lon, heading || 0, accuracy)
  updateHUD()

  // Anchor check
  if (appState.anchor.active) {
    const result = checkAnchorDrift(lat, lon)
    updateAnchorStatus(result)
  }
}

function onGPSError(err) {
  console.warn('GPS error:', err.message)
  setHUDStatus('gpsError')
}

// ---- HUD ----
function updateHUD() {
  const { lat, lon, speed, heading } = appState.gps
  if (lat === null) return

  // Speed
  let speedStr = '—'
  if (speed !== null && speed !== undefined) {
    speedStr = appState.units === 'knots' ? `${msToKnots(speed)} kts` : `${msToKmh(speed)} km/h`
  }

  // Coordinates
  const coordStr = appState.coordFormat === 'DMS'
    ? formatCoordDMS(lat, lon)
    : formatCoordDD(lat, lon)

  document.getElementById('hud-speed').textContent = speedStr
  document.getElementById('hud-heading').textContent = heading !== null ? `${Math.round(heading || 0)}°` : '—'
  document.getElementById('hud-coords').textContent = coordStr
  document.getElementById('hud-gps-dot').className = 'gps-dot active'
  document.getElementById('hud-gps-label').textContent = t('gpsActive')
}

function setHUDStatus(status) {
  const dot = document.getElementById('hud-gps-dot')
  const label = document.getElementById('hud-gps-label')
  if (!dot || !label) return
  dot.className = `gps-dot ${status === 'gpsActive' ? 'active' : status === 'gpsError' ? 'error' : 'waiting'}`
  label.textContent = t(status)
}

// ---- Spots ----
async function loadSpots() {
  appState.spots = await getAllSpots()
  clearAllSpotMarkers()
  appState.spots.forEach(spot => addSpotMarker(spot, onSpotTap))
}

function onSpotTap(spot) {
  openSpotSheet(spot)
}

async function quickSaveSpot() {
  const { lat, lon } = appState.gps
  if (!lat) { showToast('❌ ' + t('gpsWaiting')); return }
  const spot = await saveSpot({
    name: `Spot ${new Date().toLocaleTimeString()}`,
    latitude: lat, longitude: lon,
    activity_type: appState.appMode,
    category: 'fishing'
  })
  appState.spots.push(spot)
  addSpotMarker(spot, onSpotTap)
  showToast('✅ ' + t('saveSpot'))
}

// ---- UI Rendering ----
function renderUI() {
  document.getElementById('app-name').textContent = t('appName')
  document.getElementById('btn-quick-save').title = t('quickSave')
  document.getElementById('btn-mode').textContent = appState.appMode === 'boat' ? '⚓' : '🎣'
  document.getElementById('btn-mode').title = appState.appMode === 'boat' ? t('boatMode') : t('shoreMode')
  document.getElementById('hud-speed-label').textContent = t('speed')
  document.getElementById('hud-heading-label').textContent = t('heading')
  renderSpotsPanel()
}

function renderSpotsPanel() {
  const list = document.getElementById('spots-list')
  if (!list) return
  const query = document.getElementById('spots-search')?.value?.toLowerCase() || ''
  const filtered = appState.spots.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.category?.toLowerCase().includes(query)
  )
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">${t('noSpots')}</div>`
    return
  }
  list.innerHTML = filtered.map(spot => {
    const ICONS = { fishing: '🎣', anchor: '⚓', danger: '⚠️', harbor: '⛵', dive: '🤿', wreck: '🚢' }
    const icon = ICONS[spot.category] || '📍'
    const d = new Date(spot.created_at)
    return `<div class="spot-item" data-id="${spot.id}">
      <div class="spot-icon" style="background:${spot.color}">${icon}</div>
      <div class="spot-info">
        <div class="spot-name">${spot.name}</div>
        <div class="spot-meta">${formatCoordDD(spot.latitude, spot.longitude)}</div>
        ${spot.depth_meters ? `<div class="spot-meta">⬇️ ${spot.depth_meters}m</div>` : ''}
      </div>
      <div class="spot-actions">
        <button class="btn-icon" onclick="window.dzApp.goToSpot('${spot.id}')">🎯</button>
        <button class="btn-icon" onclick="window.dzApp.editSpot('${spot.id}')">✏️</button>
        <button class="btn-icon btn-danger" onclick="window.dzApp.confirmDeleteSpot('${spot.id}')">🗑️</button>
      </div>
    </div>`
  }).join('')
}

// ---- Panel Management ----
function openPanel(panelId) {
  document.querySelectorAll('.bottom-panel').forEach(p => {
    p.classList.toggle('active', p.id === panelId)
  })
  appState.activePanel = panelId
}

function closeAllPanels() {
  document.querySelectorAll('.bottom-panel').forEach(p => p.classList.remove('active'))
  appState.activePanel = null
}

// ---- Spot Sheet ----
function openSpotSheet(spot) {
  appState.editingSpot = spot
  const sheet = document.getElementById('panel-spot-edit')
  if (!sheet) return
  document.getElementById('edit-spot-name').value = spot.name || ''
  document.getElementById('edit-spot-cat').value = spot.category || 'fishing'
  document.getElementById('edit-spot-depth').value = spot.depth_meters || ''
  document.getElementById('edit-spot-notes').value = spot.notes || ''
  document.getElementById('edit-spot-visibility').value = spot.visibility_meters || ''
  document.getElementById('edit-spot-seabed').value = spot.seabed_type || ''
  document.getElementById('edit-spot-color').value = spot.color || '#FF3B30'
  openPanel('panel-spot-edit')
}

async function saveEditingSpot() {
  if (!appState.editingSpot) return
  const updated = {
    ...appState.editingSpot,
    name: document.getElementById('edit-spot-name').value,
    category: document.getElementById('edit-spot-cat').value,
    depth_meters: parseFloat(document.getElementById('edit-spot-depth').value) || null,
    notes: document.getElementById('edit-spot-notes').value,
    visibility_meters: parseFloat(document.getElementById('edit-spot-visibility').value) || null,
    seabed_type: document.getElementById('edit-spot-seabed').value || null,
    color: document.getElementById('edit-spot-color').value,
  }
  const saved = await saveSpot(updated)
  const idx = appState.spots.findIndex(s => s.id === saved.id)
  if (idx >= 0) appState.spots[idx] = saved
  else appState.spots.push(saved)
  addSpotMarker(saved, onSpotTap)
  closeAllPanels()
  renderSpotsPanel()
  showToast('✅ ' + t('save'))
}

// ---- Anchor ----
function activateAnchorAlarm() {
  const { lat, lon } = appState.gps
  if (!lat) { showToast('❌ ' + t('gpsWaiting')); return }
  const radius = parseInt(document.getElementById('anchor-radius')?.value || '50')
  setAnchor(lat, lon, radius)
  showAnchorZone(lat, lon, radius)
  appState.anchor = { active: true, lat, lon, radius }
  setAnchorCallbacks(
    (info) => {
      showToast(`🔔 ${t('anchorDrift')} ${info.distance}m`, true)
      document.getElementById('anchor-status')?.classList.add('alarm')
      document.getElementById('anchor-status-text').textContent = `${t('anchorDrift')} — ${info.distance}m`
    },
    () => {
      document.getElementById('anchor-status')?.classList.remove('alarm')
      document.getElementById('anchor-status-text').textContent = t('anchorSafe')
    }
  )
  document.getElementById('btn-anchor-set').classList.add('hidden')
  document.getElementById('anchor-active-ui').classList.remove('hidden')
  document.getElementById('anchor-status-text').textContent = t('anchorSafe')
  showToast(`⚓ ${t('anchorAlarm')}: ${radius}m`)
}

function deactivateAnchor() {
  clearAnchor()
  hideAnchorZone()
  appState.anchor.active = false
  document.getElementById('btn-anchor-set').classList.remove('hidden')
  document.getElementById('anchor-active-ui').classList.add('hidden')
  showToast('⚓ ' + t('anchorDisable'))
}

function updateAnchorStatus(result) {
  const el = document.getElementById('anchor-status')
  if (!el) return
  if (!result.safe) {
    el.classList.add('alarm')
  } else {
    el.classList.remove('alarm')
  }
}

// ---- Weather ----
async function loadWeather() {
  const { lat, lon } = appState.gps
  const fetchLat = lat || 36.7
  const fetchLon = lon || 3.1
  document.getElementById('weather-loading').classList.remove('hidden')
  const data = await fetchMarineWeather(fetchLat, fetchLon)
  document.getElementById('weather-loading').classList.add('hidden')
  if (!data) {
    document.getElementById('weather-content').innerHTML = `<div class="empty-state">${t('noWeather')}</div>`
    return
  }
  appState.weather = data
  renderWeatherPanel(data)
}

function renderWeatherPanel(data) {
  const c = data.current
  const el = document.getElementById('weather-content')
  if (!el || !c) return
  const isCache = data.isCache
  const bft = c.windSpeed !== null ? beaufortScale(c.windSpeed) : '—'
  const windDir = c.windDir !== null ? degreesToCompass(c.windDir) : '—'
  const waveLabel = waveConditionLabel(c.waveHeight)

  el.innerHTML = `
    ${isCache ? `<div class="cache-badge">📶 ${t('weatherOffline')} (${data.cacheAge}min)</div>` : ''}
    <div class="weather-grid">
      <div class="weather-card">
        <div class="w-icon">🌊</div>
        <div class="w-label">${t('waveHeight')}</div>
        <div class="w-value">${c.waveHeight !== null ? c.waveHeight.toFixed(1) + 'm' : '—'}</div>
        <div class="w-sub">${waveLabel}</div>
      </div>
      <div class="weather-card">
        <div class="w-icon">⏱️</div>
        <div class="w-label">${t('wavePeriod')}</div>
        <div class="w-value">${c.wavePeriod !== null ? c.wavePeriod.toFixed(0) + 's' : '—'}</div>
        <div class="w-sub">${c.waveDir !== null ? degreesToCompass(c.waveDir) : ''}</div>
      </div>
      <div class="weather-card">
        <div class="w-icon">💨</div>
        <div class="w-label">${t('windSpeed')}</div>
        <div class="w-value">${c.windSpeed !== null ? Math.round(c.windSpeed) + 'kts' : '—'}</div>
        <div class="w-sub">Bft ${bft} • ${windDir}</div>
      </div>
      <div class="weather-card">
        <div class="w-icon">🌡️</div>
        <div class="w-label">${t('seaTemp')}</div>
        <div class="w-value">${c.seaTemp !== null ? c.seaTemp.toFixed(1) + '°C' : '—'}</div>
        <div class="w-sub">${c.windGusts !== null ? '💨 Rafales: ' + Math.round(c.windGusts) + 'kts' : ''}</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:8px">${t('lastUpdate')}: ${formatWeatherTime(c.time, appState.lang)}</div>
  `
}

// ---- Night Mode ----
function toggleNightMode() {
  appState.nightMode = !appState.nightMode
  applyTheme()
  saveSetting('nightMode', appState.nightMode)
}

function applyTheme() {
  document.body.classList.toggle('night-mode', appState.nightMode)
  setNightMode(appState.nightMode)
  const btn = document.getElementById('btn-night')
  if (btn) btn.classList.toggle('active', appState.nightMode)
}

// ---- Layer Toggles ----
function handleLayerToggle(name) {
  const btn = document.getElementById(`layer-btn-${name}`)
  const nowActive = !isLayerActive(name)
  toggleLayer(name, nowActive)
  btn?.classList.toggle('active', nowActive)
}

// ---- Mode Toggle ----
function toggleMode() {
  appState.appMode = appState.appMode === 'boat' ? 'shore' : 'boat'
  saveSetting('appMode', appState.appMode)
  document.getElementById('btn-mode').textContent = appState.appMode === 'boat' ? '⚓' : '🎣'
  showToast(appState.appMode === 'boat' ? t('boatMode') : t('shoreMode'))
}

// ---- Language ----
function changeLanguage(lang) {
  appState.lang = lang
  setLanguage(lang)
  saveSetting('lang', lang)
  renderUI()
  closeAllPanels()
  showToast('🌐 ' + (lang === 'fr' ? 'Français' : lang === 'ar' ? 'العربية' : 'English'))
}

// ---- SOS ----
function sendSOS() {
  const { lat, lon } = appState.gps
  if (!lat) { showToast('❌ ' + t('gpsWaiting')); return }
  const time = new Date().toLocaleString()
  const msg = t('sosMessage', {
    lat: lat.toFixed(5), lon: lon.toFixed(5), time
  })
  window.location.href = `sms:?body=${encodeURIComponent(msg)}`
}

// ---- GPX ----
async function handleExportGPX() {
  const gpx = await exportGPX()
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dz-marine-spots-${Date.now()}.gpx`
  a.click()
  URL.revokeObjectURL(url)
  showToast('✅ ' + t('gpxExported'))
}

async function handleImportGPX(file) {
  const text = await file.text()
  const imported = await importGPX(text)
  await loadSpots()
  renderSpotsPanel()
  showToast(`✅ Importé ${imported.length} spots`)
}

// ---- Ruler ----
function startRulerMode() {
  appState.rulerActive = true
  showToast('📏 ' + t('rulerStart'))
  closeAllPanels()
  startRuler(({ distNM, bearing }) => {
    appState.rulerActive = false
    showToast(t('rulerResult', { dist: distNM, bearing }), false, 5000)
  })
}

// ---- Toast ----
function showToast(msg, persistent = false, duration = 3000) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.classList.add('visible')
  if (!persistent) {
    setTimeout(() => toast.classList.remove('visible'), duration)
  }
}

// ---- Event Listeners ----
function setupEventListeners() {
  document.getElementById('btn-center')?.addEventListener('click', () => {
    const { lat, lon } = appState.gps
    if (lat) panToPosition(lat, lon)
    else showToast('❌ ' + t('gpsWaiting'))
  })

  document.getElementById('btn-quick-save')?.addEventListener('click', quickSaveSpot)
  document.getElementById('btn-mode')?.addEventListener('click', toggleMode)
  document.getElementById('btn-night')?.addEventListener('click', toggleNightMode)

  document.getElementById('btn-open-spots')?.addEventListener('click', () => openPanel('panel-spots'))
  document.getElementById('btn-open-anchor')?.addEventListener('click', () => openPanel('panel-anchor'))
  document.getElementById('btn-open-weather')?.then // not a promise, just get element
  document.getElementById('btn-open-weather')?.addEventListener('click', () => {
    openPanel('panel-weather')
    loadWeather()
  })
  document.getElementById('btn-open-layers')?.addEventListener('click', () => openPanel('panel-layers'))
  document.getElementById('btn-open-settings')?.addEventListener('click', () => openPanel('panel-settings'))

  // Close panels
  document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', closeAllPanels)
  })

  // Spot search
  document.getElementById('spots-search')?.addEventListener('input', renderSpotsPanel)

  // Spot edit save/cancel
  document.getElementById('btn-save-spot')?.addEventListener('click', saveEditingSpot)
  document.getElementById('btn-cancel-spot')?.addEventListener('click', closeAllPanels)

  // Anchor
  document.getElementById('btn-anchor-set')?.addEventListener('click', activateAnchorAlarm)
  document.getElementById('btn-anchor-clear')?.addEventListener('click', deactivateAnchor)

  // Weather refresh
  document.getElementById('btn-fetch-weather')?.addEventListener('click', loadWeather)

  // Layer toggles
  ['osm', 'satellite', 'seamap', 'bathy'].forEach(name => {
    document.getElementById(`layer-btn-${name}`)?.addEventListener('click', () => handleLayerToggle(name))
  })

  // Language
  document.getElementById('lang-fr')?.addEventListener('click', () => changeLanguage('fr'))
  document.getElementById('lang-ar')?.addEventListener('click', () => changeLanguage('ar'))
  document.getElementById('lang-en')?.addEventListener('click', () => changeLanguage('en'))

  // Units toggle
  document.getElementById('units-toggle')?.addEventListener('click', () => {
    appState.units = appState.units === 'knots' ? 'kmh' : 'knots'
    saveSetting('units', appState.units)
    document.getElementById('units-toggle').textContent = appState.units === 'knots' ? 'kts' : 'km/h'
  })

  // Coord format
  document.getElementById('coord-toggle')?.addEventListener('click', () => {
    appState.coordFormat = appState.coordFormat === 'DD' ? 'DMS' : 'DD'
    saveSetting('coordFormat', appState.coordFormat)
    document.getElementById('coord-toggle').textContent = appState.coordFormat
    updateHUD()
  })

  // SOS
  document.getElementById('btn-sos')?.addEventListener('click', sendSOS)

  // GPX
  document.getElementById('btn-export-gpx')?.addEventListener('click', handleExportGPX)
  document.getElementById('btn-import-gpx')?.addEventListener('click', () => {
    document.getElementById('gpx-file-input').click()
  })
  document.getElementById('gpx-file-input')?.addEventListener('change', e => {
    if (e.target.files[0]) handleImportGPX(e.target.files[0])
  })

  // Ruler
  document.getElementById('btn-ruler')?.addEventListener('click', startRulerMode)
  document.getElementById('btn-clear-ruler')?.addEventListener('click', () => {
    clearRuler()
    appState.rulerActive = false
    showToast(t('clearRuler'))
  })
}

// ---- Global API for inline handlers ----
window.dzApp = {
  goToSpot(id) {
    const spot = appState.spots.find(s => s.id === id)
    if (spot) { panToPosition(spot.latitude, spot.longitude); closeAllPanels() }
  },
  editSpot(id) {
    const spot = appState.spots.find(s => s.id === id)
    if (spot) openSpotSheet(spot)
  },
  confirmDeleteSpot(id) {
    if (confirm(t('confirmDelete'))) {
      deleteSpot(id).then(() => {
        appState.spots = appState.spots.filter(s => s.id !== id)
        removeSpotMarker(id)
        renderSpotsPanel()
        showToast('🗑️ ' + t('delete'))
      })
    }
  }
}

init()
