// DZ Marine - Leaflet Map Engine
import L from 'leaflet'
import { haversineDistance, bearingTo } from './anchor.js'

let map = null
let positionMarker = null
let bearingCone = null
let anchorCircle = null
let anchorMarker = null
let rulerPoints = []
let rulerLine = null
let rulerMarkers = []
let spotMarkers = new Map()

// Tile layers
let layers = {}
let activeLayers = new Set(['osm'])

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
    options: { attribution: '© OpenSeaMap', maxZoom: 18, opacity: 0.9 }
  },
  bathy: {
    url: 'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png',
    options: { attribution: '© EMODnet Bathymetry', maxZoom: 11, opacity: 0.65 }
  }
}

export function initMap(containerId) {
  // Algeria center
  map = L.map(containerId, {
    center: [36.7, 3.1],
    zoom: 10,
    zoomControl: false,
    attributionControl: true
  })

  // Default: OSM base
  layers.osm = L.tileLayer(TILE_DEFS.osm.url, TILE_DEFS.osm.options).addTo(map)
  layers.satellite = L.tileLayer(TILE_DEFS.satellite.url, TILE_DEFS.satellite.options)
  layers.seamap = L.tileLayer(TILE_DEFS.seamap.url, TILE_DEFS.seamap.options)
  layers.bathy = L.tileLayer(TILE_DEFS.bathy.url, TILE_DEFS.bathy.options)

  // Attribution control compact
  map.attributionControl.setPrefix('')

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

// Position marker with bearing cone
export function updatePosition(lat, lon, cog, accuracy) {
  const latlng = [lat, lon]

  if (!positionMarker) {
    // Boat icon
    const boatIcon = L.divIcon({
      html: `<div class="boat-marker" style="transform: rotate(${cog || 0}deg)">
        <div class="boat-cone"></div>
        <div class="boat-dot"></div>
      </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      className: ''
    })
    positionMarker = L.marker(latlng, { icon: boatIcon, zIndexOffset: 1000 }).addTo(map)

    if (accuracy) {
      anchorCircle = L.circle(latlng, { radius: accuracy, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.05, weight: 1 }).addTo(map)
    }
  } else {
    positionMarker.setLatLng(latlng)
    const icon = positionMarker.getIcon()
    const el = positionMarker.getElement()
    if (el) {
      const inner = el.querySelector('.boat-marker')
      if (inner) inner.style.transform = `rotate(${cog || 0}deg)`
    }
    if (anchorCircle && accuracy) anchorCircle.setLatLng(latlng).setRadius(accuracy)
  }
}

export function panToPosition(lat, lon) {
  if (map) map.panTo([lat, lon], { animate: true, duration: 0.8 })
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
  if (spotMarkers.has(spot.id)) {
    spotMarkers.get(spot.id).remove()
  }
  const cat = CATEGORY_ICONS[spot.category] || CATEGORY_ICONS.fishing
  const icon = L.divIcon({
    html: `<div style="background:${spot.color || cat.color};width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${cat.icon}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    className: ''
  })
  const marker = L.marker([spot.latitude, spot.longitude], { icon })
    .addTo(map)
    .on('click', () => onTap(spot))
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
  if (bearingCone) bearingCone.remove()

  const anchorIcon = L.divIcon({
    html: `<div style="font-size:24px;text-align:center;line-height:1">⚓</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    className: ''
  })
  anchorMarker = L.marker([lat, lon], { icon: anchorIcon }).addTo(map)
  bearingCone = L.circle([lat, lon], {
    radius,
    color: '#f59e0b',
    fillColor: '#f59e0b',
    fillOpacity: 0.12,
    weight: 2,
    dashArray: '6 4'
  }).addTo(map)
}

export function hideAnchorZone() {
  if (anchorMarker) { anchorMarker.remove(); anchorMarker = null }
  if (bearingCone) { bearingCone.remove(); bearingCone = null }
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
  map.once('click', handleRulerClick)
}

function handleRulerClick(e) {
  rulerPoints.push(e.latlng)
  const dotIcon = L.divIcon({
    html: `<div style="width:12px;height:12px;background:#f59e0b;border-radius:50%;border:2px solid white"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6], className: ''
  })
  rulerMarkers.push(L.marker(e.latlng, { icon: dotIcon }).addTo(map))

  if (rulerPoints.length === 1) {
    map.once('click', handleRulerClick)
  } else if (rulerPoints.length === 2) {
    const [a, b] = rulerPoints
    const distM = haversineDistance(a.lat, a.lng, b.lat, b.lng)
    const distNM = (distM / 1852).toFixed(2)
    const bearing = bearingTo(a.lat, a.lng, b.lat, b.lng)
    rulerLine = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
      color: '#f59e0b', weight: 2.5, dashArray: '8 4'
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
  map.off('click', handleRulerClick)
  rulerMode = false
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
