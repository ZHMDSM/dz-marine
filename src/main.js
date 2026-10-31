// DZ Marine - Main Application Entry Point
import './style.css'
import {
  initMap, updatePosition, panToPosition, setBaseLayer, getBaseLayer,
  toggleOverlay, isOverlayActive,
  addSpotMarker, removeSpotMarker, clearAllSpotMarkers, setTapMarker, clearTapMarker,
  showAnchorZone, hideAnchorZone, startRuler, clearRuler, isRulerActive, setNightMode
} from './map.js'
import { ALGERIAN_HARBORS, ALGERIAN_WRECKS } from './harbors_wrecks.js'
import {
  initDB, saveSpot, getAllSpots, deleteSpot, exportGPX, importGPX,
  saveSetting, loadAllSettings
} from './storage.js'
import {
  fetchMarineWeather, beaufortScale, degreesToCompass,
  waveConditionLabel, formatWeatherTime, estimateWaterVisibility, estimateCoastalCurrent
} from './weather.js'
import {
  setAnchor, clearAnchor, checkAnchorDrift, setAnchorCallbacks,
  formatCoordDD, formatCoordDMS, msToKnots, msToKmh, haversineDistance, bearingTo
} from './anchor.js'
import { translations, setLanguage, t, getCurrentLang } from './i18n.js'
import { getWaterDepth, formatDepth, isWaterCoordinate } from './depth.js'

// Application Global State
let appState = {
  lang: 'fr',
  units: 'knots', // 'knots' | 'kmh'
  coordFormat: 'DD', // 'DD' | 'DMS'
  nightMode: false,
  appMode: 'boat', // 'boat' | 'shore' | 'dive'
  gps: { lat: 36.7525, lon: 3.0588, speed: 0, heading: 0, accuracy: 10, isLive: false },
  watchId: null,
  spots: [],
  anchor: { active: false, lat: null, lon: null, radius: 45 },
  weather: null,
  weatherTarget: 'gps', // 'gps' | 'spot'
  selectedSpotCoords: null,
  activePanel: null,
  editingSpot: null,
  tappedPoint: null,
  currentDepth: null,
  currentVisibility: null
}

// ---- Bootstrap Application ----
async function init() {
  try {
    await initDB()
    const settings = await loadAllSettings()
    appState = { ...appState, ...settings }
    
    // Apply language & theme
    setLanguage(appState.lang)
    applyTheme()
    
    // Init Leaflet Map with map-click callback
    initMap('map', onMapClick)
    
    // Load local spots
    await loadSpots()
    
    // Render localized UI
    applyLanguage(appState.lang)
    
    // Start GPS hardware listener
    startGPS()
    
    // Wire all event listeners
    setupEventListeners()
    
    // Preload weather for central Algerian waters
    loadWeatherForTarget('gps')

    // Estimate initial depth and visibility
    updateLiveDepth(appState.gps.lat, appState.gps.lon)
    
  } catch (err) {
    console.error('Initialization error:', err)
  }
}

// ---- GPS Hardware Listener ----
function startGPS() {
  if (!navigator.geolocation) {
    setHUDStatus('gpsError')
    return
  }
  setHUDStatus('gpsWaiting')
  
  appState.watchId = navigator.geolocation.watchPosition(
    onGPSUpdate,
    onGPSError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
  )
}

function onGPSUpdate(pos) {
  const { latitude: lat, longitude: lon, speed, heading, accuracy } = pos.coords
  appState.gps = {
    lat, lon,
    speed: speed !== null ? speed : 0,
    heading: heading !== null ? heading : 0,
    accuracy: accuracy || 5,
    isLive: true
  }
  
  updatePosition(lat, lon, heading || 0, accuracy)
  updateHUD()
  setHUDStatus('gpsActive')
  
  // Update real-time water depth & visibility estimate
  updateLiveDepth(lat, lon)

  // Anchor drift check
  if (appState.anchor.active) {
    const result = checkAnchorDrift(lat, lon)
    updateAnchorStatus(result)
  }
}

function onGPSError(err) {
  console.warn('GPS signal pending or restricted:', err.message)
  setHUDStatus(appState.gps.isLive ? 'gpsActive' : 'gpsWaiting')
  updateHUD()
}

async function updateLiveDepth(lat, lon) {
  try {
    const res = await getWaterDepth(lat, lon)
    appState.currentDepth = res.depth
    
    const depthEl = document.getElementById('hud-depth')
    if (depthEl) {
      if (res.depth === null) {
        depthEl.textContent = 'Côte (0m)'
      } else {
        depthEl.textContent = formatDepth(res.depth)
      }
    }

    // Also update HUD visibility
    const vis = estimateWaterVisibility(0.6, 5, 8)
    appState.currentVisibility = vis.meters
    const visEl = document.getElementById('hud-visibility')
    if (visEl) {
      visEl.textContent = `${vis.meters} m`
    }
  } catch (e) {
    // silent
  }
}

// ---- HUD Updates ----
function updateHUD() {
  const { lat, lon, speed, heading } = appState.gps
  
  // Speed
  let speedStr = '0.0 kts'
  if (speed !== null && speed !== undefined) {
    speedStr = appState.units === 'knots' ? `${msToKnots(speed)} kts` : `${msToKmh(speed)} km/h`
  }
  
  // Coordinates
  const coordStr = appState.coordFormat === 'DMS'
    ? formatCoordDMS(lat, lon)
    : formatCoordDD(lat, lon)

  const speedEl = document.getElementById('hud-speed')
  const headingEl = document.getElementById('hud-heading')
  const coordsEl = document.getElementById('hud-coords')
  
  if (speedEl) speedEl.textContent = speedStr
  if (headingEl) headingEl.textContent = `${Math.round(heading || 0)}°`
  if (coordsEl) coordsEl.textContent = coordStr
}

function setHUDStatus(status) {
  const dot = document.getElementById('hud-gps-dot')
  const label = document.getElementById('hud-gps-label')
  if (!dot || !label) return
  dot.className = `gps-dot ${status === 'gpsActive' ? 'active' : status === 'gpsError' ? 'error' : 'waiting'}`
  label.textContent = t(status)
}

// ---- Map Tap / Inspection Handler ----
async function onMapClick(latlng) {
  // If a bottom panel is open, close it on map tap
  if (appState.activePanel) {
    closeAllPanels()
    return
  }

  const lat = latlng.lat
  const lon = latlng.lng

  // Strictly enforce Maritime / Water only! Land clicks are rejected.
  if (!isWaterCoordinate(lat, lon)) {
    showToast('⚠️ ' + t('landNotAllowed'), false, 3000)
    clearTapMarker()
    closeInspector()
    return
  }

  appState.tappedPoint = { lat, lon }
  appState.selectedSpotCoords = { lat, lon }
  
  // Place visual tap marker
  setTapMarker(lat, lon)

  // Calculate distance & bearing from boat
  const distM = haversineDistance(appState.gps.lat, appState.gps.lon, lat, lon)
  const distNM = (distM / 1852).toFixed(2)
  const bearing = bearingTo(appState.gps.lat, appState.gps.lon, lat, lon)
  
  // Query accurate depth at tapped coordinate
  const depthRes = await getWaterDepth(lat, lon)
  const depthStr = depthRes.depth !== null ? formatDepth(depthRes.depth) : 'Côte / Terre (0m)'
  appState.tappedPoint.depth = depthRes.depth

  // Update Inspector elements
  const inspEl = document.getElementById('map-inspector')
  const depthEl = document.getElementById('insp-depth')
  const visEl = document.getElementById('insp-visibility')
  const currentEl = document.getElementById('insp-current')
  const distEl = document.getElementById('insp-dist')
  const bearingEl = document.getElementById('insp-bearing')
  const weatherMiniEl = document.getElementById('insp-weather-mini')
  const badgeMode = document.getElementById('insp-badge-mode')

  if (depthEl) depthEl.textContent = depthStr
  if (distEl) distEl.textContent = `${distNM} NM (${Math.round(distM)}m)`
  if (bearingEl) bearingEl.textContent = `${bearing}°`

  if (badgeMode) {
    badgeMode.textContent = depthRes.depth !== null ? `${Math.round(depthRes.depth)}m` : 'Côte'
  }

  // Pre-fetch spot weather & calculate water visibility + currents
  if (weatherMiniEl) weatherMiniEl.textContent = '⏳ Chargement météo…'
  if (inspEl) inspEl.classList.remove('hidden')

  try {
    const weatherData = await fetchMarineWeather(lat, lon)
    if (weatherData && weatherData.current) {
      const c = weatherData.current
      const vis = c.visibility || estimateWaterVisibility(c.waveHeight, c.wavePeriod, c.windSpeed)
      const current = c.coastalCurrent || estimateCoastalCurrent(lat, lon, c.windSpeed, c.windDir)

      appState.tappedPoint.visibility = vis.meters
      appState.tappedPoint.weather = c

      if (visEl) {
        const visLabel = appState.lang === 'ar' ? vis.labelAr : appState.lang === 'fr' ? vis.labelFr : vis.labelEn
        visEl.textContent = `${vis.meters} m (${visLabel})`
      }

      if (currentEl) {
        const currentLabel = appState.lang === 'ar' ? current.nameAr : appState.lang === 'fr' ? current.nameFr : current.nameEn
        currentEl.textContent = currentLabel
      }

      if (weatherMiniEl) {
        weatherMiniEl.innerHTML = `🌊 Houle: <b>${c.waveHeight !== null ? c.waveHeight.toFixed(1) + 'm' : '—'}</b> (${c.wavePeriod !== null ? Math.round(c.wavePeriod) + 's' : ''}) • 💨 <b>${Math.round(c.windSpeed || 0)} kts</b> ${degreesToCompass(c.windDir || 0)} • 🌡️ <b>${c.seaTemp !== null ? c.seaTemp.toFixed(1) + '°C' : '—'}</b>`
      }
    }
  } catch (err) {
    if (weatherMiniEl) weatherMiniEl.textContent = 'Météo indisponible hors-ligne'
  }
}

function closeInspector() {
  const inspEl = document.getElementById('map-inspector')
  if (inspEl) inspEl.classList.add('hidden')
  clearTapMarker()
  appState.tappedPoint = null
}

// ---- Spots Management ----
async function loadSpots() {
  appState.spots = await getAllSpots()
  clearAllSpotMarkers()
  appState.spots.forEach(spot => addSpotMarker(spot, onSpotTap))
  renderSpotsPanel()
}

function onSpotTap(spot) {
  openSpotSheet(spot)
}

async function quickSaveSpot() {
  const lat = appState.tappedPoint?.lat || appState.gps.lat
  const lon = appState.tappedPoint?.lon || appState.gps.lon
  const depth = appState.tappedPoint?.depth !== undefined ? appState.tappedPoint.depth : appState.currentDepth
  const visibility = appState.tappedPoint?.visibility || appState.currentVisibility || null

  const now = new Date()
  const defaultName = appState.appMode === 'dive'
    ? `Plongée ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`
    : `Spot ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`

  const newSpot = await saveSpot({
    name: defaultName,
    latitude: lat,
    longitude: lon,
    depth_meters: depth,
    visibility_meters: visibility,
    activity_type: appState.appMode,
    category: appState.appMode === 'dive' ? 'dive' : (appState.appMode === 'shore' ? 'fishing' : 'fishing'),
    color: appState.appMode === 'dive' ? '#06b6d4' : '#0ea5e9'
  })

  appState.spots.push(newSpot)
  addSpotMarker(newSpot, onSpotTap)
  renderSpotsPanel()
  closeInspector()
  showToast(`✅ ${t('saveSpot')}: ${defaultName}`)
}

function openSpotSheet(spot) {
  appState.editingSpot = spot
  
  const nameEl = document.getElementById('edit-spot-name')
  const catEl = document.getElementById('edit-spot-cat')
  const depthEl = document.getElementById('edit-spot-depth')
  const visEl = document.getElementById('edit-spot-visibility')
  const seabedEl = document.getElementById('edit-spot-seabed')
  const colorEl = document.getElementById('edit-spot-color')
  const notesEl = document.getElementById('edit-spot-notes')

  if (nameEl) nameEl.value = spot.name || ''
  if (catEl) catEl.value = spot.category || (appState.appMode === 'dive' ? 'dive' : 'fishing')
  if (depthEl) depthEl.value = spot.depth_meters !== null && spot.depth_meters !== undefined ? spot.depth_meters : ''
  if (visEl) visEl.value = spot.visibility_meters !== null && spot.visibility_meters !== undefined ? spot.visibility_meters : ''
  if (seabedEl) seabedEl.value = spot.seabed_type || ''
  if (colorEl) colorEl.value = spot.color || '#0ea5e9'
  if (notesEl) notesEl.value = spot.notes || ''

  openPanel('panel-spot-edit')
}

async function saveEditingSpot() {
  if (!appState.editingSpot) return
  
  const name = document.getElementById('edit-spot-name')?.value?.trim() || 'Spot'
  const category = document.getElementById('edit-spot-cat')?.value || 'fishing'
  const depth = parseFloat(document.getElementById('edit-spot-depth')?.value) || null
  const visibility = parseFloat(document.getElementById('edit-spot-visibility')?.value) || null
  const seabed = document.getElementById('edit-spot-seabed')?.value || null
  const color = document.getElementById('edit-spot-color')?.value || '#0ea5e9'
  const notes = document.getElementById('edit-spot-notes')?.value || ''

  const updated = {
    ...appState.editingSpot,
    name,
    category,
    depth_meters: depth,
    visibility_meters: visibility,
    seabed_type: seabed,
    color,
    notes
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

function renderSpotsPanel() {
  const list = document.getElementById('spots-list')
  if (!list) return

  const query = document.getElementById('spots-search')?.value?.toLowerCase() || ''
  const filtered = appState.spots.filter(s =>
    (s.name && s.name.toLowerCase().includes(query)) ||
    (s.category && s.category.toLowerCase().includes(query)) ||
    (s.notes && s.notes.toLowerCase().includes(query))
  )

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">${t('noSpots')}</div>`
    return
  }

  const ICONS = { fishing: '🎣', anchor: '⚓', danger: '⚠️', harbor: '⛵', dive: '🤿', wreck: '🚢' }

  list.innerHTML = filtered.map(spot => {
    const icon = ICONS[spot.category] || '📍'
    const depthBadge = spot.depth_meters ? `<span style="color:#38bdf8;font-weight:700">⬇️ ${Math.round(spot.depth_meters)}m</span> • ` : ''
    const visBadge = spot.visibility_meters ? `<span style="color:#2dd4bf">👁️ ${spot.visibility_meters}m</span> • ` : ''

    return `
      <div class="spot-item" data-id="${spot.id}">
        <div class="spot-icon" style="background:${spot.color || '#0ea5e9'}">${icon}</div>
        <div class="spot-info" onclick="window.dzApp.goToSpot('${spot.id}')">
          <div class="spot-name">${spot.name}</div>
          <div class="spot-meta">
            ${depthBadge}${visBadge}${formatCoordDD(spot.latitude, spot.longitude)}
          </div>
        </div>
        <div class="spot-actions">
          <button class="btn-icon" onclick="window.dzApp.goToSpot('${spot.id}')" title="Centrer">🎯</button>
          <button class="btn-icon" onclick="window.dzApp.editSpot('${spot.id}')" title="Modifier">✏️</button>
          <button class="btn-icon btn-danger" onclick="window.dzApp.confirmDeleteSpot('${spot.id}')" title="Supprimer">🗑️</button>
        </div>
      </div>
    `
  }).join('')
}

// ---- Panel Navigation & Bottom Sheets ----
function openPanel(panelId) {
  closeInspector()
  
  if (appState.activePanel === panelId) {
    closeAllPanels()
    return
  }

  document.querySelectorAll('.bottom-panel').forEach(p => {
    p.classList.toggle('active', p.id === panelId)
  })

  document.querySelectorAll('.tb-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `btn-open-${panelId.replace('panel-', '')}`)
  })

  const backdrop = document.getElementById('panel-backdrop')
  if (backdrop) backdrop.classList.add('active')

  appState.activePanel = panelId
}

function closeAllPanels() {
  document.querySelectorAll('.bottom-panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active'))
  
  const backdrop = document.getElementById('panel-backdrop')
  if (backdrop) backdrop.classList.remove('active')

  appState.activePanel = null
}

// ---- Anchor Drag Alarm ----
function activateAnchorAlarm() {
  const lat = appState.gps.lat
  const lon = appState.gps.lon
  const radius = parseInt(document.getElementById('anchor-radius')?.value || '45')
  
  setAnchor(lat, lon, radius)
  showAnchorZone(lat, lon, radius)
  appState.anchor = { active: true, lat, lon, radius }

  setAnchorCallbacks(
    (info) => {
      showToast(`🚨 ${t('anchorDrift')} ${info.distance}m !`, true)
      const st = document.getElementById('anchor-status')
      const txt = document.getElementById('anchor-status-text')
      if (st) st.classList.add('alarm')
      if (txt) txt.textContent = `🚨 ${t('anchorDrift')} (${info.distance}m)`
    },
    () => {
      const st = document.getElementById('anchor-status')
      const txt = document.getElementById('anchor-status-text')
      if (st) st.classList.remove('alarm')
      if (txt) txt.textContent = `✅ ${t('anchorSafe')}`
    }
  )

  document.getElementById('btn-anchor-set-wrap')?.classList.add('hidden')
  document.getElementById('anchor-active-ui')?.classList.remove('hidden')
  
  const txt = document.getElementById('anchor-status-text')
  if (txt) txt.textContent = `✅ ${t('anchorSafe')}`
  
  showToast(`⚓ ${t('anchorAlarm')}: ${radius}m`)
}

function deactivateAnchor() {
  clearAnchor()
  hideAnchorZone()
  appState.anchor.active = false
  
  document.getElementById('btn-anchor-set-wrap')?.classList.remove('hidden')
  document.getElementById('anchor-active-ui')?.classList.add('hidden')
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

// ---- Spot-Specific & Boat Marine Weather ----
async function loadWeatherForTarget(target = 'gps') {
  appState.weatherTarget = target

  let lat = appState.gps.lat
  let lon = appState.gps.lon
  let label = t('myLocation')

  if (target === 'spot' && appState.selectedSpotCoords) {
    lat = appState.selectedSpotCoords.lat
    lon = appState.selectedSpotCoords.lon
    label = `${t('selectedSpot')} (${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E)`
  }

  // Update header buttons
  document.getElementById('btn-weather-target-gps')?.classList.toggle('active', target === 'gps')
  document.getElementById('btn-weather-target-spot')?.classList.toggle('active', target === 'spot')
  
  const nameEl = document.getElementById('weather-location-name')
  if (nameEl) nameEl.textContent = label

  const loading = document.getElementById('weather-loading')
  const content = document.getElementById('weather-content')

  backToDaysView()
  if (loading) loading.classList.remove('hidden')

  try {
    const data = await fetchMarineWeather(lat, lon)
    if (loading) loading.classList.add('hidden')

    if (!data) {
      if (content) content.innerHTML = `<div class="empty-state">${t('noWeather')}</div>`
      return
    }
    appState.weather = data
    renderWeatherPanel(data)
  } catch (err) {
    if (loading) loading.classList.add('hidden')
    if (content) content.innerHTML = `<div class="empty-state">${t('noWeather')}</div>`
  }
}

function renderWeatherPanel(data) {
  const c = data.current
  const el = document.getElementById('weather-content')
  if (!el || !c) return

  // Reset to 7-day overview view
  const daysView = document.getElementById('weather-days-view')
  const hourlyView = document.getElementById('weather-hourly-view')
  if (daysView) daysView.classList.remove('hidden')
  if (hourlyView) hourlyView.classList.add('hidden')

  const isCache = data.isCache
  const windDir = c.windDir !== null ? degreesToCompass(c.windDir) : '—'
  const vis = c.visibility || estimateWaterVisibility(c.waveHeight, c.wavePeriod, c.windSpeed)
  const visLabel = appState.lang === 'ar' ? vis.labelAr : appState.lang === 'fr' ? vis.labelFr : vis.labelEn

  const current = c.coastalCurrent || estimateCoastalCurrent(appState.gps.lat, appState.gps.lon, c.windSpeed, c.windDir)
  const currentLabel = appState.lang === 'ar' ? current.nameAr : appState.lang === 'fr' ? current.nameFr : current.nameEn
  const condText = appState.lang === 'ar' ? c.weatherInfo.ar : (appState.lang === 'fr' ? c.weatherInfo.fr : c.weatherInfo.en)

  // 1. Current Live Weather Hero Card
  const currentCardHtml = `
    ${isCache ? `<div class="cache-badge">📶 ${t('weatherOffline')}</div>` : ''}
    <div class="weather-current-card">
      <div class="wcc-header">
        <span class="wcc-title">⚡ En Direct (${formatWeatherTime(c.time, appState.lang)})</span>
        <span style="font-size:12.5px;font-weight:700;color:var(--text)">${c.weatherInfo.icon} ${condText}</span>
      </div>
      <div class="wcc-grid">
        <div class="wcc-item">
          <div class="wcc-lbl">${t('windSpeed')}</div>
          <div class="wcc-val">💨 ${Math.round(c.windSpeed)} kts</div>
          <div style="font-size:9.5px;color:var(--text-muted)">${windDir} • Raf. ${Math.round(c.windGusts)} kts</div>
        </div>
        <div class="wcc-item">
          <div class="wcc-lbl">${t('waveHeight')}</div>
          <div class="wcc-val">🌊 ${c.waveHeight.toFixed(1)} m</div>
          <div style="font-size:9.5px;color:var(--text-muted)">Pér. ${Math.round(c.wavePeriod)}s</div>
        </div>
        <div class="wcc-item">
          <div class="wcc-lbl">${t('seaTemp')} / Air</div>
          <div class="wcc-val">🌡️ ${c.seaTemp.toFixed(1)}°C</div>
          <div style="font-size:9.5px;color:var(--text-muted)">Air: ${Math.round(c.temp)}°C</div>
        </div>
        <div class="wcc-item">
          <div class="wcc-lbl">${t('tides')}</div>
          <div class="wcc-val" style="color:#38bdf8;font-size:12px">PM ${c.tides.highTide1.time}</div>
          <div style="font-size:9.5px;color:var(--text-muted)">BM ${c.tides.lowTide1.time} (${c.tides.tidalRangeM}m)</div>
        </div>
        <div class="wcc-item">
          <div class="wcc-lbl">${t('fishActivity')}</div>
          <div class="wcc-val" style="color:#f59e0b;font-size:12px">${c.solunar.starString}</div>
          <div style="font-size:9.5px;color:var(--warning)">Score: ${c.solunar.scorePercent}%</div>
        </div>
        <div class="wcc-item">
          <div class="wcc-lbl">${t('visibility')}</div>
          <div class="wcc-val" style="color:#2dd4bf;font-size:12px">${vis.meters} m</div>
          <div style="font-size:9.5px;color:var(--text-muted)">Visi air: ${c.visibilityAtmKm}km</div>
        </div>
      </div>
    </div>
  `

  // 2. 7-Day Table
  const days = data.days || []
  const daysListHtml = days.map(d => {
    const dayName = appState.lang === 'ar' ? d.dayNameAr : (appState.lang === 'fr' ? d.dayNameFr : d.dayNameEn)
    const dayDesc = appState.lang === 'ar' ? d.weatherInfo.ar : (appState.lang === 'fr' ? d.weatherInfo.fr : d.weatherInfo.en)

    return `
      <div class="weather-day-card" onclick="window.dzApp.openHourlyDrillDown(${d.dayIndex})">
        <div class="wdc-top">
          <div class="wdc-date-wrap">
            <span class="wdc-icon">${d.weatherInfo.icon}</span>
            <div>
              <div class="wdc-day-name">${dayName}</div>
              <div style="font-size:11px;color:var(--text-muted)">${dayDesc}</div>
            </div>
          </div>
          <div class="wdc-temp-pill">
            <span style="color:#38bdf8">${d.tempMin}°</span> / <span style="color:#f59e0b">${d.tempMax}°C</span>
          </div>
        </div>

        <div class="wdc-metrics-row">
          <div class="wdc-metric">🌊 <b>${d.waveHeightMax}m</b> <span style="font-size:9.5px">(${d.wavePeriodMax}s)</span></div>
          <div class="wdc-metric">💨 <b>${d.windSpeedMax} kts</b> <span style="font-size:9.5px">${d.windCompass}</span></div>
          <div class="wdc-metric">🌊 <b>PM ${d.tides.highTide1.time}</b></div>
          <div class="wdc-metric">🌙 <b>${d.moon.icon} ${d.moon.illumination}%</b></div>
        </div>

        <div class="wdc-footer">
          <span class="wdc-solunar">🎣 ${d.solunar.starString} (${d.solunar.scorePercent}%) · 🐟 ${d.solunar.majorPeriod1}</span>
          <span class="wdc-drill-cta">24h Heure par heure ➔</span>
        </div>
      </div>
    `
  }).join('')

  el.innerHTML = `
    ${currentCardHtml}
    <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 8px">
      <div style="font-size:13px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px">
        📅 ${t('forecast7Days')}
      </div>
      <span style="font-size:11px;color:var(--text-muted)">Cliquez pour les 24h</span>
    </div>
    <div class="weather-days-list">
      ${daysListHtml}
    </div>
  `
}

function openHourlyDrillDown(dayIndex) {
  if (!appState.weather || !appState.weather.days) return
  const day = appState.weather.days[dayIndex]
  if (!day) return

  const daysView = document.getElementById('weather-days-view')
  const hourlyView = document.getElementById('weather-hourly-view')
  const titleEl = document.getElementById('hourly-day-title')
  const summaryEl = document.getElementById('hourly-day-summary')
  const container = document.getElementById('hourly-cards-container')
  const panel = document.getElementById('panel-weather')

  if (daysView) daysView.classList.add('hidden')
  if (hourlyView) hourlyView.classList.remove('hidden')
  if (panel) panel.scrollTop = 0

  const dayName = appState.lang === 'ar' ? day.dayNameAr : (appState.lang === 'fr' ? day.dayNameFr : day.dayNameEn)
  if (titleEl) titleEl.textContent = `${dayName} (${day.date})`

  if (summaryEl) {
    const moonName = appState.lang === 'ar' ? day.moon.nameAr : (appState.lang === 'fr' ? day.moon.nameFr : day.moon.nameEn)

    summaryEl.innerHTML = `
      <div class="hds-box">
        <div>🌅 <b>${t('sunrise')}:</b> ${day.sunrise} · 🌇 <b>${t('sunset')}:</b> ${day.sunset}</div>
        <div>🌙 <b>${t('moonPhase')}:</b> ${day.moon.icon} ${moonName} (${day.moon.illumination}%)</div>
        <div>⏰ <b>${t('moonrise')}:</b> ${day.moon.moonrise} · <b>${t('moonset')}:</b> ${day.moon.moonset}</div>
      </div>
      <div class="hds-box">
        <div>🌊 <b>PM1:</b> ${day.tides.highTide1.time} (${day.tides.highTide1.heightM}m) · <b>BM1:</b> ${day.tides.lowTide1.time}</div>
        <div>🌊 <b>PM2:</b> ${day.tides.highTide2.time} · <b>BM2:</b> ${day.tides.lowTide2.time} (${day.tides.coefficient})</div>
        <div style="color:#f59e0b">🎣 <b>${t('fishActivity')}:</b> ${day.solunar.starString} (${day.solunar.scorePercent}%)</div>
        <div style="font-size:10px;color:var(--text)">🐟 <b>Majeures:</b> ${day.solunar.majorPeriod1} & ${day.solunar.majorPeriod2}</div>
      </div>
    `
  }

  if (container) {
    container.innerHTML = day.hourly.map(h => {
      const feedingClass = h.isMajorFeeding ? 'feeding-major' : (h.isMinorFeeding ? 'feeding-minor' : '')
      const feedingBadge = h.isMajorFeeding
        ? `<span class="hc-badge feeding">🎣 ${t('majorPeriod')}</span>`
        : (h.isMinorFeeding ? `<span class="hc-badge feeding" style="color:#38bdf8;border-color:#38bdf8">🐟 ${t('minorPeriod')}</span>` : '')

      const capeLabel = appState.lang === 'ar' ? h.capeRisk.labelAr : (appState.lang === 'fr' ? h.capeRisk.labelFr : h.capeRisk.labelEn)
      const isStorm = h.capeRisk.risk === 'high' || h.capeRisk.risk === 'extreme'
      const stormBadge = isStorm
        ? `<span class="hc-badge storm">⚡ ${capeLabel} (${h.cape} J/kg)</span>`
        : `<span class="hc-badge stable">${h.capeRisk.icon} ${capeLabel} (${h.cape} J/kg)</span>`

      const uvBadge = h.uvIndex > 0 ? `<span class="hc-badge">☀️ UV ${h.uvIndex}</span>` : ''
      const rainBadge = h.rainMm > 0 ? `<span class="hc-badge" style="color:#38bdf8">🌧️ ${h.rainMm} mm</span>` : ''
      const desc = appState.lang === 'ar' ? h.weatherInfo.ar : (appState.lang === 'fr' ? h.weatherInfo.fr : h.weatherInfo.en)

      return `
        <div class="hourly-card ${feedingClass}">
          <div class="hc-top">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="hc-hour">${h.hourStr}</span>
              <span>${h.weatherInfo.icon}</span>
              <span style="font-size:12px;color:var(--text-muted)">${desc}</span>
            </div>
            <div class="hc-temp">
              <span>🌡️ Air: <b>${h.temp}°C</b></span> • <span style="color:#38bdf8">Mer: <b>${h.seaTemp}°C</b></span>
            </div>
          </div>

          <div class="hc-grid">
            <div class="hc-item">
              <span style="color:var(--text-muted)">💨 ${t('windSpeed')}:</span>
              <b>${h.windSpeed} kts</b> ${h.windCompass}
              <div style="font-size:9.5px;color:var(--warning)">${t('gusts')}: ${h.windGusts} kts</div>
            </div>
            <div class="hc-item">
              <span style="color:var(--text-muted)">🌊 ${t('waveHeight')}:</span>
              <b>${h.waveHeight} m</b> (${h.wavePeriod}s)
              <div style="font-size:9.5px;color:#2dd4bf">Visi eau: ${h.waterVisM}m</div>
            </div>
            <div class="hc-item">
              <span style="color:var(--text-muted)">📈 ${t('instantTide')}:</span>
              <b>${h.tideHeightM} m</b>
              <div style="font-size:9.5px;color:var(--text-muted)">Visi air: ${h.visibilityKm}km</div>
            </div>
          </div>

          <div class="hc-badges">
            ${feedingBadge}
            ${stormBadge}
            ${uvBadge}
            ${rainBadge}
          </div>
        </div>
      `
    }).join('')
  }
}

function backToDaysView() {
  const daysView = document.getElementById('weather-days-view')
  const hourlyView = document.getElementById('weather-hourly-view')
  const panel = document.getElementById('panel-weather')
  if (daysView) daysView.classList.remove('hidden')
  if (hourlyView) hourlyView.classList.add('hidden')
  if (panel) panel.scrollTop = 0
}

// ---- Night Mode ----
function toggleNightMode() {
  appState.nightMode = !appState.nightMode
  applyTheme()
  saveSetting('nightMode', appState.nightMode)
  showToast(appState.nightMode ? '🔴 ' + t('nightRed') : '☀️ Mode Jour')
}

function applyTheme() {
  document.body.classList.toggle('night-mode', appState.nightMode)
  setNightMode(appState.nightMode)
  
  const btn = document.getElementById('btn-night')
  if (btn) btn.classList.toggle('active', appState.nightMode)

  const toggleBtn = document.getElementById('night-toggle-btn')
  if (toggleBtn) toggleBtn.textContent = appState.nightMode ? 'ON' : 'OFF'
}


// ---- Operating Modes: Boat vs Shore vs Dive ----
function setMode(mode) {
  appState.appMode = mode
  saveSetting('appMode', mode)
  
  const pill = document.getElementById('hud-mode-pill')
  const fabBtn = document.getElementById('btn-mode')
  const boatBtn = document.getElementById('btn-mode-boat')
  const shoreBtn = document.getElementById('btn-mode-shore')
  const diveBtn = document.getElementById('btn-mode-dive')
  const visMetric = document.getElementById('hud-metric-vis')

  let label = ''
  let icon = '⚓'
  if (mode === 'boat') {
    label = `⚓ ${t('boatMode')}`
    icon = '⚓'
    if (visMetric) visMetric.style.display = 'none'
  } else if (mode === 'shore') {
    label = `🎣 ${t('shoreMode')}`
    icon = '🎣'
    if (visMetric) visMetric.style.display = 'none'
  } else if (mode === 'dive') {
    label = `🤿 ${t('diveMode')}`
    icon = '🤿'
    if (visMetric) visMetric.style.display = 'block'
  }

  if (pill) pill.textContent = label
  if (fabBtn) fabBtn.textContent = icon

  if (boatBtn) boatBtn.classList.toggle('active', mode === 'boat')
  if (shoreBtn) shoreBtn.classList.toggle('active', mode === 'shore')
  if (diveBtn) diveBtn.classList.toggle('active', mode === 'dive')

  showToast(label)
}

function cycleMode() {
  if (appState.appMode === 'boat') setMode('shore')
  else if (appState.appMode === 'shore') setMode('dive')
  else setMode('boat')
}

// ---- Language & Localization ----
function changeLanguage(lang) {
  appState.lang = lang
  setLanguage(lang)
  saveSetting('lang', lang)
  applyLanguage(lang)
  renderSpotsPanel()
  showToast('🌐 ' + (lang === 'fr' ? 'Français' : lang === 'ar' ? 'العربية' : 'English'))
}

function applyLanguage(lang) {
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.lang = lang

  const appName = document.getElementById('app-name')
  if (appName) appName.textContent = t('appName')

  const speedLbl = document.getElementById('hud-speed-label')
  if (speedLbl) speedLbl.textContent = t('speed')

  const headingLbl = document.getElementById('hud-heading-label')
  if (headingLbl) headingLbl.textContent = t('heading')

  const depthLbl = document.getElementById('hud-depth-label')
  if (depthLbl) depthLbl.textContent = t('depth')

  const visLbl = document.getElementById('hud-vis-label')
  if (visLbl) visLbl.textContent = t('visibility')

  const coordsLbl = document.getElementById('hud-coords-label')
  if (coordsLbl) coordsLbl.textContent = t('coordinates')

  // Toolbar
  const tbSpots = document.getElementById('tb-label-spots')
  if (tbSpots) tbSpots.textContent = t('spots')

  const tbAnchor = document.getElementById('tb-label-anchor')
  if (tbAnchor) tbAnchor.textContent = t('catAnchor')

  const tbWeather = document.getElementById('tb-label-weather')
  if (tbWeather) tbWeather.textContent = t('weather')

  const tbLayers = document.getElementById('tb-label-layers')
  if (tbLayers) tbLayers.textContent = t('layers')

  const tbSettings = document.getElementById('tb-label-settings')
  if (tbSettings) tbSettings.textContent = t('settings')

  // Panels
  const pSpots = document.getElementById('panel-title-spots')
  if (pSpots) pSpots.textContent = `📍 ${t('spots')}`

  const pAnchor = document.getElementById('panel-title-anchor')
  if (pAnchor) pAnchor.textContent = `⚓ ${t('anchorAlarm')}`

  const pWeather = document.getElementById('panel-title-weather')
  if (pWeather) pWeather.textContent = `🌊 ${t('weather')}`

  const pLayers = document.getElementById('panel-title-layers')
  if (pLayers) pLayers.textContent = `🗺️ ${t('layers')}`

  const pSettings = document.getElementById('panel-title-settings')
  if (pSettings) pSettings.textContent = `⚙️ ${t('settings')}`

  // Layer titles
  const lBathy = document.getElementById('l-title-bathy')
  if (lBathy) lBathy.textContent = `🌊 ${t('layerBathy')}`

  const lContours = document.getElementById('l-title-contours')
  if (lContours) lContours.textContent = `📏 ${t('layerContours')}`

  const lSoundings = document.getElementById('l-title-soundings')
  if (lSoundings) lSoundings.textContent = `🔢 ${t('layerDepth')}`

  const lSeamap = document.getElementById('l-title-seamap')
  if (lSeamap) lSeamap.textContent = `🚢 ${t('layerSeaMap')}`

  const lHarbors = document.getElementById('l-title-harbors')
  if (lHarbors) lHarbors.textContent = `⚓ ${t('layerHarbors')}`

  const lWrecks = document.getElementById('l-title-wrecks')
  if (lWrecks) lWrecks.textContent = `🚢 ${t('layerWrecks')}`

  // Mode pill
  const pill = document.getElementById('hud-mode-pill')
  if (pill) {
    const m = appState.appMode
    pill.textContent = m === 'boat' ? `⚓ ${t('boatMode')}` : m === 'shore' ? `🎣 ${t('shoreMode')}` : `🤿 ${t('diveMode')}`
  }

  // Lang buttons
  document.getElementById('lang-fr')?.classList.toggle('active', lang === 'fr')
  document.getElementById('lang-ar')?.classList.toggle('active', lang === 'ar')
  document.getElementById('lang-en')?.classList.toggle('active', lang === 'en')

  // If weather is already rendered, re-render to update text language
  if (appState.weather) {
    renderWeatherPanel(appState.weather)
  }
}

// ---- Emergency SOS SMS ----
function sendSOS() {
  const { lat, lon } = appState.gps
  const time = new Date().toLocaleTimeString()
  const msg = t('sosMessage', {
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    time
  })
  window.location.href = `sms:?body=${encodeURIComponent(msg)}`
}

// ---- GPX Export / Import ----
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
  try {
    const text = await file.text()
    const imported = await importGPX(text)
    await loadSpots()
    showToast(`✅ Importé ${imported.length} spots`)
  } catch (err) {
    showToast('❌ Erreur format GPX')
  }
}

// ---- Distance & Bearing Ruler ----
function startRulerMode() {
  showToast('📏 ' + t('rulerStart'))
  closeAllPanels()
  closeInspector()
  
  const clearBtn = document.getElementById('btn-clear-ruler')
  if (clearBtn) clearBtn.classList.remove('hidden')

  startRuler(({ distNM, bearing }) => {
    showToast(t('rulerResult', { dist: distNM, bearing }), false, 6000)
  })
}

// ---- Toast Notification ----
function showToast(msg, persistent = false, duration = 3000) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.classList.add('visible')
  if (!persistent) {
    setTimeout(() => toast.classList.remove('visible'), duration)
  }
}

// ---- Global Wire Event Listeners ----
function setupEventListeners() {
  // Center button
  document.getElementById('btn-center')?.addEventListener('click', () => {
    panToPosition(appState.gps.lat, appState.gps.lon, 14)
    showToast('🎯 ' + t('centerMap'))
  })

  // Mode button (FAB & Settings)
  document.getElementById('btn-mode')?.addEventListener('click', cycleMode)
  document.getElementById('hud-mode-pill')?.addEventListener('click', cycleMode)
  document.getElementById('btn-mode-boat')?.addEventListener('click', () => setMode('boat'))
  document.getElementById('btn-mode-shore')?.addEventListener('click', () => setMode('shore'))
  document.getElementById('btn-mode-dive')?.addEventListener('click', () => setMode('dive'))

  // Night mode (FAB & Settings)
  document.getElementById('btn-night')?.addEventListener('click', toggleNightMode)
  document.getElementById('night-toggle-btn')?.addEventListener('click', toggleNightMode)

  // Layers FAB button
  document.getElementById('btn-open-layers-fab')?.addEventListener('click', () => openPanel('panel-layers'))

  // Quick save button
  document.getElementById('btn-quick-save')?.addEventListener('click', quickSaveSpot)

  // Toolbar navigation tabs
  document.getElementById('btn-open-spots')?.addEventListener('click', () => openPanel('panel-spots'))
  document.getElementById('btn-open-anchor')?.addEventListener('click', () => openPanel('panel-anchor'))
  document.getElementById('btn-open-weather')?.addEventListener('click', () => {
    openPanel('panel-weather')
    loadWeatherForTarget(appState.weatherTarget)
  })
  document.getElementById('btn-open-layers')?.addEventListener('click', () => openPanel('panel-layers'))
  document.getElementById('btn-open-settings')?.addEventListener('click', () => openPanel('panel-settings'))

  // Weather location target toggle
  document.getElementById('btn-weather-target-gps')?.addEventListener('click', () => {
    loadWeatherForTarget('gps')
  })
  document.getElementById('btn-weather-target-spot')?.addEventListener('click', () => {
    if (appState.selectedSpotCoords) {
      loadWeatherForTarget('spot')
    } else {
      showToast('📌 Tapez d’abord un point sur la carte')
    }
  })

  // Panel close buttons
  document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', closeAllPanels)
  })

  // Backdrop overlay click
  document.getElementById('panel-backdrop')?.addEventListener('click', closeAllPanels)

  // Inspector buttons
  document.getElementById('btn-close-inspector')?.addEventListener('click', closeInspector)
  document.getElementById('btn-insp-add-spot')?.addEventListener('click', () => {
    if (appState.tappedPoint) {
      openSpotSheet({
        name: `Spot ${appState.tappedPoint.lat.toFixed(3)}N`,
        latitude: appState.tappedPoint.lat,
        longitude: appState.tappedPoint.lon,
        depth_meters: appState.tappedPoint.depth !== undefined ? appState.tappedPoint.depth : null,
        visibility_meters: appState.tappedPoint.visibility || null,
        category: appState.appMode === 'dive' ? 'dive' : 'fishing'
      })
    }
  })
  document.getElementById('btn-insp-weather')?.addEventListener('click', () => {
    if (appState.tappedPoint) {
      openPanel('panel-weather')
      loadWeatherForTarget('spot')
    }
  })

  // Spots search filter
  document.getElementById('spots-search')?.addEventListener('input', renderSpotsPanel)

  // Spot edit save & cancel
  document.getElementById('btn-save-spot')?.addEventListener('click', saveEditingSpot)
  document.getElementById('btn-cancel-spot')?.addEventListener('click', closeAllPanels)

  // Anchor alarm controls
  document.getElementById('anchor-radius')?.addEventListener('input', (e) => {
    const valEl = document.getElementById('anchor-radius-val')
    if (valEl) valEl.textContent = `${e.target.value}m`
  })
  document.getElementById('btn-anchor-set')?.addEventListener('click', activateAnchorAlarm)
  document.getElementById('btn-anchor-clear')?.addEventListener('click', deactivateAnchor)

  // Weather fetch
  document.getElementById('btn-fetch-weather')?.addEventListener('click', () => {
    loadWeatherForTarget(appState.weatherTarget)
  })

  // Base map switcher (OSM vs Satellite)
  document.getElementById('btn-base-osm')?.addEventListener('click', () => {
    setBaseLayer('osm')
    document.getElementById('btn-base-osm')?.classList.add('active')
    document.getElementById('btn-base-satellite')?.classList.remove('active')
    showToast('🗺️ ' + t('layerOSM'))
  })
  document.getElementById('btn-base-satellite')?.addEventListener('click', () => {
    setBaseLayer('satellite')
    document.getElementById('btn-base-satellite')?.classList.add('active')
    document.getElementById('btn-base-osm')?.classList.remove('active')
    showToast('🛰️ ' + t('layerSatellite'))
  })

  // Marine Overlays Toggle Switches
  const overlaySwitches = ['bathyColor', 'contours', 'soundings', 'seamap', 'harbors', 'wrecks']
  overlaySwitches.forEach(name => {
    const sw = document.getElementById(`switch-layer-${name}`)
    if (sw) {
      sw.checked = isOverlayActive(name)
      sw.addEventListener('change', (e) => {
        toggleOverlay(name, e.target.checked)
      })
    }
  })

  // Hourly weather drill-down back button
  document.getElementById('btn-back-to-days')?.addEventListener('click', backToDaysView)

  // Language buttons
  document.getElementById('lang-fr')?.addEventListener('click', () => changeLanguage('fr'))
  document.getElementById('lang-ar')?.addEventListener('click', () => changeLanguage('ar'))
  document.getElementById('lang-en')?.addEventListener('click', () => changeLanguage('en'))

  // Units toggle (kts / kmh)
  document.getElementById('units-toggle')?.addEventListener('click', () => {
    appState.units = appState.units === 'knots' ? 'kmh' : 'knots'
    saveSetting('units', appState.units)
    const btn = document.getElementById('units-toggle')
    if (btn) btn.textContent = appState.units === 'knots' ? 'kts' : 'km/h'
    updateHUD()
  })

  // Coord format toggle (DD / DMS)
  document.getElementById('coord-toggle')?.addEventListener('click', () => {
    appState.coordFormat = appState.coordFormat === 'DD' ? 'DMS' : 'DD'
    saveSetting('coordFormat', appState.coordFormat)
    const btn = document.getElementById('coord-toggle')
    if (btn) btn.textContent = appState.coordFormat
    updateHUD()
  })

  // GPX export & import
  document.getElementById('btn-export-gpx')?.addEventListener('click', handleExportGPX)
  document.getElementById('btn-import-gpx')?.addEventListener('click', () => {
    document.getElementById('gpx-file-input')?.click()
  })
  document.getElementById('gpx-file-input')?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleImportGPX(e.target.files[0])
  })

  // Ruler measurement
  document.getElementById('btn-ruler')?.addEventListener('click', startRulerMode)
  document.getElementById('btn-ruler-settings')?.addEventListener('click', () => {
    closeAllPanels()
    startRulerMode()
  })
  document.getElementById('btn-clear-ruler')?.addEventListener('click', () => {
    clearRuler()
    document.getElementById('btn-clear-ruler')?.classList.add('hidden')
    showToast(t('clearRuler'))
  })

  // Emergency SOS
  document.getElementById('btn-sos')?.addEventListener('click', sendSOS)
}

// Global window API for inline list event handlers & popups
window.dzApp = {
  goToSpot(id) {
    const spot = appState.spots.find(s => s.id === id)
    if (spot) {
      panToPosition(spot.latitude, spot.longitude, 15)
      closeAllPanels()
      showToast(`🎯 ${spot.name}`)
    }
  },
  editSpot(id) {
    const spot = appState.spots.find(s => s.id === id)
    if (spot) openSpotSheet(spot)
  },
  async confirmDeleteSpot(id) {
    if (confirm(t('confirmDelete'))) {
      await deleteSpot(id)
      appState.spots = appState.spots.filter(s => s.id !== id)
      removeSpotMarker(id)
      renderSpotsPanel()
      showToast('🗑️ ' + t('delete'))
    }
  },
  openHourlyDrillDown(dayIndex) {
    openHourlyDrillDown(dayIndex)
  },
  backToDaysView() {
    backToDaysView()
  },
  weatherForCoords(lat, lon, label) {
    appState.selectedSpotCoords = { lat, lon }
    appState.weatherTarget = 'spot'
    openPanel('panel-weather')
    loadWeatherForTarget('spot')
    showToast(`🌊 Météo: ${label}`)
  },
  async saveHarborAsSpot(harborId) {
    const harbor = ALGERIAN_HARBORS.find(h => h.id === harborId)
    if (!harbor) return
    const newSpot = await saveSpot({
      name: harbor.name,
      latitude: harbor.lat,
      longitude: harbor.lon,
      depth_meters: harbor.depthM,
      category: 'harbor',
      color: '#10b981',
      notes: `VHF: ${harbor.vhf} | ${harbor.shelter} | ${harbor.notes}`
    })
    appState.spots.push(newSpot)
    addSpotMarker(newSpot, onSpotTap)
    renderSpotsPanel()
    showToast(`⚓ ${harbor.name} sauvegardé dans vos spots !`)
  },
  async saveWreckAsSpot(wreckId) {
    const wreck = ALGERIAN_WRECKS.find(w => w.id === wreckId)
    if (!wreck) return
    const newSpot = await saveSpot({
      name: wreck.name,
      latitude: wreck.lat,
      longitude: wreck.lon,
      depth_meters: wreck.depthM,
      category: 'wreck',
      color: '#f59e0b',
      notes: `Épave (${wreck.year > 0 ? wreck.year : Math.abs(wreck.year) + ' av. J.-C.'}) | ${wreck.notes}`
    })
    appState.spots.push(newSpot)
    addSpotMarker(newSpot, onSpotTap)
    renderSpotsPanel()
    showToast(`🚢 ${wreck.name} sauvegardé dans vos spots !`)
  }
}

// Run app
init()
