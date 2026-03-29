import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Sparkles,
  Lightbulb,
  FileDown,
  TrendingUp,
  TrendingDown,
  Droplets,
  Wind,
  Thermometer,
  Leaf,
  BarChart3,
  TreePine,
  Zap,
  Shield,
  Clock,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useDashboard } from '../store/dashboardStore';
import { activeAdapter } from '../data/dataSource';
import { METRIC_META } from '../data/metricConfig';
import type {
  CellObservation,
  MetricKey,
  CellInsights,
  CitySummary,
  TimeSeriesPoint,
  MLNeighborhood,
} from '../types/domain';
import { generateGridReport, buildReportData } from '../services/reportGenerator';

interface RightPanelProps {
  selectedCell?: { id: string; centroid_lat: number; centroid_lng: number };
  selectedObservation?: CellObservation;
  observations?: CellObservation[];
  insights?: CellInsights | null;
  summary?: CitySummary | null;
  cityKey?: string;
  selectedMonth?: string;
  mlData?: MLNeighborhood | null;
}

function MiniStat({
  icon: Icon,
  label,
  value,
  unit,
  severity,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  unit: string;
  severity?: string;
}) {
  const colors: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    moderate: 'text-yellow-400',
    normal: 'text-emerald-400',
  };
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon size={14} className="text-white/40 flex-shrink-0" />
      <span className="text-[11px] text-white/50 flex-1">{label}</span>
      <span className={`text-[11px] font-mono font-medium ${colors[severity || 'normal'] || 'text-white/70'}`}>
        {value}
      </span>
      <span className="text-[10px] text-white/30">{unit}</span>
    </div>
  );
}

export function RightPanel({
  selectedCell,
  selectedObservation,
  observations = [],
  insights,
  summary,
  cityKey = 'AHM',
  selectedMonth = '2025-06',
  mlData,
}: RightPanelProps) {
  const { state } = useDashboard();
  const [showReportToast, setShowReportToast] = useState(false);
  const [cellTimeSeries, setCellTimeSeries] = useState<TimeSeriesPoint[]>([]);

  // Fetch cell-specific time series when a cell is selected
  useEffect(() => {
    if (selectedCell && state.activeLayer) {
      const metricMap: Record<string, MetricKey> = {
        heat: 'lst_mean',
        pollution: 'no2_ppb',
        vegetation: 'ndvi_mean',
        carbon: 'ndvi_mean',
      };
      const metric = metricMap[state.activeLayer];
      activeAdapter
        .fetchTimeSeries(cityKey, selectedCell.id, metric, 60)
        .then(setCellTimeSeries)
        .catch(() => setCellTimeSeries([]));
    } else {
      setCellTimeSeries([]);
    }
  }, [selectedCell, state.activeLayer, cityKey]);

  const handleDownloadReport = async () => {
    if (!selectedCell || !mlData) {
      setShowReportToast(true);
      setTimeout(() => setShowReportToast(false), 3000);
      return;
    }

    try {
      setShowReportToast(true);
      const reportData = buildReportData(
        selectedCell.id,
        mlData,
        selectedObservation,
        selectedCell,
        observations,
      );

      await generateGridReport({
        ...reportData,
        geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
      });
    } catch (err) {
      console.error('[BHOOMI] Report generation failed:', err);
    } finally {
      setTimeout(() => setShowReportToast(false), 3000);
    }
  };

  const getSeverityLabel = (risk: number): { label: string; color: string } => {
    if (risk >= 0.7) return { label: 'CRITICAL', color: 'text-red-400 bg-red-500/15' };
    if (risk >= 0.5) return { label: 'HIGH', color: 'text-orange-400 bg-orange-500/15' };
    if (risk >= 0.3) return { label: 'MODERATE', color: 'text-yellow-400 bg-yellow-500/15' };
    return { label: 'NORMAL', color: 'text-emerald-400 bg-emerald-500/15' };
  };

  const layerColors: Record<string, string> = {
    heat: '#f97316',
    pollution: '#8b5cf6',
    vegetation: '#22c55e',
    carbon: '#10b981',
  };
  const chartColor = state.activeLayer ? layerColors[state.activeLayer] : '#06b6d4';

  return (
    <div className="h-full w-80 flex-shrink-0 flex flex-col bg-black/40 backdrop-blur-xl border-l border-white/10">
      <div className="flex-1 overflow-y-auto">
        {/* STATE A: No cell selected — show city overview */}
        {!selectedCell ? (
          <div className="flex flex-col p-4 gap-4">
            {/* City overview */}
            <div className="text-center pt-8 pb-4">
              <div className="grid grid-cols-3 gap-2 mb-6">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-xl bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/20 text-xs font-mono"
                  >
                    R{String(Math.floor(i / 3)).padStart(2, '0')} C{String(i % 3).padStart(2, '0')}
                  </div>
                ))}
              </div>
              <p className="text-white/40 text-sm mb-1">Click any grid cell on the map</p>
              <p className="text-white/30 text-xs italic">
                Real-time insights from 1183 monitored cells
              </p>
            </div>

            {/* City summary stats */}
            {summary && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-3 font-semibold">
                  City Overview · {selectedMonth}
                </div>
                <MiniStat icon={Thermometer} label="Avg Temperature" value={summary.avg_lst} unit="°C" />
                <MiniStat icon={Leaf} label="Avg NDVI" value={summary.avg_ndvi} unit="" />
                <MiniStat icon={Wind} label="Avg AQI" value={summary.avg_aqi} unit=""
                  severity={parseInt(summary.avg_aqi) > 200 ? 'high' : 'normal'}
                />
                <MiniStat icon={Droplets} label="Avg Soil Moisture" value={summary.avg_soil_moisture} unit="cm³/cm³" />
                <MiniStat icon={BarChart3} label="Avg Risk Score" value={(parseFloat(summary.avg_risk) * 10).toFixed(1)} unit="/10"
                  severity={parseFloat(summary.avg_risk) > 0.5 ? 'high' : 'normal'}
                />
                <div className="mt-3 pt-3 border-t border-white/10">
                  <div className="flex items-center gap-2 justify-between">
                    <span className="text-[10px] text-red-400">
                      {summary.critical_cells} critical
                    </span>
                    <span className="text-[10px] text-orange-400">
                      {summary.high_cells} high risk
                    </span>
                    <span className="text-[10px] text-yellow-400">
                      {summary.moderate_cells} moderate
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* STATE B: Cell selected */
          <div className="p-4 space-y-3">
            {/* CELL HEADER */}
            <div>
              <div className="font-mono text-sm text-white/70">{selectedCell.id}</div>
              <div className="text-xs text-white/50 mt-0.5">
                {selectedCell.centroid_lat.toFixed(4)}°N, {selectedCell.centroid_lng.toFixed(4)}°E
              </div>
              <div className="bg-white/10 h-px my-3" />
            </div>

            {/* COMPOSITE RISK CARD */}
            {selectedObservation && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                    Risk Assessment
                  </div>
                  {(() => {
                    const sev = getSeverityLabel(selectedObservation.composite_risk);
                    return (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sev.color}`}>
                        {sev.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {(selectedObservation.composite_risk).toFixed(1)}
                  <span className="text-sm text-white/40 font-normal ml-1">/10</span>
                </div>

                {/* Quick metrics grid */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-white/40">LST</div>
                    <div className="text-sm font-medium text-white">{selectedObservation.lst_mean?.toFixed(1)}°C</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-white/40">NDVI</div>
                    <div className="text-sm font-medium text-white">{selectedObservation.ndvi_mean?.toFixed(3)}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-white/40">AQI</div>
                    <div className="text-sm font-medium text-white">{selectedObservation.aqi_proxy ?? '—'}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-white/40">Soil Moisture</div>
                    <div className="text-sm font-medium text-white">{selectedObservation.soil_moisture_am?.toFixed(3)}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-white/40">VHI</div>
                    <div className="text-sm font-medium text-white">{selectedObservation.vhi?.toFixed(3) ?? '—'}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2 py-1.5">
                    <div className="text-[9px] text-white/40">Drought Risk</div>
                    <div className="text-sm font-medium text-white">
                      {selectedObservation.drought_risk != null
                        ? `${(selectedObservation.drought_risk * 100).toFixed(0)}%`
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* LULC breakdown */}
                {selectedObservation.built_pct != null && (
                  <div className="mt-3 pt-2 border-t border-white/10">
                    <div className="text-[9px] text-white/40 mb-1.5">Land Cover</div>
                    <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
                      {[
                        { pct: selectedObservation.built_pct, color: '#ef4444', label: 'Built' },
                        { pct: selectedObservation.trees_pct, color: '#22c55e', label: 'Trees' },
                        { pct: selectedObservation.crops_pct, color: '#eab308', label: 'Crops' },
                        { pct: selectedObservation.water_pct, color: '#3b82f6', label: 'Water' },
                        { pct: selectedObservation.bare_pct, color: '#a8a29e', label: 'Bare' },
                        { pct: selectedObservation.rangeland_pct, color: '#84cc16', label: 'Range' },
                      ]
                        .filter((s) => (s.pct || 0) > 0)
                        .map((s, i) => (
                          <div
                            key={i}
                            className="h-full"
                            style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                            title={`${s.label}: ${s.pct?.toFixed(1)}%`}
                          />
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {[
                        { pct: selectedObservation.built_pct, color: '#ef4444', label: 'Built' },
                        { pct: selectedObservation.trees_pct, color: '#22c55e', label: 'Trees' },
                        { pct: selectedObservation.crops_pct, color: '#eab308', label: 'Crops' },
                      ]
                        .filter((s) => (s.pct || 0) > 0)
                        .map((s, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                            <span className="text-[9px] text-white/40">{s.label} {s.pct?.toFixed(0)}%</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MINI TIME SERIES CHART */}
            {cellTimeSeries.length > 0 && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} className="text-white/40" />
                  <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                    Cell Trend · {state.activeLayer || 'Risk'}
                  </div>
                </div>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cellTimeSeries} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="cellGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" hide />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(0,0,0,0.85)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: '8px',
                          fontSize: '10px',
                          color: '#fff',
                        }}
                      />
                      {/* City avg reference */}
                      <Area
                        type="monotone"
                        dataKey="cityAvg"
                        stroke="rgba(255,255,255,0.15)"
                        fill="none"
                        strokeDasharray="3 3"
                        dot={false}
                      />
                      {/* Cell value */}
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={chartColor}
                        strokeWidth={1.5}
                        fill="url(#cellGrad)"
                        dot={false}
                      />
                      <ReferenceLine
                        x={selectedMonth}
                        stroke="rgba(255,255,255,0.3)"
                        strokeDasharray="2 2"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 rounded-full" style={{ background: chartColor }} />
                    <span className="text-[9px] text-white/40">Cell</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 rounded-full bg-white/20" style={{ borderTop: '1px dashed rgba(255,255,255,0.3)' }} />
                    <span className="text-[9px] text-white/40">City Avg</span>
                  </div>
                </div>
              </div>
            )}

            {/* AI INSIGHTS CARD */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-white/50" />
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                  AI Analysis
                </div>
                {insights && insights.confidence > 0 && (
                  <span className="ml-auto text-[10px] text-cyan-400/70">
                    {(insights.confidence * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
              {insights && insights.drivers.length > 0 ? (
                <div className="space-y-2">
                  {insights.drivers.map((driver, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle
                        size={12}
                        className={`flex-shrink-0 mt-0.5 ${driver.severity === 'critical'
                          ? 'text-red-400'
                          : driver.severity === 'high'
                            ? 'text-orange-400'
                            : 'text-yellow-400'
                          }`}
                      />
                      <div>
                        <p className="text-[11px] text-white/70 leading-relaxed">{driver.text}</p>
                        <div className="flex gap-2 mt-0.5">
                          {driver.delta_mom && (
                            <span className="text-[9px] text-white/40">
                              MoM: {parseFloat(driver.delta_mom) > 0 ? '↑' : '↓'}{' '}
                              {Math.abs(parseFloat(driver.delta_mom))}
                            </span>
                          )}
                          {driver.delta_yoy && (
                            <span className="text-[9px] text-white/40">
                              YoY: {parseFloat(driver.delta_yoy) > 0 ? '↑' : '↓'}{' '}
                              {Math.abs(parseFloat(driver.delta_yoy))}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 flex-shrink-0 mt-1.5" />
                    <p className="text-[11px] text-white/50 leading-relaxed">
                      No critical anomalies detected for this cell in the selected month
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* RECOMMENDATIONS CARD */}
            {insights && insights.recommendations.length > 0 && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb size={16} className="text-white/50" />
                  <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                    Recommended Actions
                  </div>
                </div>
                <div className="space-y-3">
                  {insights.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[10px] font-mono text-cyan-400/60 w-5 flex-shrink-0">
                        P{rec.priority}
                      </span>
                      <div>
                        <p className="text-[11px] text-white/70 leading-relaxed">{rec.text}</p>
                        <p className="text-[9px] text-white/30 mt-0.5 italic">{rec.impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* EXTENDED METRICS */}
            {selectedObservation && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2 font-semibold">
                  Extended Metrics
                </div>
                <MiniStat icon={Thermometer} label="Air Temperature" value={selectedObservation.temp_celsius?.toFixed(1) || '—'} unit="°C" />
                <MiniStat icon={Wind} label="Wind Speed" value={selectedObservation.wind_speed_ms?.toFixed(1) || '—'} unit="m/s" />
                <MiniStat icon={Droplets} label="Rainfall" value={selectedObservation.rainfall_mm?.toFixed(1) || '—'} unit="mm" />
                <MiniStat icon={BarChart3} label="SPI-30d" value={selectedObservation.spi_30d?.toFixed(2) || '—'} unit=""
                  severity={selectedObservation.spi_30d != null && selectedObservation.spi_30d < -1 ? 'high' : 'normal'}
                />
                <MiniStat icon={Leaf} label="VCI" value={selectedObservation.vci?.toFixed(3) || '—'} unit="" />
                <MiniStat icon={Leaf} label="TCI" value={selectedObservation.tci?.toFixed(3) || '—'} unit="" />
              </div>
            )}

            {/* ── ML FORECAST CARD ─── */}
            {mlData && Object.keys(mlData.predictions).length > 0 && (() => {
              const centerPred = mlData.predictions[mlData.cellId];
              if (!centerPred) return null;
              const horizons = ['1d', '7d', '30d', '90d', '180d'];
              const keyMetrics = ['lst_celsius', 'ndvi', 'aqi_proxy', 'carbon_balance'];
              return (
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={16} className="text-white/50" />
                    <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                      ML Forecast
                    </div>
                    <span className="ml-auto text-[10px] text-cyan-400/70">
                      {centerPred.confidence != null ? (centerPred.confidence * 100).toFixed(0) : '—'}% conf
                    </span>
                  </div>
                  <div className="space-y-2">
                    {keyMetrics.map((metric) => {
                      const preds = centerPred.predictions[metric];
                      if (!preds) return null;
                      const short = preds['7d'];
                      const long = preds['180d'];
                      if (!short || short.val == null) return null;
                      const metricLabel = metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                      const shortLo = short.lo ?? short.val;
                      const shortHi = short.hi ?? short.val;
                      const range = shortHi - shortLo;
                      return (
                        <div key={metric} className="bg-white/5 rounded-lg px-3 py-2">
                          <div className="text-[9px] text-white/40 mb-1">{metricLabel}</div>
                          <div className="flex items-baseline gap-3">
                            <div>
                              <span className="text-sm font-medium text-white">{short.val.toFixed(1)}</span>
                              <span className="text-[9px] text-white/30 ml-1">7d</span>
                            </div>
                            {long && long.val != null && (
                              <div>
                                <span className="text-xs text-white/60">{long.val.toFixed(1)}</span>
                                <span className="text-[9px] text-white/30 ml-1">180d</span>
                              </div>
                            )}
                            <span className="ml-auto text-[9px] text-white/30 font-mono">{short.model}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-cyan-500/40 rounded-full" style={{ width: `${range > 0 ? Math.min(100, ((short.val - shortLo) / range) * 100) : 50}%` }} />
                            </div>
                            <span className="text-[8px] text-white/25">{shortLo.toFixed(1)}–{shortHi.toFixed(1)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── CARBON NEIGHBORHOOD 3×3 ─── */}
            {mlData && mlData.carbonNeighborSummary.total > 0 && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TreePine size={16} className="text-white/50" />
                  <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                    Carbon Neighborhood
                  </div>
                </div>

                {/* 3×3 grid visualization */}
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {(() => {
                    const neighbors = mlData.neighborhood.sort((a, b) =>
                      a.row === b.row ? a.col - b.col : a.row - b.row
                    );
                    return neighbors.map((n) => {
                      const carbonCell = mlData.carbon[n.grid_id];
                      const balance = carbonCell?.carbon_balance ?? null;
                      const bgColor = balance === null
                        ? 'bg-white/5'
                        : balance < -0.2
                          ? 'bg-red-500/30 border-red-500/40'
                          : balance > 0.2
                            ? 'bg-emerald-500/30 border-emerald-500/40'
                            : 'bg-yellow-500/20 border-yellow-500/30';
                      return (
                        <div
                          key={n.grid_id}
                          className={`aspect-square rounded-lg ${bgColor} border border-white/10 flex flex-col items-center justify-center p-1 ${n.is_center ? 'ring-1 ring-cyan-400/50' : ''}`}
                        >
                          <span className="text-[7px] text-white/40 font-mono">{n.grid_id.split('_').slice(-2).join('_')}</span>
                          {balance !== null && (
                            <>
                              <span className="text-[10px] font-medium text-white">{balance.toFixed(2)}</span>
                              <span className="text-[7px] text-white/40">{carbonCell?.category}</span>
                            </>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-red-500/10 rounded-lg px-2 py-1.5">
                    <div className="text-sm font-bold text-red-400">{mlData.carbonNeighborSummary.sinks}</div>
                    <div className="text-[8px] text-white/40">Sinks</div>
                  </div>
                  <div className="bg-yellow-500/10 rounded-lg px-2 py-1.5">
                    <div className="text-sm font-bold text-yellow-400">{mlData.carbonNeighborSummary.neutrals}</div>
                    <div className="text-[8px] text-white/40">Neutral</div>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg px-2 py-1.5">
                    <div className="text-sm font-bold text-emerald-400">{mlData.carbonNeighborSummary.sources}</div>
                    <div className="text-[8px] text-white/40">Sources</div>
                  </div>
                </div>
                {mlData.carbonNeighborSummary.avg_balance !== null && (
                  <div className="mt-2 text-center">
                    <span className="text-[10px] text-white/40">Avg Balance: </span>
                    <span className={`text-xs font-medium ${mlData.carbonNeighborSummary.avg_balance < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {mlData.carbonNeighborSummary.avg_balance.toFixed(3)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── ANOMALY BADGE ─── */}
            {mlData && Object.keys(mlData.anomalies).length > 0 && (() => {
              const centerAnomaly = mlData.anomalies[mlData.cellId];
              if (!centerAnomaly || !centerAnomaly.has_anomaly) return null;
              const sevColors: Record<string, string> = {
                critical: 'border-red-500/40 bg-red-500/10',
                high: 'border-orange-500/40 bg-orange-500/10',
                moderate: 'border-yellow-500/40 bg-yellow-500/10',
                low: 'border-white/20 bg-white/5',
              };
              const sevTextColors: Record<string, string> = {
                critical: 'text-red-400',
                high: 'text-orange-400',
                moderate: 'text-yellow-400',
                low: 'text-white/60',
              };
              return (
                <div className={`backdrop-blur-md border rounded-2xl p-4 ${sevColors[centerAnomaly.severity]}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Zap size={16} className={sevTextColors[centerAnomaly.severity]} />
                    <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                      Anomaly Detected
                    </div>
                    <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold ${sevTextColors[centerAnomaly.severity]} ${sevColors[centerAnomaly.severity]}`}>
                      {centerAnomaly.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed mb-2">{centerAnomaly.description}</p>
                  <div className="text-[10px] text-white/40 mb-1">Score: {centerAnomaly.anomaly_score != null ? (centerAnomaly.anomaly_score * 100).toFixed(0) : '—'}%</div>
                  <div className="space-y-1">
                    {Object.entries(centerAnomaly.metric_scores)
                      .filter(([, m]) => m.anomaly)
                      .map(([key, m]) => (
                        <div key={key} className="flex items-center gap-2 text-[10px]">
                          <span className="text-white/50 flex-1">{key.replace(/_/g, ' ')}</span>
                          <span className={m.direction === 'above' ? 'text-red-400' : 'text-blue-400'}>
                            {m.direction === 'above' ? '↑' : '↓'} z={m.z_score?.toFixed(1) ?? '—'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })()}

            {/* ── PRESCRIPTIONS ─── */}
            {mlData && mlData.prescriptions.length > 0 && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield size={16} className="text-white/50" />
                  <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                    Prescriptions
                  </div>
                  <span className="ml-auto text-[10px] text-white/30">{mlData.prescriptions.length} actions</span>
                </div>
                <div className="space-y-3">
                  {mlData.prescriptions.map((rx) => {
                    const prioColors: Record<string, string> = { P1: 'text-red-400', P2: 'text-orange-400', P3: 'text-yellow-400' };
                    return (
                      <div key={rx.prescription_id} className="bg-white/5 rounded-xl p-3">
                        <div className="flex items-start gap-2 mb-1">
                          <span className={`text-[10px] font-mono font-bold ${prioColors[rx.priority] || 'text-white/60'}`}>{rx.priority}</span>
                          <div className="flex-1">
                            <div className="text-[11px] text-white/80 font-medium leading-tight">{rx.rule_name}</div>
                            <p className="text-[10px] text-white/50 mt-0.5 leading-relaxed">{rx.action}</p>
                          </div>
                        </div>

                        {/* Source → Intervention → Receiver flow */}
                        <div className="flex items-center gap-1 mt-2 text-[9px] text-white/40 font-mono">
                          {rx.source_grid && (
                            <>
                              <span className="px-1.5 py-0.5 bg-emerald-500/15 rounded text-emerald-400">{rx.source_grid.split('_').slice(-2).join('_')}</span>
                              <span>→</span>
                            </>
                          )}
                          <span className="px-1.5 py-0.5 bg-cyan-500/15 rounded text-cyan-400">{rx.intervention_zone.split('_').slice(-2).join('_')}</span>
                          <span>→</span>
                          <span className="px-1.5 py-0.5 bg-red-500/15 rounded text-red-400">{rx.receiver_grid.split('_').slice(-2).join('_')}</span>
                        </div>

                        <div className="flex items-center gap-3 mt-2 text-[9px] text-white/30">
                          <span className="flex items-center gap-1"><Clock size={10} />{rx.timeline_months}mo</span>
                          <span>₹{rx.cost_estimate_inr != null ? (rx.cost_estimate_inr / 100000).toFixed(1) : '—'}L</span>
                          <span className="ml-auto">{rx.confidence != null ? (rx.confidence * 100).toFixed(0) : '—'}% conf</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DOWNLOAD REPORT BUTTON */}
      </div>
      <div className="flex-shrink-0 p-3 border-t border-white/10 bg-black/60 backdrop-blur-xl">
        <button
          onClick={handleDownloadReport}
          className="w-full bg-white/15 backdrop-blur-md border border-white/30 rounded-full px-5 py-3 flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform"
        >
          <FileDown size={18} className="text-white/80" />
          <span className="text-sm font-medium text-white/90">Download Report</span>
        </button>
      </div>

      {showReportToast && (
        <div className="absolute bottom-20 right-3 z-50 bg-white/15 backdrop-blur-md border border-white/30 rounded-xl px-4 py-3 text-sm text-white/80">
          Report generation in progress...
        </div>
      )}
    </div>
  );
}
