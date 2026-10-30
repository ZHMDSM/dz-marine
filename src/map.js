// DZ Marine - Leaflet Map Engine
import L from 'leaflet'
import { haversineDistance, bearingTo } from './anchor.js'

let map = null
let positionMarker = null
let positionAccuracyCircle = null
let anchorCircle = null
let anchorMarker = null
let rulerPoints = []
let rulerLine = null
let rulerMarkers = []
let spotMarkers = new Map()
let tapMarker = null

// Tile layers
let layers = {}
let activeLayers = new Set(['osm', 'seamap', 'bathy', 'depthContour'])

const TILE_DEFS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { attribution: '© OpenStreetMap', maxZoom: 19, subdomains: 'abc' }
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { attribution: '© ESRI World Imagery', maxZoom: 19 }
  },
  seamap: {
    url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    options: { attribution: '© OpenSeaMap', maxZoom: 18, opacity: 0.95 }
  },
  bathy: {
    url: 'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png',
    options: { attribution: '© EMODnet Bathymetry', maxNativeZoom: 11, maxZoom: 19, opacity: 0.75 }
  },
  depthContour: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
    options: { attribution: '© ESRI Depth Soundings', maxZoom: 16, opacity: 0.85 }
  }
}

export function initMap(containerId, onMapClickCallback) {
  // Center on Algiers / Algerian central coastline
  map = L.map(containerId, {
    center: [36.75, 3.06],
    zoom: 11,
    zoomControl: false,
    attributionControl: false
  })

  // Initialize all tile layers
  layers.osm = L.tileLayer(TILE_DEFS.osm.url, TILE_DEFS.osm.options)
  layers.satellite = L.tileLayer(TILE_DEFS.satellite.url, TILE_DEFS.satellite.options)
  layers.seamap = L.tileLayer(TILE_DEFS.seamap.url, TILE_DEFS.seamap.options)
  layers.bathy = L.tileLayer(TILE_DEFS.bathy.url, TILE_DEFS.bathy.options)
  layers.depthContour = L.tileLayer(TILE_DEFS.depthContour.url, TILE_DEFS.depthContour.options)

  // Add default active layers to map
  layers.osm.addTo(map)
  layers.seamap.addTo(map)
  layers.bathy.addTo(map)
  layers.depthContour.addTo(map)

  // Map click handler
  map.on('click', (e) => {
    if (rulerMode) {
      handleRulerClick(e)
      return
    }
    if (onMapClickCallback) {
      onMapClickCallback(e.latlng)
    }
  })

  return map
}

export function getMap() { return map }

export function toggleLayer(name, show) {
  if (!layers[name]) return
  if (show) {
    if (name === 'osm') { layers.satellite?.remove(); activeLayers.delete('satellite') }
    if (name === 'satellite') { layers.osm?.remove(); activeLayers.delete('osm') }
    layers[name].addTo(map)
    activeLayers.add(name)
  } else {
    layers[name].remove()
    activeLayers.delete(name)
  }
}

export function isLayerActive(name) { return activeLayers.has(name) }

// Position marker with boat icon & directional cone
export function updatePosition(lat, lon, cog, accuracy) {
  if (!map) return
  const latlng = [lat, lon]

  if (!positionMarker) {
    const boatIcon = L.divIcon({
      html: `<div class="boat-marker" style="transform: rotate(${cog || 0}deg)">
        <div class="boat-cone"></div>
        <div class="boat-dot"></div>
      </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      className: ''
    })
    positionMarker = L.marker(latlng, { icon: boatIcon, zIndexOffset: 1000 }).addTo(map)

    if (accuracy && accuracy > 0) {
      positionAccuracyCircle = L.circle(latlng, {
        radius: accuracy,
        color: '#0ea5e9',
        fillColor: '#0ea5e9',
        fillOpacity: 0.12,
        weight: 1
      }).addTo(map)
    }
  } else {
    positionMarker.setLatLng(latlng)
    const el = positionMarker.getElement()
    if (el) {
      const inner = el.querySelector('.boat-marker')
      if (inner) inner.style.transform = `rotate(${cog || 0}deg)`
    }
    if (positionAccuracyCircle && accuracy) {
      positionAccuracyCircle.setLatLng(latlng).setRadius(accuracy)
    }
  }
}

export function panToPosition(lat, lon, zoom = null) {
  if (!map) return
  if (zoom) {
    map.setView([lat, lon], zoom, { animate: true, duration: 0.8 })
  } else {
    map.panTo([lat, lon], { animate: true, duration: 0.8 })
  }
}

// Temporary tap indicator on map
export function setTapMarker(lat, lon) {
  if (tapMarker) {
    tapMarker.setLatLng([lat, lon])
  } else {
    const tapIcon = L.divIcon({
      html: `<div style="width:16px;height:16px;background:#0ea5e9;border:3px solid white;border-radius:50%;box-shadow:0 0 10px #0ea5e9"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      className: ''
    })
    tapMarker = L.marker([lat, lon], { icon: tapIcon, zIndexOffset: 900 }).addTo(map)
  }
}

export function clearTapMarker() {
  if (tapMarker) {
    tapMarker.remove()
    tapMarker = null
  }
}

// Spot markers
const CATEGORY_ICONS = {
  fishing: { icon: '🎣', color: '#3b82f6' },
  anchor: { icon: '⚓', color: '#8b5cf6' },
  danger: { icon: '⚠️', color: '#ef4444' },
  harbor: { icon: '⛵', color: '#10b981' },
  dive: { icon: '🤿', color: '#06b6d4' },
  wreck: { icon: '🚢', color: '#f59e0b' },
}

export function addSpotMarker(spot, onTap) {
  if (!map) return
  if (spotMarkers.has(spot.id)) {
    spotMarkers.get(spot.id).remove()
  }
  const cat = CATEGORY_ICONS[spot.category] || CATEGORY_ICONS.fishing
  const depthBadge = spot.depth_meters ? `<div style="position:absolute;bottom:-6px;right:-8px;background:#0f172a;color:#38bdf8;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;border:1px solid #38bdf8">${Math.round(spot.depth_meters)}m</div>` : ''

  const icon = L.divIcon({
    html: `<div style="position:relative;background:${spot.color || cat.color};width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.5)">
      ${cat.icon}
      ${depthBadge}
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    className: ''
  })
  const marker = L.marker([spot.latitude, spot.longitude], { icon })
    .addTo(map)
    .on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      onTap(spot)
    })
  spotMarkers.set(spot.id, marker)
  return marker
}

export function removeSpotMarker(id) {
  if (spotMarkers.has(id)) {
    spotMarkers.get(id).remove()
    spotMarkers.delete(id)
  }
}

export function clearAllSpotMarkers() {
  spotMarkers.forEach(m => m.remove())
  spotMarkers.clear()
}

// Anchor zone
export function showAnchorZone(lat, lon, radius) {
  if (anchorMarker) anchorMarker.remove()
  if (anchorCircle) anchorCircle.remove()

  const anchorIcon = L.divIcon({
    html: `<div style="font-size:26px;text-align:center;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">⚓</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 26],
    className: ''
  })
  anchorMarker = L.marker([lat, lon], { icon: anchorIcon }).addTo(map)
  anchorCircle = L.circle([lat, lon], {
    radius,
    color: '#f59e0b',
    fillColor: '#f59e0b',
    fillOpacity: 0.15,
    weight: 2,
    dashArray: '6 4'
  }).addTo(map)
}

export function hideAnchorZone() {
  if (anchorMarker) { anchorMarker.remove(); anchorMarker = null }
  if (anchorCircle) { anchorCircle.remove(); anchorCircle = null }
}

// Distance ruler
let rulerMode = false
let rulerCallback = null

export function startRuler(onResult) {
  rulerMode = true
  rulerCallback = onResult
  rulerPoints = []
  clearRuler()
  map.getContainer().style.cursor = 'crosshair'
}

function handleRulerClick(e) {
  rulerPoints.push(e.latlng)
  const dotIcon = L.divIcon({
    html: `<div style="width:14px;height:14px;background:#f59e0b;border-radius:50%;border:2px solid white;box-shadow:0 0 8px rgba(0,0,0,0.5)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7], className: ''
  })
  rulerMarkers.push(L.marker(e.latlng, { icon: dotIcon }).addTo(map))

  if (rulerPoints.length === 2) {
    const [a, b] = rulerPoints
    const distM = haversineDistance(a.lat, a.lng, b.lat, b.lng)
    const distNM = (distM / 1852).toFixed(2)
    const bearing = bearingTo(a.lat, a.lng, b.lat, b.lng)
    rulerLine = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
      color: '#f59e0b', weight: 3, dashArray: '8 5'
    }).addTo(map)
    map.getContainer().style.cursor = ''
    rulerMode = false
    rulerCallback?.({ distNM, bearing })
  }
}

export function clearRuler() {
  rulerMarkers.forEach(m => m.remove())
  rulerMarkers = []
  if (rulerLine) { rulerLine.remove(); rulerLine = null }
  rulerPoints = []
  map.getContainer().style.cursor = ''
  rulerMode = false
}

export function isRulerActive() {
  return rulerMode
}

export function setNightMode(active) {
  const container = map?.getContainer()
  if (!container) return
  if (active) {
    container.classList.add('map-night')
  } else {
    container.classList.remove('map-night')
  }
}
