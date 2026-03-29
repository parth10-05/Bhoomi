/**
 * Minimal fallback adapter — returns empty data when the API server is unavailable.
 * All real data now comes from the API backed by final model outputs.
 */
import { SpatialDataSource } from '../types/domain';

export const staticAdapter: SpatialDataSource = {
    async fetchGrid() {
        console.warn('Static adapter: no grid data — start the API server');
        return [];
    },

    async fetchObservations() {
        return [];
    },

    async fetchTimeSeries() {
        return [];
    },

    async fetchMonths() {
        return [];
    },

    async fetchSummary() {
        return {
            total_cells: '0', avg_lst: '0', avg_ndvi: '0', avg_no2: '0',
            avg_soil_moisture: '0', avg_risk: '0', avg_rainfall: '0', avg_aqi: '0',
            avg_drought_risk: '0', avg_vhi: '0', critical_cells: '0', high_cells: '0',
            moderate_cells: '0', normal_cells: '0', max_lst: 0, min_ndvi: 0,
            max_no2: 0, min_soil_moisture: 0,
            trends: { lst_delta: null, ndvi_delta: null, risk_delta: null, aqi_delta: null },
        } as any;
    },

    async fetchAnomalies() {
        return [];
    },

    async fetchCityTimeSeries() {
        return [];
    },

    async fetchInsights() {
        return { drivers: [], recommendations: [], confidence: 0 };
    },

    async fetchMLNeighborhood() {
        return {
            cellId: '', row: 0, col: 0, neighborhood: [],
            predictions: {}, carbon: {}, carbonNeighborSummary: { total: 0, sources: 0, sinks: 0, neutrals: 0, avg_balance: null },
            anomalies: {}, prescriptions: [], reportContexts: {},
        } as any;
    },

    async fetchCarbonGrids() {
        return [];
    },

    async fetchCarbonSummary() {
        return {
            total_source_grids: 0, total_sink_grids: 0, total_neutral_grids: 0,
            avg_carbon_balance: 0, net_label: 'N/A',
            worst_source: { grid_id: '', carbon_balance: 0 },
            best_sink: { grid_id: '', carbon_balance: 0 },
            city_trend: 'N/A',
        };
    },

    async fetchEvalMetrics() {
        return { models: [], ensemble_performance: { overall_r2: 0, overall_mae: 0, overall_rmse: 0, overall_mape: 0 } };
    },
};
