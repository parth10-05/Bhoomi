import {
  GridCell,
  CellObservation,
  SpatialDataSource,
  MetricKey,
  TimeSeriesPoint,
  CitySummary,
  AnomalyCell,
  CityTimeSeriesPoint,
  CellInsights,
  MLNeighborhood,
  CarbonGrid,
  CarbonCitySummary,
  EvalMetrics,
} from '../types/domain';

const BASE = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').trim().replace(/\/+$/, '');

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export const apiAdapter: SpatialDataSource = {
  async fetchGrid(cityKey: string): Promise<GridCell[]> {
    return apiFetch<GridCell[]>(`/api/v1/${cityKey}/grid`);
  },

  async fetchObservations(cityKey: string, date: string): Promise<CellObservation[]> {
    const month = date.length > 7 ? date.substring(0, 7) : date;
    return apiFetch<CellObservation[]>(`/api/v1/${cityKey}/observations?month=${month}`);
  },

  async fetchTimeSeries(
    cityKey: string,
    cellId: string,
    metric: MetricKey,
    months: number
  ): Promise<TimeSeriesPoint[]> {
    return apiFetch<TimeSeriesPoint[]>(
      `/api/v1/${cityKey}/timeseries/${cellId}/${metric}?months=${months}`
    );
  },

  async fetchMonths(cityKey: string): Promise<string[]> {
    return apiFetch<string[]>(`/api/v1/${cityKey}/months`);
  },

  async fetchSummary(cityKey: string, month: string): Promise<CitySummary> {
    return apiFetch<CitySummary>(`/api/v1/${cityKey}/summary?month=${month}`);
  },

  async fetchAnomalies(cityKey: string, month: string): Promise<AnomalyCell[]> {
    return apiFetch<AnomalyCell[]>(`/api/v1/${cityKey}/anomalies?month=${month}`);
  },

  async fetchCityTimeSeries(cityKey: string, metric: string): Promise<CityTimeSeriesPoint[]> {
    return apiFetch<CityTimeSeriesPoint[]>(`/api/v1/${cityKey}/city-timeseries/${metric}`);
  },

  async fetchInsights(cityKey: string, cellId: string, month: string): Promise<CellInsights> {
    return apiFetch<CellInsights>(`/api/v1/${cityKey}/insights/${cellId}?month=${month}`);
  },

  async fetchMLNeighborhood(cityKey: string, cellId: string): Promise<MLNeighborhood> {
    return apiFetch<MLNeighborhood>(`/api/v1/${cityKey}/ml/${cellId}`);
  },

  async fetchCarbonGrids(cityKey: string): Promise<CarbonGrid[]> {
    return apiFetch<CarbonGrid[]>(`/api/v1/${cityKey}/carbon-grids`);
  },

  async fetchCarbonSummary(cityKey: string): Promise<CarbonCitySummary> {
    return apiFetch<CarbonCitySummary>(`/api/v1/${cityKey}/carbon-summary`);
  },

  async fetchEvalMetrics(cityKey: string): Promise<EvalMetrics> {
    return apiFetch<EvalMetrics>(`/api/v1/${cityKey}/eval-metrics`);
  },
};
