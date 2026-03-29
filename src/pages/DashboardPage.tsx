import { useEffect, useState, useCallback } from 'react';
import { useDashboard } from '../store/dashboardStore';
import { activeAdapter } from '../data/dataSource';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { MapView } from '../components/MapView';
import { BottomTimeline } from '../components/BottomTimeline';
import { cities } from '../data/cityData';
import {
  GridCell,
  CellObservation,
  CitySummary,
  AnomalyCell,
  CellInsights,
  CityTimeSeriesPoint,
  MLNeighborhood,
  CarbonGrid,
} from '../types/domain';

const BloomMark = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="4" r="2" opacity="0.8" />
    <circle cx="16.4" cy="16.4" r="2" opacity="0.8" />
    <circle cx="7.6" cy="16.4" r="2" opacity="0.8" />
    <circle cx="4" cy="12" r="2" opacity="0.6" />
    <circle cx="20" cy="12" r="2" opacity="0.6" />
    <circle cx="16.4" cy="7.6" r="2" opacity="0.6" />
    <circle cx="7.6" cy="7.6" r="2" opacity="0.6" />
  </svg>
);

// ── TREND CHIP COMPONENT ──────────────────────────────────
function TrendChip({
  label,
  value,
  unit,
  delta,
  inverse,
}: {
  label: string;
  value: string;
  unit: string;
  delta: string | null;
  inverse?: boolean;
}) {
  const d = delta ? parseFloat(delta) : 0;
  const isGood = inverse ? d < 0 : d > 0;
  const isBad = inverse ? d > 0 : d < 0;
  return (
    <div className="liquid-glass rounded-lg px-2.5 py-1.5 min-w-[110px] flex-shrink-0">
      <div className="text-[9px] uppercase tracking-widest text-white/40 whitespace-nowrap">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-semibold text-white">{value}</span>
        <span className="text-[10px] text-white/40">{unit}</span>
        {delta && d !== 0 && (
          <span
            className={`text-[9px] ml-1 ${isBad
              ? 'text-red-400'
              : isGood
                ? 'text-emerald-400'
                : 'text-white/40'
              }`}
          >
            {d > 0 ? '▲' : '▼'}{Math.abs(d)}
          </span>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { state, selectCell, setBasemap, setDate } = useDashboard();

  const [gridCells, setGridCells] = useState<GridCell[]>([]);
  const [observations, setObservations] = useState<CellObservation[]>([]);
  const [summary, setSummary] = useState<CitySummary | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyCell[]>([]);
  const [insights, setInsights] = useState<CellInsights | null>(null);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [cityTimeSeries, setCityTimeSeries] = useState<CityTimeSeriesPoint[]>([]);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [activeCityKey, setActiveCityKey] = useState<'AHM'>('AHM');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mlNeighborhood, setMlNeighborhood] = useState<MLNeighborhood | null>(null);
  const [carbonData, setCarbonData] = useState<CarbonGrid[]>([]);

  const selectedObservation = observations.find((o) => o.cell_id === state.selectedCellId);
  const selectedCell = gridCells.find((c) => c.id === state.selectedCellId);

  // Load available months on city change
  useEffect(() => {
    activeAdapter.fetchMonths(activeCityKey).then(setAvailableMonths).catch(console.error);
  }, [activeCityKey]);

  // Load city-wide timeseries for the active metric layer
  useEffect(() => {
    const metricMap: Record<string, string> = {
      heat: 'lst_mean',
      pollution: 'no2_ppb',
      vegetation: 'ndvi_mean',
      carbon: 'ndvi_mean',
    };
    const metric = state.activeLayer ? metricMap[state.activeLayer] : 'composite_risk';
    activeAdapter.fetchCityTimeSeries(activeCityKey, metric).then(setCityTimeSeries).catch(console.error);
  }, [activeCityKey, state.activeLayer]);

  // Load grid, observations, summary, and anomalies on month change
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [cells, obs, sum, anom] = await Promise.all([
          activeAdapter.fetchGrid(activeCityKey),
          activeAdapter.fetchObservations(activeCityKey, state.selectedDate),
          activeAdapter.fetchSummary(activeCityKey, state.selectedDate),
          activeAdapter.fetchAnomalies(activeCityKey, state.selectedDate),
        ]);

        setGridCells(cells);
        setObservations(obs);
        setSummary(sum);
        setAnomalies(anom);
        selectCell(null);
        setClickedCoords(null);
        setInsights(null);
        setIsLoading(false);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('Error loading data:', error);
        setError(`Failed to load data: ${errorMsg}`);
        setIsLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedDate, activeCityKey]);

  // Load insights when a cell is selected
  useEffect(() => {
    if (state.selectedCellId) {
      activeAdapter
        .fetchInsights(activeCityKey, state.selectedCellId, state.selectedDate)
        .then(setInsights)
        .catch(console.error);
    } else {
      setInsights(null);
    }
  }, [state.selectedCellId, state.selectedDate, activeCityKey]);

  // Load all carbon grid data for the map layer
  useEffect(() => {
    activeAdapter
      .fetchCarbonGrids(activeCityKey)
      .then((data) => {
        console.log(`🌿 Carbon grids loaded: ${data.length} cells`);
        setCarbonData(data);
      })
      .catch((err) => {
        console.error('Carbon grids fetch error:', err);
        setCarbonData([]);
      });
  }, [activeCityKey]);

  // Load ML neighborhood data when a cell is selected (grid-staged)
  useEffect(() => {
    if (state.selectedCellId) {
      console.log(`🔬 Fetching ML data for cell: ${state.selectedCellId}`);
      activeAdapter
        .fetchMLNeighborhood(activeCityKey, state.selectedCellId)
        .then((data) => {
          console.log(`🔬 ML data received: predictions=${Object.keys(data.predictions).length}, carbon=${Object.keys(data.carbon).length}, prescriptions=${data.prescriptions.length}, anomalies=${Object.keys(data.anomalies).length}`);
          setMlNeighborhood(data);
        })
        .catch((err) => {
          console.error('ML data fetch error:', err);
          setMlNeighborhood(null);
        });
    } else {
      setMlNeighborhood(null);
    }
  }, [state.selectedCellId, activeCityKey]);

  const handleMonthSelect = useCallback(
    (month: string) => {
      setDate(month);
    },
    [setDate]
  );

  function layerToMetric(layer: typeof state.activeLayer): 'temp' | 'ndvi' | 'aqi' | 'soil' | 'land' | 'carbon' | null {
    if (layer === 'heat') return 'temp';
    if (layer === 'pollution') return 'aqi';
    if (layer === 'vegetation') return 'ndvi';
    if (layer === 'carbon') return 'carbon';
    return 'temp'; // default to temp heatmap so map is always colored
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-gradient-to-br from-gray-950 via-gray-900 to-black">
      {/* ERROR BANNER */}
      {error && (
        <div className="bg-red-500/20 border border-red-400 text-red-100 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* TOP BAR */}
      <div className="h-16 flex-shrink-0 bg-black/40 backdrop-blur-xl border-b border-white/10 px-4 flex items-center gap-3 overflow-hidden">
        {/* Left: Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <BloomMark />
          <span className="text-lg font-semibold text-white">BHOOMI</span>
        </div>

        {/* Center: Summary Chips — stable widths, no overflow collision */}
        {summary && !isLoading && (
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scrollbar-hide mx-2">
            <TrendChip
              label="Avg Temp"
              value={summary.avg_lst}
              unit="°C"
              delta={summary.trends.lst_delta}
              inverse
            />
            <TrendChip
              label="Avg NDVI"
              value={summary.avg_ndvi}
              unit=""
              delta={summary.trends.ndvi_delta}
            />
            <TrendChip
              label="Avg AQI"
              value={summary.avg_aqi}
              unit=""
              delta={summary.trends.aqi_delta}
              inverse
            />
            <TrendChip
              label="Risk Score"
              value={(parseFloat(summary.avg_risk) * 10).toFixed(1)}
              unit="/10"
              delta={
                summary.trends.risk_delta
                  ? (parseFloat(summary.trends.risk_delta) * 10).toFixed(1)
                  : null
              }
              inverse
            />
            <div className="liquid-glass rounded-lg px-2.5 py-1.5 flex-shrink-0">
              <div className="text-[9px] uppercase tracking-widest text-white/40">
                Alerts
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300">
                  {summary.critical_cells} crit
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300">
                  {summary.high_cells} high
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* City label */}
          <div className="rounded-full px-3 py-1.5 text-xs liquid-glass-strong text-white">
            Ahmedabad
          </div>

          {/* Month selector */}
          <select
            value={state.selectedDate}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-full px-3 py-1.5 text-xs text-white bg-gray-900 border border-white/20 focus:outline-none focus:border-white/40 cursor-pointer appearance-none pr-6"
            style={{
              colorScheme: 'dark',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M3 5l3 3 3-3'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
            }}
          >
            {availableMonths.map((m) => (
              <option key={m} value={m} className="bg-gray-900 text-white py-1">
                {new Date(m + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>

          {/* Basemap toggle */}
          <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md border border-white/10 rounded-full p-0.5">
            {['Dark', 'Satellite'].map((style) => (
              <button
                key={style}
                onClick={() =>
                  setBasemap(style.toLowerCase() as 'dark' | 'satellite')
                }
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${state.basemap === style.toLowerCase()
                  ? 'bg-white/15 backdrop-blur-md border border-white/30 text-white'
                  : 'text-white/60 hover:text-white/80'
                  }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* LOADING INDICATOR */}
      {isLoading && (
        <div className="h-0.5 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 animate-pulse" />
      )}

      {/* MAIN CONTENT */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL */}
        <LeftPanel />

        {/* MAP + TIMELINE */}
        <div className="relative flex-1 h-full min-h-0 overflow-hidden flex flex-col">
          {/* MAP */}
          <div className="relative flex-1 min-h-0 liquid-glass rounded-2xl overflow-hidden">
            <MapView
              city={cities[activeCityKey]}
              activeMetric={layerToMetric(state.activeLayer)}
              onCellClick={(cellId, lat, lng) => {
                selectCell(cellId);
                setClickedCoords({ lat, lng });
              }}
              observations={observations}
              gridCells={gridCells}
              carbonData={carbonData}
              mlNeighborhood={mlNeighborhood}
            />
          </div>

          {/* BOTTOM TIMELINE */}
          <BottomTimeline
            availableMonths={availableMonths}
            selectedMonth={state.selectedDate}
            onMonthSelect={handleMonthSelect}
            cityTimeSeries={cityTimeSeries}
            activeLayer={state.activeLayer}
          />
        </div>

        {/* RIGHT PANEL */}
        <RightPanel
          selectedCell={
            selectedCell
              ? {
                id: selectedCell.id,
                centroid_lat: clickedCoords ? clickedCoords.lat : selectedCell.centroid_lat,
                centroid_lng: clickedCoords ? clickedCoords.lng : selectedCell.centroid_lng,
              }
              : undefined
          }
          selectedObservation={selectedObservation}
          observations={observations}
          insights={insights}
          summary={summary}
          cityKey={activeCityKey}
          selectedMonth={state.selectedDate}
          mlData={mlNeighborhood}
        />
      </div>
    </div>
  );
}
