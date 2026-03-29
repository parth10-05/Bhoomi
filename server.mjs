import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

const app = express();
app.use(cors());
app.use(express.json());

const ACTIVE_CONNECTION_STRING =
    process.env.CONNECTION_STRING || process.env.NEW_CONNECTION_STRING;

if (!ACTIVE_CONNECTION_STRING) {
    console.error('❌ NEW_CONNECTION_STRING or CONNECTION_STRING env variable is required');
    process.exit(1);
}

try {
    const dbUrl = new URL(ACTIVE_CONNECTION_STRING);
    console.log(`🗄 Using DB: ${dbUrl.hostname}${dbUrl.pathname}`);
} catch {
    console.log('🗄 Using DB from env connection string');
}

// DigitalOcean managed DBs use a self-signed CA — allow it
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
    connectionString: ACTIVE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
});

pool.on('connect', (client) => {
    client.query('SET search_path TO public').catch((err) => {
        console.warn('⚠ Failed to set search_path:', err.message);
    });
});

// ── LOAD ML PIPELINE SEED DATA ────────────────────────────
function loadJson(filename) {
    try {
        return JSON.parse(readFileSync(join(__dirname, 'inputs', filename), 'utf8'));
    } catch (e) {
        console.warn(`⚠ ML seed file ${filename} not found, using empty data`);
        return null;
    }
}

function loadFinalJson(filename) {
    try {
        const raw = readFileSync(join(__dirname, 'inputs', 'final_data', filename), 'utf8');
        // Handle NaN/Infinity values that Python may have written
        const sanitized = raw.replace(/\bNaN\b/g, 'null').replace(/\bInfinity\b/g, 'null').replace(/\b-Infinity\b/g, 'null');
        return JSON.parse(sanitized);
    } catch (e) {
        console.warn(`⚠ final_data/${filename} not found, falling back to inputs/`);
        return loadJson(filename);
    }
}

const mlPredictions = loadFinalJson('predictions_output.json');
const mlPrescriptions = loadFinalJson('prescriptions_output.json');
const mlAnomalies = loadFinalJson('anomalies_output.json');
const mlCarbon = loadFinalJson('carbon_output.json');
const mlReportCtx = loadJson('report_context.json');
const mlEvalMetrics = loadJson('eval_metrics.json');

// Index ML data by grid_id for O(1) lookup
const predByGrid = new Map();
if (mlPredictions?.grids) {
    for (const g of mlPredictions.grids) predByGrid.set(g.grid_id, g);
}
const anomalyByGrid = new Map();
if (mlAnomalies?.grids) {
    for (const g of mlAnomalies.grids) anomalyByGrid.set(g.grid_id, g);
}
const carbonByGrid = new Map();
if (mlCarbon?.grids) {
    for (const g of mlCarbon.grids) carbonByGrid.set(g.grid_id, g);
}
const reportByGrid = new Map();
if (mlReportCtx?.risk_grids) {
    for (const g of mlReportCtx.risk_grids) reportByGrid.set(g.grid_id, g);
}

// ── TRANSFORM FINAL DATA TO MATCH FRONTEND TYPES ──────────

// Carbon grids: derive category from label, flatten forecast, add defaults
if (mlCarbon?.grids) {
    for (const g of mlCarbon.grids) {
        if (g.label === 'carbon_source') g.category = 'source';
        else if (g.label === 'carbon_sink') g.category = 'sink';
        else g.category = 'neutral';

        if (g.forecast_180d?.carbon_balance) {
            const cb = g.forecast_180d.carbon_balance;
            g.forecast_180d = {
                val: cb.val, lo: cb.lo, hi: cb.hi,
                trend: cb.val < g.carbon_balance ? 'improving' : cb.val > g.carbon_balance ? 'worsening' : 'stable',
            };
        }

        if (!g.contributing_factors) g.contributing_factors = {};
        if (!g.dominant_lulc) g.dominant_lulc = 'unknown';
        if (g.ndvi == null) g.ndvi = 0;
        if (g.trees_pct == null) g.trees_pct = 0;
    }
    carbonByGrid.clear();
    for (const g of mlCarbon.grids) carbonByGrid.set(g.grid_id, g);
}

// Build proper CarbonCitySummary from grid data
if (mlCarbon?.grids) {
    const cGrids = mlCarbon.grids;
    const sources = cGrids.filter(g => g.category === 'source');
    const sinks = cGrids.filter(g => g.category === 'sink');
    const neutrals = cGrids.filter(g => g.category === 'neutral');
    const allBal = cGrids.map(g => g.carbon_balance);
    const avgBal = allBal.length > 0 ? allBal.reduce((a, b) => a + b, 0) / allBal.length : 0;
    const worstSrc = sources.length > 0
        ? sources.reduce((mx, g) => g.carbon_balance > mx.carbon_balance ? g : mx, sources[0])
        : { grid_id: 'N/A', carbon_balance: 0 };
    const bestSnk = sinks.length > 0
        ? sinks.reduce((mn, g) => g.carbon_balance < mn.carbon_balance ? g : mn, sinks[0])
        : { grid_id: 'N/A', carbon_balance: 0 };
    mlCarbon.summary = {
        total_source_grids: sources.length,
        total_sink_grids: sinks.length,
        total_neutral_grids: neutrals.length,
        avg_carbon_balance: +avgBal.toFixed(4),
        net_label: avgBal < -0.05 ? 'Net Sink' : avgBal > 0.05 ? 'Net Source' : 'Near Neutral',
        worst_source: { grid_id: worstSrc.grid_id, carbon_balance: worstSrc.carbon_balance },
        best_sink: { grid_id: bestSnk.grid_id, carbon_balance: bestSnk.carbon_balance },
        city_trend: 'stable',
    };
}

// Anomaly grids: normalize metric_scores to AnomalyMetricScore shape
if (mlAnomalies?.grids) {
    for (const g of mlAnomalies.grids) {
        if (g.anomaly_severity && !g.severity) g.severity = g.anomaly_severity;
        if (g.metric_scores) {
            const transformed = {};
            for (const [metric, score] of Object.entries(g.metric_scores)) {
                if (typeof score === 'number') {
                    transformed[metric] = {
                        value: score,
                        z_score: score,
                        anomaly: Math.abs(score) > 0.005,
                        direction: score >= 0 ? 'above' : 'below',
                        historical_mean: 0,
                        historical_std: 1,
                    };
                } else {
                    transformed[metric] = score;
                }
            }
            g.metric_scores = transformed;
        }
    }
    anomalyByGrid.clear();
    for (const g of mlAnomalies.grids) anomalyByGrid.set(g.grid_id, g);
}

// Prediction grids: compute confidence from prediction intervals
if (mlPredictions?.grids) {
    for (const g of mlPredictions.grids) {
        if (g.confidence == null) {
            let totalConf = 0, count = 0;
            for (const metricPreds of Object.values(g.predictions || {})) {
                for (const h of Object.values(metricPreds)) {
                    if (h.val != null && h.lo != null && h.hi != null) {
                        const range = Math.abs(h.hi - h.lo);
                        const relRange = range / (Math.abs(h.val) || 1);
                        totalConf += Math.max(0, 1 - relRange);
                        count++;
                    }
                }
            }
            g.confidence = count > 0 ? +(totalConf / count).toFixed(3) : 0.5;
        }
    }
    predByGrid.clear();
    for (const g of mlPredictions.grids) predByGrid.set(g.grid_id, g);
}

console.log(`📊 ML final data loaded — predictions: ${predByGrid.size}, anomalies: ${anomalyByGrid.size}, carbon: ${carbonByGrid.size}, report: ${reportByGrid.size} grids`);

// ── CITY KEY MAPPING ──────────────────────────────────────
const CITY_MAP = {
    AHM: 'GJ_AHM',
    SRT: 'GJ_SRT',
    VDR: 'GJ_VDR',
};

function dbCityId(cityKey) {
    return CITY_MAP[cityKey] || cityKey;
}

// ── GET /api/v1/:city/grid ────────────────────────────────
// Returns all grid cells for a city
app.get('/api/v1/:city/grid', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const result = await pool.query(
            `SELECT grid_id, row_idx, col_idx, centroid_lat, centroid_lng, altitude_m, dominant_lulc
       FROM grids WHERE city_id = $1
       ORDER BY row_idx, col_idx`,
            [cityId]
        );
        const cells = result.rows.map((r) => ({
            id: r.grid_id,
            row: r.row_idx,
            col: r.col_idx,
            centroid_lat: r.centroid_lat,
            centroid_lng: r.centroid_lng,
            altitude_m: r.altitude_m,
            dominant_lulc: r.dominant_lulc,
        }));
        res.json(cells);
    } catch (err) {
        console.error('Grid error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/observations?month=YYYY-MM ──────────
// Returns observations for all grid cells for a given month
app.get('/api/v1/:city/observations', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const month = req.query.month || req.query.date;
        if (!month) {
            return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
        }
        // Normalize: if date is YYYY-MM-DD, extract YYYY-MM
        const monthKey = month.length > 7 ? month.substring(0, 7) : month;

        const result = await pool.query(
            `SELECT o.*
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = $1 AND o.month_key = $2`,
            [cityId, monthKey]
        );

        // Map DB columns to frontend CellObservation shape
        const observations = result.rows.map((r) => ({
            cell_id: r.grid_id,
            date: r.month_key,
            lst_mean: r.lst_celsius,
            ndvi_mean: r.ndvi,
            no2_ppb: r.no2_ugm3,   // labeled as ppb in UI but stored as ugm3
            soil_moisture_am: r.soil_moisture,
            urban_fraction: (r.built_pct || 0) / 100,
            aer_ai_mean: r.aqi_proxy != null ? r.aqi_proxy / 100 : 0,
            uhi_intensity: r.lst_celsius - (r.temp_celsius || r.lst_celsius),
            green_fraction: ((r.trees_pct || 0) + (r.crops_pct || 0) + (r.rangeland_pct || 0)) / 100,
            composite_risk: r.composite_risk != null ? r.composite_risk * 10 : 0,
            data_quality: r.lst_data_quality_mean || 0.9,
            // Extended fields from DB
            so2_ugm3: r.so2_ugm3,
            co_ugm3: r.co_ugm3,
            aqi_proxy: r.aqi_proxy,
            vci: r.vci,
            tci: r.tci,
            vhi: r.vhi,
            soil_moisture_deficit: r.soil_moisture_deficit,
            spi_30d: r.spi_30d,
            rainfall_mm: r.rainfall_mm,
            drought_risk: r.drought_risk,
            wind_speed_ms: r.wind_speed_ms,
            wind_dir_deg: r.wind_dir_deg,
            temp_celsius: r.temp_celsius,
            dominant_class: r.dominant_class,
            built_pct: r.built_pct,
            trees_pct: r.trees_pct,
            crops_pct: r.crops_pct,
            water_pct: r.water_pct,
            bare_pct: r.bare_pct,
            rangeland_pct: r.rangeland_pct,
        }));

        res.json(observations);
    } catch (err) {
        console.error('Observations error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/timeseries/:cellId/:metric ──────────
// Returns monthly time series for a specific cell and metric
app.get('/api/v1/:city/timeseries/:cellId/:metric', async (req, res) => {
    try {
        const { cellId, metric } = req.params;
        const months = parseInt(req.query.months) || 60;

        // Map frontend metric keys to DB columns
        const METRIC_COL_MAP = {
            lst_mean: 'lst_celsius',
            ndvi_mean: 'ndvi',
            no2_ppb: 'no2_ugm3',
            soil_moisture_am: 'soil_moisture',
            urban_fraction: 'built_pct',
            aer_ai_mean: 'aqi_proxy',
            uhi_intensity: 'lst_celsius - temp_celsius',
            green_fraction: '(trees_pct + crops_pct + rangeland_pct) / 100.0',
            composite_risk: 'composite_risk',
            // Direct DB columns
            vci: 'vci',
            tci: 'tci',
            vhi: 'vhi',
            drought_risk: 'drought_risk',
            rainfall_mm: 'rainfall_mm',
            spi_30d: 'spi_30d',
            temp_celsius: 'temp_celsius',
            wind_speed_ms: 'wind_speed_ms',
            so2_ugm3: 'so2_ugm3',
            co_ugm3: 'co_ugm3',
            aqi_proxy: 'aqi_proxy',
        };

        const col = METRIC_COL_MAP[metric];
        if (!col) {
            return res.status(400).json({ error: `Unknown metric: ${metric}` });
        }

        const result = await pool.query(
            `SELECT month_key, ${col} as value
       FROM grid_obs_monthly
       WHERE grid_id = $1
       ORDER BY month_key DESC
       LIMIT $2`,
            [cellId, months]
        );

        // Reverse to chronological order and compute city average for comparison
        const avgResult = await pool.query(
            `SELECT o.month_key, AVG(${col}) as avg_value
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = (SELECT city_id FROM grids WHERE grid_id = $1)
       AND o.month_key IN (SELECT month_key FROM grid_obs_monthly WHERE grid_id = $1 ORDER BY month_key DESC LIMIT $2)
       GROUP BY o.month_key
       ORDER BY o.month_key`,
            [cellId, months]
        );

        const avgMap = {};
        avgResult.rows.forEach((r) => {
            avgMap[r.month_key] = parseFloat(r.avg_value);
        });

        const series = result.rows.reverse().map((r) => ({
            month: r.month_key,
            value: r.value != null ? parseFloat(r.value) : null,
            cityAvg: avgMap[r.month_key] || null,
            forecast: false,
        }));

        res.json(series);
    } catch (err) {
        console.error('Timeseries error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/summary?month=YYYY-MM ──────────────
// Returns city-wide summary stats for dashboard header chips
app.get('/api/v1/:city/summary', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const month = (req.query.month || req.query.date || '').substring(0, 7);
        if (!month) {
            return res.status(400).json({ error: 'month required' });
        }

        const result = await pool.query(
            `SELECT
         COUNT(*) as total_cells,
         ROUND(AVG(lst_celsius)::numeric, 2) as avg_lst,
         ROUND(AVG(ndvi)::numeric, 4) as avg_ndvi,
         ROUND(AVG(no2_ugm3)::numeric, 2) as avg_no2,
         ROUND(AVG(soil_moisture)::numeric, 4) as avg_soil_moisture,
         ROUND(AVG(composite_risk)::numeric, 4) as avg_risk,
         ROUND(AVG(rainfall_mm)::numeric, 2) as avg_rainfall,
         ROUND(AVG(aqi_proxy)::numeric, 0) as avg_aqi,
         ROUND(AVG(drought_risk)::numeric, 4) as avg_drought_risk,
         ROUND(AVG(vhi)::numeric, 4) as avg_vhi,
         SUM(CASE WHEN composite_risk >= 0.7 THEN 1 ELSE 0 END) as critical_cells,
         SUM(CASE WHEN composite_risk >= 0.5 AND composite_risk < 0.7 THEN 1 ELSE 0 END) as high_cells,
         SUM(CASE WHEN composite_risk >= 0.3 AND composite_risk < 0.5 THEN 1 ELSE 0 END) as moderate_cells,
         SUM(CASE WHEN composite_risk < 0.3 THEN 1 ELSE 0 END) as normal_cells,
         MAX(lst_celsius) as max_lst,
         MIN(ndvi) as min_ndvi,
         MAX(no2_ugm3) as max_no2,
         MIN(soil_moisture) as min_soil_moisture
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = $1 AND o.month_key = $2`,
            [cityId, month]
        );

        // Get previous month for trend comparison
        const [y, m] = month.split('-').map(Number);
        const prevDate = new Date(y, m - 2, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

        const prevResult = await pool.query(
            `SELECT
         ROUND(AVG(lst_celsius)::numeric, 2) as avg_lst,
         ROUND(AVG(ndvi)::numeric, 4) as avg_ndvi,
         ROUND(AVG(composite_risk)::numeric, 4) as avg_risk,
         ROUND(AVG(aqi_proxy)::numeric, 0) as avg_aqi
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = $1 AND o.month_key = $2`,
            [cityId, prevMonth]
        );

        const current = result.rows[0];
        const prev = prevResult.rows[0];

        res.json({
            ...current,
            trends: {
                lst_delta: prev.avg_lst ? (parseFloat(current.avg_lst) - parseFloat(prev.avg_lst)).toFixed(2) : null,
                ndvi_delta: prev.avg_ndvi ? (parseFloat(current.avg_ndvi) - parseFloat(prev.avg_ndvi)).toFixed(4) : null,
                risk_delta: prev.avg_risk ? (parseFloat(current.avg_risk) - parseFloat(prev.avg_risk)).toFixed(4) : null,
                aqi_delta: prev.avg_aqi ? (parseFloat(current.avg_aqi) - parseFloat(prev.avg_aqi)).toFixed(0) : null,
            },
        });
    } catch (err) {
        console.error('Summary error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/anomalies?month=YYYY-MM ────────────
// Returns cells with critical/high composite risk
app.get('/api/v1/:city/anomalies', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const month = (req.query.month || req.query.date || '').substring(0, 7);
        if (!month) {
            return res.status(400).json({ error: 'month required' });
        }

        const result = await pool.query(
            `SELECT o.grid_id, g.centroid_lat, g.centroid_lng, o.composite_risk,
              o.lst_celsius, o.ndvi, o.no2_ugm3, o.aqi_proxy, o.drought_risk,
              o.vhi, o.soil_moisture
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = $1 AND o.month_key = $2 AND o.composite_risk >= 0.5
       ORDER BY o.composite_risk DESC
       LIMIT 50`,
            [cityId, month]
        );

        const anomalies = result.rows.map((r) => {
            let severity = 'moderate';
            if (r.composite_risk >= 0.7) severity = 'critical';
            else if (r.composite_risk >= 0.5) severity = 'high';

            // Determine primary driver
            const drivers = [];
            if (r.lst_celsius > 40) drivers.push({ metric: 'LST', value: r.lst_celsius, label: `${r.lst_celsius.toFixed(1)}°C` });
            if (r.ndvi < 0.15) drivers.push({ metric: 'NDVI', value: r.ndvi, label: r.ndvi.toFixed(3) });
            if (r.no2_ugm3 > 80) drivers.push({ metric: 'NO₂', value: r.no2_ugm3, label: `${r.no2_ugm3.toFixed(0)} µg/m³` });
            if (r.aqi_proxy > 200) drivers.push({ metric: 'AQI', value: r.aqi_proxy, label: `${r.aqi_proxy}` });
            if (r.drought_risk > 0.6) drivers.push({ metric: 'Drought', value: r.drought_risk, label: `${(r.drought_risk * 100).toFixed(0)}%` });
            if (r.vhi < 0.3) drivers.push({ metric: 'VHI', value: r.vhi, label: r.vhi.toFixed(3) });

            return {
                cell_id: r.grid_id,
                lat: r.centroid_lat,
                lng: r.centroid_lng,
                severity,
                composite_risk: r.composite_risk,
                drivers,
            };
        });

        res.json(anomalies);
    } catch (err) {
        console.error('Anomalies error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/months ──────────────────────────────
// Returns available months for the timeline slider
app.get('/api/v1/:city/months', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const result = await pool.query(
            `SELECT DISTINCT o.month_key
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = $1
       ORDER BY o.month_key`,
            [cityId]
        );
        res.json(result.rows.map((r) => r.month_key));
    } catch (err) {
        console.error('Months error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/lulc?year=YYYY ──────────────────────
// Returns LULC snapshot for a specific year
app.get('/api/v1/:city/lulc', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const year = parseInt(req.query.year) || 2024;
        const result = await pool.query(
            `SELECT l.*, g.centroid_lat, g.centroid_lng, g.row_idx, g.col_idx
       FROM lulc_snapshots l
       JOIN grids g ON l.grid_id = g.grid_id
       WHERE g.city_id = $1 AND l.snapshot_year = $2`,
            [cityId, year]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('LULC error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/city-timeseries/:metric ─────────────
// Returns city-wide average time series for a metric (for BottomTimeline)
app.get('/api/v1/:city/city-timeseries/:metric', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const { metric } = req.params;

        const METRIC_COL_MAP = {
            lst_mean: 'lst_celsius',
            ndvi_mean: 'ndvi',
            no2_ppb: 'no2_ugm3',
            soil_moisture_am: 'soil_moisture',
            composite_risk: 'composite_risk',
            aqi_proxy: 'aqi_proxy',
            drought_risk: 'drought_risk',
            rainfall_mm: 'rainfall_mm',
            vhi: 'vhi',
            temp_celsius: 'temp_celsius',
        };

        const col = METRIC_COL_MAP[metric] || 'composite_risk';

        const result = await pool.query(
            `SELECT o.month_key,
              ROUND(AVG(${col})::numeric, 4) as avg_value,
              ROUND(MIN(${col})::numeric, 4) as min_value,
              ROUND(MAX(${col})::numeric, 4) as max_value,
              ROUND(STDDEV(${col})::numeric, 4) as stddev_value,
              COUNT(*) as cell_count
       FROM grid_obs_monthly o
       JOIN grids g ON o.grid_id = g.grid_id
       WHERE g.city_id = $1
       GROUP BY o.month_key
       ORDER BY o.month_key`,
            [cityId]
        );

        res.json(
            result.rows.map((r) => ({
                month: r.month_key,
                avg: parseFloat(r.avg_value),
                min: parseFloat(r.min_value),
                max: parseFloat(r.max_value),
                stddev: parseFloat(r.stddev_value),
                cellCount: parseInt(r.cell_count),
            }))
        );
    } catch (err) {
        console.error('City timeseries error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/:city/insights/:cellId?month=YYYY-MM ──────
// Returns AI-style insights for a specific cell
app.get('/api/v1/:city/insights/:cellId', async (req, res) => {
    try {
        const { cellId } = req.params;
        const month = (req.query.month || '').substring(0, 7);
        if (!month) {
            return res.status(400).json({ error: 'month required' });
        }

        // Current month data
        const current = await pool.query(
            `SELECT * FROM grid_obs_monthly WHERE grid_id = $1 AND month_key = $2`,
            [cellId, month]
        );
        if (current.rows.length === 0) {
            return res.json({ drivers: [], recommendations: [], confidence: 0 });
        }

        const obs = current.rows[0];

        // Previous month for comparison
        const [y, m] = month.split('-').map(Number);
        const prevDate = new Date(y, m - 2, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

        const prev = await pool.query(
            `SELECT * FROM grid_obs_monthly WHERE grid_id = $1 AND month_key = $2`,
            [cellId, prevMonth]
        );
        const prevObs = prev.rows[0] || {};

        // Year-over-year comparison
        const yoyMonth = `${y - 1}-${String(m).padStart(2, '0')}`;
        const yoy = await pool.query(
            `SELECT * FROM grid_obs_monthly WHERE grid_id = $1 AND month_key = $2`,
            [cellId, yoyMonth]
        );
        const yoyObs = yoy.rows[0] || {};

        // Generate rule-based insights
        const drivers = [];
        const recommendations = [];

        // Temperature analysis
        if (obs.lst_celsius > 40) {
            drivers.push({
                metric: 'LST',
                severity: obs.lst_celsius > 48 ? 'critical' : 'high',
                text: `Land surface temperature is ${obs.lst_celsius.toFixed(1)}°C — ${obs.lst_celsius > 48 ? 'extremely' : 'significantly'} elevated`,
                delta_mom: prevObs.lst_celsius ? (obs.lst_celsius - prevObs.lst_celsius).toFixed(1) : null,
                delta_yoy: yoyObs.lst_celsius ? (obs.lst_celsius - yoyObs.lst_celsius).toFixed(1) : null,
            });
            recommendations.push({
                priority: 1,
                text: 'Deploy reflective roofing materials and increase tree canopy cover',
                impact: 'Could reduce LST by 2-4°C within 2 years',
            });
        }

        // Vegetation analysis
        if (obs.ndvi < 0.2) {
            drivers.push({
                metric: 'NDVI',
                severity: obs.ndvi < 0.05 ? 'critical' : obs.ndvi < 0.15 ? 'high' : 'moderate',
                text: `Vegetation index at ${obs.ndvi.toFixed(3)} — ${obs.ndvi < 0.05 ? 'near-barren' : 'severely degraded'}`,
                delta_mom: prevObs.ndvi ? (obs.ndvi - prevObs.ndvi).toFixed(4) : null,
                delta_yoy: yoyObs.ndvi ? (obs.ndvi - yoyObs.ndvi).toFixed(4) : null,
            });
            recommendations.push({
                priority: 1,
                text: 'Initiate native tree plantation drive — target 30% green cover',
                impact: 'Expected to improve NDVI by 0.1-0.15 within 18 months',
            });
        }

        // Air quality analysis
        if (obs.aqi_proxy > 200) {
            drivers.push({
                metric: 'AQI',
                severity: obs.aqi_proxy > 300 ? 'critical' : 'high',
                text: `Air Quality Index at ${obs.aqi_proxy} — ${obs.aqi_proxy > 300 ? 'hazardous' : 'very unhealthy'} levels`,
                delta_mom: prevObs.aqi_proxy ? (obs.aqi_proxy - prevObs.aqi_proxy).toString() : null,
                delta_yoy: yoyObs.aqi_proxy ? (obs.aqi_proxy - yoyObs.aqi_proxy).toString() : null,
            });
            recommendations.push({
                priority: 1,
                text: 'Enforce emission controls and establish low-emission zones',
                impact: 'Could improve AQI by 20-40 points within 6 months',
            });
        }

        // Drought analysis
        if (obs.drought_risk > 0.5) {
            drivers.push({
                metric: 'Drought',
                severity: obs.drought_risk > 0.7 ? 'critical' : 'high',
                text: `Drought risk at ${(obs.drought_risk * 100).toFixed(0)}% — ${obs.drought_risk > 0.7 ? 'severe' : 'significant'} water stress`,
                delta_mom: prevObs.drought_risk ? ((obs.drought_risk - prevObs.drought_risk) * 100).toFixed(0) : null,
            });
            recommendations.push({
                priority: 2,
                text: 'Implement rainwater harvesting and drip irrigation systems',
                impact: 'Could reduce drought risk by 15-25% within 1 year',
            });
        }

        // Soil moisture
        if (obs.soil_moisture < 0.1) {
            drivers.push({
                metric: 'Soil',
                severity: obs.soil_moisture < 0.05 ? 'critical' : 'high',
                text: `Soil moisture at ${obs.soil_moisture.toFixed(3)} cm³/cm³ — critically low`,
            });
        }

        // Built-up expansion
        if (obs.built_pct > 60) {
            drivers.push({
                metric: 'Urban',
                severity: obs.built_pct > 80 ? 'critical' : 'moderate',
                text: `Built-up area at ${obs.built_pct.toFixed(1)}% — high impervious surface`,
            });
            recommendations.push({
                priority: 3,
                text: 'Mandate green building codes and permeable pavement in new construction',
                impact: 'Reduces heat island effect and improves stormwater management',
            });
        }

        // VHI analysis
        if (obs.vhi < 0.3) {
            drivers.push({
                metric: 'VHI',
                severity: obs.vhi < 0.15 ? 'critical' : 'high',
                text: `Vegetation Health Index at ${obs.vhi.toFixed(3)} — vegetation under severe stress`,
            });
        }

        const confidence = Math.min(
            0.95,
            0.5 + drivers.length * 0.1 + (obs.lst_data_quality_mean || 0) * 0.2
        );

        res.json({
            drivers,
            recommendations,
            confidence: Math.round(confidence * 100) / 100,
            cellData: {
                lst: obs.lst_celsius,
                ndvi: obs.ndvi,
                aqi: obs.aqi_proxy,
                soil_moisture: obs.soil_moisture,
                drought_risk: obs.drought_risk,
                vhi: obs.vhi,
                built_pct: obs.built_pct,
                trees_pct: obs.trees_pct,
                composite_risk: obs.composite_risk,
                rainfall_mm: obs.rainfall_mm,
                wind_speed_ms: obs.wind_speed_ms,
                temp_celsius: obs.temp_celsius,
            },
        });
    } catch (err) {
        console.error('Insights error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── ML NEIGHBORHOOD ENDPOINT (grid-staged) ───────────────
// GET /api/v1/:city/ml/:cellId
// Returns ML predictions, prescriptions, anomalies, carbon & report context
// for the selected cell + its 8 adjacent neighbors (3×3 grid)
app.get('/api/v1/:city/ml/:cellId', async (req, res) => {
    try {
        const cityId = dbCityId(req.params.city);
        const cellId = req.params.cellId;

        // 1. Get target cell's row/col from DB
        const cellRes = await pool.query(
            `SELECT row_idx, col_idx FROM grids WHERE grid_id = $1 AND city_id = $2`,
            [cellId, cityId]
        );
        if (cellRes.rows.length === 0) {
            return res.status(404).json({ error: `Grid ${cellId} not found` });
        }
        const { row_idx, col_idx } = cellRes.rows[0];

        // 2. Get 3×3 neighborhood grid IDs
        const neighborRes = await pool.query(
            `SELECT grid_id, row_idx, col_idx, centroid_lat, centroid_lng
             FROM grids
             WHERE city_id = $1
               AND row_idx BETWEEN $2 AND $3
               AND col_idx BETWEEN $4 AND $5
             ORDER BY row_idx, col_idx`,
            [cityId, row_idx - 1, row_idx + 1, col_idx - 1, col_idx + 1]
        );
        const neighborIds = neighborRes.rows.map(r => r.grid_id);

        // 3. Gather ML data for all neighborhood grids
        const predictions = {};
        const carbon = {};
        const anomalies = {};
        const reportContexts = {};

        for (const gid of neighborIds) {
            if (predByGrid.has(gid)) predictions[gid] = predByGrid.get(gid);
            if (carbonByGrid.has(gid)) carbon[gid] = carbonByGrid.get(gid);
            if (anomalyByGrid.has(gid)) anomalies[gid] = anomalyByGrid.get(gid);
            if (reportByGrid.has(gid)) reportContexts[gid] = reportByGrid.get(gid);
        }

        // 4. Filter prescriptions involving any grid in the neighborhood
        const prescriptions = [];
        if (mlPrescriptions?.prescriptions) {
            for (const rx of mlPrescriptions.prescriptions) {
                if (
                    neighborIds.includes(rx.receiver_grid) ||
                    neighborIds.includes(rx.source_grid) ||
                    neighborIds.includes(rx.intervention_zone)
                ) {
                    prescriptions.push(rx);
                }
            }
        }

        // 5. Build carbon summary for the 3×3 neighborhood
        const carbonEntries = Object.values(carbon);
        const carbonNeighborSummary = {
            total: carbonEntries.length,
            sources: carbonEntries.filter(c => c.category === 'source').length,
            sinks: carbonEntries.filter(c => c.category === 'sink').length,
            neutrals: carbonEntries.filter(c => c.category === 'neutral').length,
            avg_balance: carbonEntries.length > 0
                ? +(carbonEntries.reduce((s, c) => s + c.carbon_balance, 0) / carbonEntries.length).toFixed(3)
                : null,
        };

        res.json({
            cellId,
            row: row_idx,
            col: col_idx,
            neighborhood: neighborRes.rows.map(r => ({
                grid_id: r.grid_id,
                row: r.row_idx,
                col: r.col_idx,
                centroid_lat: +r.centroid_lat,
                centroid_lng: +r.centroid_lng,
                is_center: r.grid_id === cellId,
            })),
            predictions,
            carbon,
            carbonNeighborSummary,
            anomalies,
            prescriptions,
            reportContexts,
        });
    } catch (err) {
        console.error('ML neighborhood error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── CARBON GRIDS ENDPOINT (all grids for map layer) ─────
app.get('/api/v1/:city/carbon-grids', (req, res) => {
    if (!mlCarbon?.grids) {
        return res.json([]);
    }
    res.json(mlCarbon.grids);
});

// ── CARBON SUMMARY ENDPOINT ──────────────────────────────
app.get('/api/v1/:city/carbon-summary', (req, res) => {
    if (!mlCarbon?.summary) {
        return res.status(404).json({ error: 'Carbon summary not available' });
    }
    res.json(mlCarbon.summary);
});

// ── EVAL METRICS ENDPOINT ────────────────────────────────
app.get('/api/v1/:city/eval-metrics', (req, res) => {
    if (!mlEvalMetrics) {
        return res.status(404).json({ error: 'Evaluation metrics not available' });
    }
    res.json(mlEvalMetrics);
});

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', db: err.message });
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🌍 BHOOMI API server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Grid:         http://localhost:${PORT}/api/v1/AHM/grid`);
    console.log(`   Observations: http://localhost:${PORT}/api/v1/AHM/observations?month=2025-01`);
    console.log(`   ML:           http://localhost:${PORT}/api/v1/AHM/ml/GJ_AHM_R010_C010`);
    console.log(`   Carbon:       http://localhost:${PORT}/api/v1/AHM/carbon-summary`);
    console.log(`   EvalMetrics:  http://localhost:${PORT}/api/v1/AHM/eval-metrics`);
});
