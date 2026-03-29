import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  ScaleControl,
  useMap,
} from 'react-leaflet'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useDashboard } from '../store/dashboardStore'
import type { CityData } from '../data/cityData'
import type { CellObservation, GridCell, CarbonGrid, MLNeighborhood, Prescription } from '../types/domain'

// ── TYPES ────────────────────────────────────────────────

interface MapViewProps {
  city: CityData
  activeMetric: 'temp' | 'ndvi' | 'aqi' | 'soil' | 'land' | 'carbon' | null
  onCellClick: (cellId: string, lat: number, lng: number) => void
  gridCells?: GridCell[]
  observations?: CellObservation[]
  carbonData?: CarbonGrid[]
  mlNeighborhood?: MLNeighborhood | null
}

interface FlyControlsProps {
  center: [number, number]
  zoom: number
  selectedCell: { lat: number; lng: number } | null
}

// ── FLY CONTROLS ─────────────────────────────────────────

function FlyControls({ center, zoom, selectedCell }: FlyControlsProps) {
  const map = useMap()

  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1 })
  }, [center, zoom, map])

  useEffect(() => {
    if (selectedCell) {
      map.flyTo([selectedCell.lat, selectedCell.lng], 13, { duration: 0.8 })
    }
  }, [selectedCell, map])

  return null
}

// ── COLOR HELPERS ─────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    Math.round(alpha * 255),
  ]
}

function interpolateRGBA(
  ramp: string[],
  t: number,
  alpha: number
): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const idx = clamped * (ramp.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.min(ramp.length - 1, Math.ceil(idx))
  if (lower === upper) return hexToRgba(ramp[lower], alpha)
  const f = idx - lower
  const lo = hexToRgba(ramp[lower], 1)
  const hi = hexToRgba(ramp[upper], 1)
  return [
    Math.round(lo[0] + (hi[0] - lo[0]) * f),
    Math.round(lo[1] + (hi[1] - lo[1]) * f),
    Math.round(lo[2] + (hi[2] - lo[2]) * f),
    Math.round(alpha * 255),
  ]
}

const METRIC_RAMP_CONFIG: Record<
  string,
  { key: keyof CellObservation; min: number; max: number; ramp: string[] }
> = {
  temp: {
    key: 'lst_mean',
    min: 20,
    max: 52,
    ramp: ['#313695', '#4575b4', '#74add1', '#fdae61', '#f46d43', '#d73027', '#a50026'],
  },
  ndvi: {
    key: 'ndvi_mean',
    min: 0.05,
    max: 0.7,
    ramp: ['#8b0000', '#d73027', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641', '#004529'],
  },
  aqi: {
    key: 'no2_ppb',
    min: 500,
    max: 5000,
    ramp: ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#2c7fb8', '#253494', '#081d58'],
  },
  soil: {
    key: 'soil_moisture_am',
    min: 0.08,
    max: 0.38,
    ramp: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e', '#003c30'],
  },
  land: {
    key: 'urban_fraction',
    min: 0,
    max: 1,
    ramp: ['#f7f7f7', '#cccccc', '#969696', '#636363', '#252525', '#111111', '#000000'],
  },
  carbon: {
    key: 'carbon_balance' as keyof CellObservation,
    min: -1,
    max: 1,
    ramp: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#a6d96a', '#66bd63', '#1a9850'],
  },
}

// ── CANVAS HEATMAP LAYER ─────────────────────────────────
// Renders the entire grid as a single smooth blurred bitmap image overlay.
// No SVG polygons = no grid lines = perfectly smooth.

interface CanvasHeatmapProps {
  gridCells: GridCell[]
  obsMap: Map<string, CellObservation>
  activeMetric: string | null
  onCellClick: (cellId: string, lat: number, lng: number) => void
  carbonMap?: Map<string, CarbonGrid>
}

function CanvasHeatmapLayer({
  gridCells,
  obsMap,
  activeMetric,
  onCellClick,
  carbonMap,
}: CanvasHeatmapProps) {
  const map = useMap()
  const layerRef = useRef<L.ImageOverlay | null>(null)
  const tooltipRef = useRef<L.Tooltip | null>(null)

  // Precompute grid structure
  const gridInfo = useMemo(() => {
    if (gridCells.length === 0) return null

    const uniqueRows = [...new Set(gridCells.map((c) => c.row))].sort((a, b) => a - b)
    const uniqueCols = [...new Set(gridCells.map((c) => c.col))].sort((a, b) => a - b)

    const allLats = gridCells.map((c) => c.centroid_lat)
    const allLngs = gridCells.map((c) => c.centroid_lng)
    const minLat = Math.min(...allLats)
    const maxLat = Math.max(...allLats)
    const minLng = Math.min(...allLngs)
    const maxLng = Math.max(...allLngs)

    const numRows = uniqueRows.length
    const numCols = uniqueCols.length
    const latStep = numRows > 1 ? (maxLat - minLat) / (numRows - 1) : 0.03
    const lngStep = numCols > 1 ? (maxLng - minLng) / (numCols - 1) : 0.04

    const bounds = L.latLngBounds(
      [minLat - latStep / 2, minLng - lngStep / 2],
      [maxLat + latStep / 2, maxLng + lngStep / 2]
    )

    // Row/col index maps for fast lookup
    const rowIndex = new Map<number, number>()
    uniqueRows.forEach((r, i) => rowIndex.set(r, i))
    const colIndex = new Map<number, number>()
    uniqueCols.forEach((c, i) => colIndex.set(c, i))

    return {
      uniqueRows,
      uniqueCols,
      numRows,
      numCols,
      latStep,
      lngStep,
      bounds,
      rowIndex,
      colIndex,
      minLat,
      maxLat,
      minLng,
      maxLng,
    }
  }, [gridCells])

  // Build smooth heatmap PNG
  const imageUrl = useMemo(() => {
    if (!gridInfo || !activeMetric) return null

    const cfg = METRIC_RAMP_CONFIG[activeMetric]
    if (!cfg) return null

    const { numRows, numCols, rowIndex, colIndex } = gridInfo

    // Higher scale = smoother per-cell rendering
    const scale = 8
    const w = numCols * scale
    const h = numRows * scale

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // Draw each cell as a solid rectangle
    gridCells.forEach((cell) => {
      const ri = rowIndex.get(cell.row)
      const ci = colIndex.get(cell.col)
      if (ri === undefined || ci === undefined) return

      let rgba: [number, number, number, number]

      if (activeMetric === 'carbon' && carbonMap) {
        const carbonCell = carbonMap.get(cell.id)
        if (carbonCell) {
          const t = (carbonCell.carbon_balance - cfg.min) / (cfg.max - cfg.min)
          rgba = interpolateRGBA(cfg.ramp, t, 0.75)
        } else {
          rgba = [0, 0, 0, 0] // transparent for grids without carbon data
        }
      } else {
        const obs = obsMap.get(cell.id)
        if (obs) {
          const val = obs[cfg.key] as number
          if (val != null && !isNaN(val)) {
            const t = (val - cfg.min) / (cfg.max - cfg.min)
            rgba = interpolateRGBA(cfg.ramp, t, 0.38)
          } else {
            rgba = interpolateRGBA(cfg.ramp, 0.5, 0.15)
          }
        } else {
          rgba = interpolateRGBA(cfg.ramp, 0.5, 0.15)
        }
      }

      // Invert row: lat increases upward, canvas y increases downward
      const canvasRow = numRows - 1 - ri

      ctx.fillStyle = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`
      ctx.fillRect(ci * scale, canvasRow * scale, scale, scale)
    })

    // Apply Gaussian blur for seamless smooth blending (skip for carbon — sparse data)
    const blurred = document.createElement('canvas')
    blurred.width = w
    blurred.height = h
    const bCtx = blurred.getContext('2d')!
    if (activeMetric !== 'carbon') {
      bCtx.filter = `blur(${Math.max(2, Math.floor(scale / 2))}px)`
    }
    bCtx.drawImage(canvas, 0, 0)

    return blurred.toDataURL('image/png')
  }, [gridInfo, activeMetric, obsMap, gridCells, carbonMap])

  // Add/update image overlay
  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!imageUrl || !gridInfo) return

    const overlay = L.imageOverlay(imageUrl, gridInfo.bounds, {
      opacity: 1,
      interactive: true,
    })
    overlay.addTo(map)
    layerRef.current = overlay

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [imageUrl, gridInfo, map])

  // Click — find nearest cell
  useEffect(() => {
    if (!gridInfo) return

    const handleClick = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      if (!gridInfo.bounds.contains(e.latlng)) return

      let bestDist = Infinity
      let bestCell: GridCell | undefined
      for (const cell of gridCells) {
        const d = Math.abs(cell.centroid_lat - lat) + Math.abs(cell.centroid_lng - lng)
        if (d < bestDist) {
          bestDist = d
          bestCell = cell
        }
      }

      if (bestCell) {
        onCellClick(bestCell.id, bestCell.centroid_lat, bestCell.centroid_lng)
      }
    }

    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [gridInfo, gridCells, onCellClick, map])

  // Tooltip on hover
  useEffect(() => {
    if (!gridInfo || !activeMetric) return

    const handleMove = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      if (!gridInfo.bounds.contains(e.latlng)) {
        if (tooltipRef.current) {
          map.closeTooltip(tooltipRef.current)
          tooltipRef.current = null
        }
        return
      }

      let bestDist = Infinity
      let bestCell: GridCell | undefined
      for (const cell of gridCells) {
        const d = Math.abs(cell.centroid_lat - lat) + Math.abs(cell.centroid_lng - lng)
        if (d < bestDist) {
          bestDist = d
          bestCell = cell
        }
      }

      if (bestCell && bestDist < gridInfo.latStep) {
        const obs = obsMap.get(bestCell.id)
        if (obs) {
          const tip = `<div style="font-family:monospace;font-size:10px;line-height:1.5">
            <b>${bestCell.id}</b><br/>
            LST: ${obs.lst_mean?.toFixed(1)}°C · NDVI: ${obs.ndvi_mean?.toFixed(3)}<br/>
            AQI: ${obs.aqi_proxy ?? '—'} · Risk: ${(obs.composite_risk * 10).toFixed(1)}/10
          </div>`

          if (tooltipRef.current) {
            tooltipRef.current.setLatLng(e.latlng).setContent(tip)
          } else {
            tooltipRef.current = L.tooltip({
              direction: 'top',
              className: 'cell-tooltip',
              opacity: 0.95,
              permanent: false,
            })
              .setLatLng(e.latlng)
              .setContent(tip)
              .addTo(map)
          }
        }
      } else if (tooltipRef.current) {
        map.closeTooltip(tooltipRef.current)
        tooltipRef.current = null
      }
    }

    const handleOut = () => {
      if (tooltipRef.current) {
        map.closeTooltip(tooltipRef.current)
        tooltipRef.current = null
      }
    }

    map.on('mousemove', handleMove)
    map.on('mouseout', handleOut)
    return () => {
      map.off('mousemove', handleMove)
      map.off('mouseout', handleOut)
      if (tooltipRef.current) {
        map.closeTooltip(tooltipRef.current)
        tooltipRef.current = null
      }
    }
  }, [gridInfo, gridCells, obsMap, activeMetric, map])

  return null
}

// ── GRID LINES LAYER ──────────────────────────────────────
// Renders thin grid cell borders as a separate canvas image overlay.

interface GridLinesProps {
  gridCells: GridCell[]
  isSatellite?: boolean
}

function GridLinesLayer({ gridCells, isSatellite }: GridLinesProps) {
  const map = useMap()
  const layerRef = useRef<L.ImageOverlay | null>(null)

  const gridInfo = useMemo(() => {
    if (gridCells.length === 0) return null

    const uniqueRows = [...new Set(gridCells.map((c) => c.row))].sort((a, b) => a - b)
    const uniqueCols = [...new Set(gridCells.map((c) => c.col))].sort((a, b) => a - b)

    const allLats = gridCells.map((c) => c.centroid_lat)
    const allLngs = gridCells.map((c) => c.centroid_lng)
    const minLat = Math.min(...allLats)
    const maxLat = Math.max(...allLats)
    const minLng = Math.min(...allLngs)
    const maxLng = Math.max(...allLngs)

    const numRows = uniqueRows.length
    const numCols = uniqueCols.length
    const latStep = numRows > 1 ? (maxLat - minLat) / (numRows - 1) : 0.03
    const lngStep = numCols > 1 ? (maxLng - minLng) / (numCols - 1) : 0.04

    const bounds = L.latLngBounds(
      [minLat - latStep / 2, minLng - lngStep / 2],
      [maxLat + latStep / 2, maxLng + lngStep / 2]
    )

    return { numRows, numCols, bounds }
  }, [gridCells])

  const imageUrl = useMemo(() => {
    if (!gridInfo) return null

    const { numRows, numCols } = gridInfo
    const scale = 256
    const w = numCols * scale
    const h = numRows * scale

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    ctx.strokeStyle = isSatellite ? 'rgba(0, 0, 0, 1)' : 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 2

    // Draw vertical lines
    for (let c = 0; c <= numCols; c++) {
      ctx.beginPath()
      ctx.moveTo(c * scale, 0)
      ctx.lineTo(c * scale, h)
      ctx.stroke()
    }

    // Draw horizontal lines
    for (let r = 0; r <= numRows; r++) {
      ctx.beginPath()
      ctx.moveTo(0, r * scale)
      ctx.lineTo(w, r * scale)
      ctx.stroke()
    }

    return canvas.toDataURL('image/png')
  }, [gridInfo, isSatellite])

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!imageUrl || !gridInfo) return

    const overlay = L.imageOverlay(imageUrl, gridInfo.bounds, {
      opacity: 1,
      interactive: false,
    })
    overlay.addTo(map)
    layerRef.current = overlay

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [imageUrl, gridInfo, map])

  return null
}

// ── LEGEND CONFIG ─────────────────────────────────────────

const LEGEND_CONFIG: Record<
  string,
  { title: string; items: { color: string; label: string }[] }
> = {
  temp: {
    title: 'Land Surface Temp',
    items: [
      { color: '#a50026', label: 'Extreme >46°C' },
      { color: '#f46d43', label: 'Very Hot 40–46°C' },
      { color: '#fdae61', label: 'Hot 33–40°C' },
      { color: '#74add1', label: 'Moderate 26–33°C' },
      { color: '#313695', label: 'Cool <26°C' },
    ],
  },
  ndvi: {
    title: 'Vegetation Index',
    items: [
      { color: '#004529', label: 'Dense >0.55' },
      { color: '#1a9641', label: 'Moderate 0.35–0.55' },
      { color: '#fdae61', label: 'Sparse 0.2–0.35' },
      { color: '#d73027', label: 'Low 0.1–0.2' },
      { color: '#8b0000', label: 'Critical <0.1' },
    ],
  },
  aqi: {
    title: 'Nitrogen Dioxide',
    items: [
      { color: '#081d58', label: 'Critical >4000 µg/m³' },
      { color: '#2c7fb8', label: 'High 3000–4000' },
      { color: '#7fcdbb', label: 'Moderate 2000–3000' },
      { color: '#c7e9b4', label: 'Low 1000–2000' },
      { color: '#ffffcc', label: 'Good <1000 µg/m³' },
    ],
  },
  soil: {
    title: 'Soil Moisture',
    items: [
      { color: '#003c30', label: 'Very Wet >0.32' },
      { color: '#5ab4ac', label: 'Wet 0.24–0.32' },
      { color: '#c7eae5', label: 'Moderate 0.18–0.24' },
      { color: '#d8b365', label: 'Dry 0.12–0.18' },
      { color: '#8c510a', label: 'Critical <0.12' },
    ],
  },
  land: {
    title: 'Urban Land Cover',
    items: [
      { color: '#000000', label: 'Dense Urban >80%' },
      { color: '#252525', label: 'Urban 60–80%' },
      { color: '#969696', label: 'Mixed 30–60%' },
      { color: '#cccccc', label: 'Suburban 10–30%' },
      { color: '#f7f7f7', label: 'Rural <10%' },
    ],
  },
  carbon: {
    title: 'Carbon Balance',
    items: [
      { color: '#1a9850', label: 'Strong Source >0.5' },
      { color: '#66bd63', label: 'Source 0.2–0.5' },
      { color: '#fee08b', label: 'Neutral −0.2–0.2' },
      { color: '#f46d43', label: 'Sink −0.5–−0.2' },
      { color: '#d73027', label: 'Strong Sink <−0.5' },
    ],
  },
}

// ── MAIN COMPONENT ────────────────────────────────────────

export function MapView({
  city,
  activeMetric,
  onCellClick,
  gridCells = [],
  observations = [],
  carbonData = [],
  mlNeighborhood,
}: MapViewProps) {
  const { state } = useDashboard()
  const [selectedCell, setSelectedCell] = useState<{ lat: number; lng: number } | null>(null)
  const [showGrid, setShowGrid] = useState(false)

  const tileUrl =
    state.basemap === 'satellite'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

  const obsMap = useMemo(() => {
    const m = new Map<string, CellObservation>()
    observations.forEach((o) => m.set(o.cell_id, o))
    return m
  }, [observations])

  const carbonMap = useMemo(() => {
    const m = new Map<string, CarbonGrid>()
    carbonData.forEach((c) => m.set(c.grid_id, c))
    return m
  }, [carbonData])

  const handleCellClick = useCallback(
    (cellId: string, lat: number, lng: number) => {
      setSelectedCell({ lat, lng })
      onCellClick(cellId, lat, lng)
    },
    [onCellClick]
  )

  const legendConfig = useMemo(
    () => (activeMetric ? LEGEND_CONFIG[activeMetric] : null),
    [activeMetric]
  )

  return (
    <div className="relative w-full h-full">
      <style>{`
        .leaflet-container { background: #050d0a !important; }
        .cell-tooltip {
          background: rgba(0,0,0,0.85) !important;
          border: 1px solid rgba(255,255,255,0.15) !important;
          border-radius: 8px !important;
          color: #fff !important;
          padding: 6px 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
        }
        .cell-tooltip::before { border-top-color: rgba(0,0,0,0.85) !important; }
      `}</style>

      <MapContainer
        center={city.center as [number, number]}
        zoom={city.zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={tileUrl} maxZoom={18} />
        <ZoomControl position="topright" />
        <ScaleControl position="bottomright" metric imperial={false} />

        <FlyControls
          center={city.center as [number, number]}
          zoom={city.zoom}
          selectedCell={selectedCell}
        />

        {/* Smooth canvas heatmap — single image overlay */}
        <CanvasHeatmapLayer
          gridCells={gridCells}
          obsMap={obsMap}
          activeMetric={activeMetric}
          onCellClick={handleCellClick}
          carbonMap={carbonMap}
        />

        {/* Optional thin grid lines overlay */}
        {showGrid && <GridLinesLayer gridCells={gridCells} isSatellite={state.basemap === 'satellite'} />}
      </MapContainer>

      {/* Grid toggle button */}
      <button
        onClick={() => setShowGrid((v) => !v)}
        className={`absolute top-4 left-4 z-[1000] rounded-lg px-3 py-2 flex items-center gap-2 text-xs font-medium transition-all ${showGrid
          ? 'bg-white/20 backdrop-blur-md border border-white/40 text-white'
          : 'bg-black/40 backdrop-blur-md border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10'
          }`}
        title={showGrid ? 'Hide grid lines' : 'Show grid lines'}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="1" y="1" width="5" height="5" rx="0.5" />
          <rect x="8" y="1" width="5" height="5" rx="0.5" />
          <rect x="1" y="8" width="5" height="5" rx="0.5" />
          <rect x="8" y="8" width="5" height="5" rx="0.5" />
        </svg>
        {showGrid ? 'Grid On' : 'Grid Off'}
      </button>

      {/* Legend */}
      {legendConfig && (
        <div className="absolute bottom-4 left-4 z-[1000] liquid-glass rounded-xl p-4 min-w-[160px]">
          <p className="text-xs uppercase tracking-widest text-white/50 mb-3">
            {legendConfig.title}
          </p>
          <div className="flex flex-col gap-1.5">
            {legendConfig.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="w-5 h-2 rounded-sm flex-shrink-0"
                  style={{ background: item.color }}
                />
                <span className="text-xs text-white/60">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="absolute bottom-4 right-4 z-[1000] liquid-glass rounded-xl px-3 py-2">
        <p className="text-xs text-white/40">
          {gridCells.length.toLocaleString()} cells ·{' '}
          {observations.length.toLocaleString()} obs
        </p>
      </div>
    </div>
  )
}
