export type MetricKey =
  | 'lst_mean'
  | 'ndvi_mean'
  | 'no2_ppb'
  | 'soil_moisture_am'
  | 'urban_fraction'
  | 'aer_ai_mean'
  | 'uhi_intensity'
  | 'green_fraction'
  | 'composite_risk'
  | 'aqi_proxy'
  | 'drought_risk'
  | 'rainfall_mm'
  | 'vhi'
  | 'temp_celsius';

export interface CellId {
  row: number;
  col: number;
  id: string;
}

export interface GridCell {
  id: string;
  row: number;
  col: number;
  centroid_lat: number;
  centroid_lng: number;
  bbox?: [number, number, number, number];
  altitude_m?: number | null;
  dominant_lulc?: string;
}

export interface CellObservation {
  cell_id: string;
  date: string;
  lst_mean: number;
  ndvi_mean: number;
  no2_ppb: number;
  soil_moisture_am: number;
  urban_fraction: number;
  aer_ai_mean: number;
  uhi_intensity: number;
  green_fraction: number;
  composite_risk: number;
  data_quality: number;
  // Extended DB fields
  so2_ugm3?: number;
  co_ugm3?: number;
  aqi_proxy?: number;
  vci?: number;
  tci?: number;
  vhi?: number;
  soil_moisture_deficit?: number;
  spi_30d?: number;
  rainfall_mm?: number;
  drought_risk?: number;
  wind_speed_ms?: number;
  wind_dir_deg?: number;
  temp_celsius?: number;
  dominant_class?: number;
  built_pct?: number;
  trees_pct?: number;
  crops_pct?: number;
  water_pct?: number;
  bare_pct?: number;
  rangeland_pct?: number;
}

export interface MetricMeta {
  key: MetricKey;
  label: string;
  unit: string;
  source: string;
  min: number;
  max: number;
  colorRamp: string[];
  thresholds: {
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
}

export interface AnomalyCell {
  cell_id: string;
  lat: number;
  lng: number;
  severity: 'moderate' | 'high' | 'critical';
  composite_risk: number;
  drivers: Array<{ metric: string; value: number; label: string }>;
}

export interface TimeSeriesPoint {
  month: string;
  value: number | null;
  cityAvg?: number | null;
  forecast: boolean;
}

export interface CityTimeSeriesPoint {
  month: string;
  avg: number;
  min: number;
  max: number;
  stddev: number;
  cellCount: number;
}

export interface CitySummary {
  total_cells: string;
  avg_lst: string;
  avg_ndvi: string;
  avg_no2: string;
  avg_soil_moisture: string;
  avg_risk: string;
  avg_rainfall: string;
  avg_aqi: string;
  avg_drought_risk: string;
  avg_vhi: string;
  critical_cells: string;
  high_cells: string;
  moderate_cells: string;
  normal_cells: string;
  max_lst: number;
  min_ndvi: number;
  max_no2: number;
  min_soil_moisture: number;
  trends: {
    lst_delta: string | null;
    ndvi_delta: string | null;
    risk_delta: string | null;
    aqi_delta: string | null;
  };
}

export interface InsightDriver {
  metric: string;
  severity: string;
  text: string;
  delta_mom?: string | null;
  delta_yoy?: string | null;
}

export interface InsightRecommendation {
  priority: number;
  text: string;
  impact: string;
}

export interface CellInsights {
  drivers: InsightDriver[];
  recommendations: InsightRecommendation[];
  confidence: number;
  cellData?: Record<string, number>;
}

export interface ActionRecommendation {
  priority: 1 | 2 | 3;
  metric: MetricKey;
  title: string;
  rationale: string;
  affected_cells: number;
}

// ── ML Pipeline Types ──────────────────────────────────────

export interface ForecastPoint {
  val: number;
  lo: number;
  hi: number;
  model: string;
}

export interface MLPredictionGrid {
  grid_id: string;
  centroid_lat: number;
  centroid_lng: number;
  confidence: number;
  predictions: Record<string, Record<string, ForecastPoint>>;
}

export interface PrescriptionEvidence {
  [key: string]: number | string | string[];
}

export interface PrescriptionImpact {
  [key: string]: string | number;
}

export interface Prescription {
  prescription_id: string;
  rule_id: string;
  rule_name: string;
  receiver_grid: string;
  source_grid: string | null;
  intervention_zone: string;
  priority: 'P1' | 'P2' | 'P3';
  action: string;
  rationale: string;
  evidence: PrescriptionEvidence;
  expected_impact: PrescriptionImpact;
  timeline_months: number;
  cost_estimate_inr: number;
  confidence: number;
}

export interface AnomalyMetricScore {
  value: number;
  z_score: number;
  anomaly: boolean;
  direction: 'above' | 'below';
  historical_mean: number;
  historical_std: number;
}

export interface MLAnomalyGrid {
  grid_id: string;
  has_anomaly: boolean;
  anomaly_score: number;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  description: string;
  metric_scores: Record<string, AnomalyMetricScore>;
}

export interface CarbonContributingFactors {
  [key: string]: number;
}

export interface CarbonGrid {
  grid_id: string;
  carbon_balance: number;
  label: string;
  category: 'source' | 'sink' | 'neutral';
  contributing_factors: CarbonContributingFactors;
  forecast_180d: { val: number; lo: number; hi: number; trend: string };
  dominant_lulc: string;
  ndvi: number;
  trees_pct: number;
}

export interface CarbonNeighborSummary {
  total: number;
  sources: number;
  sinks: number;
  neutrals: number;
  avg_balance: number | null;
}

export interface CarbonCitySummary {
  total_source_grids: number;
  total_sink_grids: number;
  total_neutral_grids: number;
  avg_carbon_balance: number;
  net_label: string;
  worst_source: { grid_id: string; carbon_balance: number };
  best_sink: { grid_id: string; carbon_balance: number };
  city_trend: string;
}

export interface NeighborCell {
  grid_id: string;
  row: number;
  col: number;
  centroid_lat: number;
  centroid_lng: number;
  is_center: boolean;
}

export interface ReportNeighbourhood {
  center: string;
  neighbors: string[];
  avg_neighbor_lst: number;
  avg_neighbor_ndvi: number;
  heat_gradient: string;
  pollution_gradient: string;
}

export interface ReportContextGrid {
  grid_id: string;
  rank: number;
  risk_score: number;
  current_values: Record<string, number>;
  factors: string[];
  human_summary: string;
  neighbourhood_3x3: ReportNeighbourhood;
}

export interface ModelPerformance {
  r2: number;
  mae: number;
  rmse: number;
  mape: number;
  training_samples?: number;
  test_samples?: number;
  cross_validation_folds?: number;
}

export interface EvalModel {
  model_id: string;
  model_name: string;
  version: string;
  metrics_covered: string[];
  performance: ModelPerformance;
  horizon_performance: Record<string, { r2: number; mae: number; rmse: number }>;
  notes: string;
}

export interface EvalMetrics {
  models: EvalModel[];
  ensemble_performance: {
    overall_r2: number;
    overall_mae: number;
    overall_rmse: number;
    overall_mape: number;
  };
}

export interface MLNeighborhood {
  cellId: string;
  row: number;
  col: number;
  neighborhood: NeighborCell[];
  predictions: Record<string, MLPredictionGrid>;
  carbon: Record<string, CarbonGrid>;
  carbonNeighborSummary: CarbonNeighborSummary;
  anomalies: Record<string, MLAnomalyGrid>;
  prescriptions: Prescription[];
  reportContexts: Record<string, ReportContextGrid>;
}

export interface DashboardState {
  activeMetric: MetricKey;
  selectedCellId: string | null;
  selectedDate: string;
  basemap: 'satellite' | 'dark' | 'light';
  activeLayer: 'heat' | 'pollution' | 'vegetation' | 'carbon' | null;
}

export interface SpatialDataSource {
  fetchGrid(cityKey: string): Promise<GridCell[]>;
  fetchObservations(cityKey: string, date: string): Promise<CellObservation[]>;
  fetchTimeSeries(
    cityKey: string,
    cellId: string,
    metric: MetricKey,
    months: number
  ): Promise<TimeSeriesPoint[]>;
  fetchMonths(cityKey: string): Promise<string[]>;
  fetchSummary(cityKey: string, month: string): Promise<CitySummary>;
  fetchAnomalies(cityKey: string, month: string): Promise<AnomalyCell[]>;
  fetchCityTimeSeries(cityKey: string, metric: string): Promise<CityTimeSeriesPoint[]>;
  fetchInsights(cityKey: string, cellId: string, month: string): Promise<CellInsights>;
  fetchMLNeighborhood(cityKey: string, cellId: string): Promise<MLNeighborhood>;
  fetchCarbonGrids(cityKey: string): Promise<CarbonGrid[]>;
  fetchCarbonSummary(cityKey: string): Promise<CarbonCitySummary>;
  fetchEvalMetrics(cityKey: string): Promise<EvalMetrics>;
}
