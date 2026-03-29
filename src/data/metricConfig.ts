import { MetricKey, MetricMeta } from '../types/domain';

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  lst_mean: {
    key: 'lst_mean',
    label: 'Land Surface Temperature',
    unit: '°C',
    source: 'MODIS MOD11A2',
    min: 20,
    max: 55,
    colorRamp: ['#313695', '#4575b4', '#74add1', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    thresholds: {
      low: 28,
      moderate: 35,
      high: 42,
      critical: 48,
    },
  },

  ndvi_mean: {
    key: 'ndvi_mean',
    label: 'Vegetation Index',
    unit: 'index',
    source: 'Sentinel-2 SR',
    min: -0.2,
    max: 0.9,
    colorRamp: ['#8b0000', '#d73027', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641', '#004529'],
    thresholds: {
      low: 0.5,
      moderate: 0.3,
      high: 0.15,
      critical: 0.05,
    },
  },

  no2_ppb: {
    key: 'no2_ppb',
    label: 'Nitrogen Dioxide',
    unit: 'ppb',
    source: 'Sentinel-5P TROPOMI',
    min: 5,
    max: 150,
    colorRamp: ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#2c7fb8', '#253494', '#081d58'],
    thresholds: {
      low: 20,
      moderate: 40,
      high: 80,
      critical: 120,
    },
  },

  soil_moisture_am: {
    key: 'soil_moisture_am',
    label: 'Soil Moisture',
    unit: 'cm³/cm³',
    source: 'NASA SMAP SPL3SMP',
    min: 0.02,
    max: 0.45,
    colorRamp: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e', '#003c30'],
    thresholds: {
      low: 0.15,
      moderate: 0.1,
      high: 0.07,
      critical: 0.03,
    },
  },

  urban_fraction: {
    key: 'urban_fraction',
    label: 'Urban Land Cover',
    unit: 'fraction',
    source: 'MODIS MCD12Q1',
    min: 0,
    max: 1,
    colorRamp: ['#f7f7f7', '#cccccc', '#969696', '#636363', '#252525', '#000000', '#000000'],
    thresholds: {
      low: 0.3,
      moderate: 0.5,
      high: 0.7,
      critical: 0.85,
    },
  },

  aer_ai_mean: {
    key: 'aer_ai_mean',
    label: 'Aerosol Index',
    unit: 'index',
    source: 'Sentinel-5P TROPOMI',
    min: -1,
    max: 5,
    colorRamp: ['#ffffd4', '#fed98e', '#fe9929', '#d95f0e', '#993404', '#662200', '#330000'],
    thresholds: {
      low: 0.5,
      moderate: 1.0,
      high: 2.0,
      critical: 3.5,
    },
  },

  uhi_intensity: {
    key: 'uhi_intensity',
    label: 'Urban Heat Island',
    unit: '°C anomaly',
    source: 'MODIS LST derived',
    min: -3,
    max: 8,
    colorRamp: ['#2166ac', '#92c5de', '#f7f7f7', '#fdbf6f', '#e31a1c', '#b10026', '#67000d'],
    thresholds: {
      low: 1,
      moderate: 2.5,
      high: 4,
      critical: 6,
    },
  },

  green_fraction: {
    key: 'green_fraction',
    label: 'Green Cover',
    unit: 'fraction',
    source: 'Sentinel-2 NDVI>0.3',
    min: 0,
    max: 1,
    colorRamp: ['#8b0000', '#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#66bd63', '#1a9850'],
    thresholds: {
      low: 0.4,
      moderate: 0.25,
      high: 0.1,
      critical: 0.03,
    },
  },

  composite_risk: {
    key: 'composite_risk',
    label: 'Composite Risk',
    unit: 'score',
    source: 'ML Pipeline',
    min: 0,
    max: 1,
    colorRamp: ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027', '#a50026'],
    thresholds: {
      low: 0.25,
      moderate: 0.45,
      high: 0.65,
      critical: 0.85,
    },
  },

  aqi_proxy: {
    key: 'aqi_proxy',
    label: 'Air Quality Index',
    unit: 'AQI',
    source: 'Sentinel-5P derived',
    min: 0,
    max: 500,
    colorRamp: ['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023', '#4c0013'],
    thresholds: {
      low: 50,
      moderate: 100,
      high: 200,
      critical: 300,
    },
  },

  drought_risk: {
    key: 'drought_risk',
    label: 'Drought Risk',
    unit: 'index',
    source: 'SMAP + NDVI derived',
    min: 0,
    max: 1,
    colorRamp: ['#1a9850', '#66bd63', '#a6d96a', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    thresholds: {
      low: 0.2,
      moderate: 0.4,
      high: 0.6,
      critical: 0.8,
    },
  },

  rainfall_mm: {
    key: 'rainfall_mm',
    label: 'Rainfall',
    unit: 'mm',
    source: 'GPM IMERG',
    min: 0,
    max: 300,
    colorRamp: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08519c', '#08306b', '#041a3d'],
    thresholds: {
      low: 50,
      moderate: 100,
      high: 200,
      critical: 250,
    },
  },

  vhi: {
    key: 'vhi',
    label: 'Vegetation Health Index',
    unit: 'index',
    source: 'NDVI + LST derived',
    min: 0,
    max: 100,
    colorRamp: ['#a50026', '#d73027', '#f46d43', '#fee08b', '#a6d96a', '#1a9850', '#004529'],
    thresholds: {
      low: 60,
      moderate: 40,
      high: 20,
      critical: 10,
    },
  },

  temp_celsius: {
    key: 'temp_celsius',
    label: 'Temperature',
    unit: '°C',
    source: 'ERA5 Reanalysis',
    min: 10,
    max: 50,
    colorRamp: ['#313695', '#4575b4', '#74add1', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    thresholds: {
      low: 25,
      moderate: 32,
      high: 40,
      critical: 45,
    },
  },
};
