/** BHOOMI -- Script 03: 15-day Sentinel-5P column observations and AQI proxy. */

var START = ee.Date('2021-01-01');
var END = ee.Date('2026-01-01');
var WINDOW_DAYS = 15;
var GRID_METERS = 3000;
var UTM = ee.Projection('EPSG:32643');
var CITY_ID = 'GJ_AHM';
var studyArea = ee.Geometry.Rectangle([72.057, 22.544, 73.084, 23.502], null, false);

function buildGrid() {
  var bounds = studyArea.bounds(1, UTM), ring = ee.List(bounds.coordinates().get(0));
  var ll = ee.List(ring.get(0)), ur = ee.List(ring.get(2));
  var xMin = ee.Number(ll.get(0)), yMin = ee.Number(ll.get(1));
  var cols = ee.Number(ur.get(0)).subtract(xMin).divide(GRID_METERS).ceil();
  var rows = ee.Number(ur.get(1)).subtract(yMin).divide(GRID_METERS).ceil();
  return ee.FeatureCollection(ee.List.sequence(0, rows.subtract(1)).map(function(row) {
    row = ee.Number(row);
    return ee.List.sequence(0, cols.subtract(1)).map(function(col) {
      col = ee.Number(col);
      var cell = ee.Geometry.Rectangle([
        xMin.add(col.multiply(GRID_METERS)), yMin.add(row.multiply(GRID_METERS)),
        xMin.add(col.add(1).multiply(GRID_METERS)), yMin.add(row.add(1).multiply(GRID_METERS))
      ], UTM, false).intersection(studyArea, 1);
      var c = cell.centroid(1).transform('EPSG:4326', 1).coordinates();
      return ee.Feature(cell, {grid_id: ee.String(CITY_ID).cat('_R').cat(row.format('%03d')).cat('_C').cat(col.format('%03d')), row_idx: row, col_idx: col, centroid_lat: ee.Number(c.get(1)), centroid_lng: ee.Number(c.get(0))});
    });
  }).flatten());
}
var grids = buildGrid();

function meanColumn(collectionId, band, start, end, outputBand, molarMass, clipNegative) {
  var image = ee.ImageCollection(collectionId).filterBounds(studyArea).filterDate(start, end).select(band).mean();
  if (clipNegative) image = image.max(0);
  // mol m^-2 * g mol^-1 * 1e6 = micrograms m^-2. These are columns, not ug m^-3.
  return image.multiply(molarMass * 1e6).rename(outputBand);
}

var offsets = ee.List.sequence(0, END.difference(START, 'day').divide(WINDOW_DAYS).ceil().subtract(1));
var rawRecords = ee.FeatureCollection(offsets.map(function(offset) {
  var windowStart = START.advance(ee.Number(offset).multiply(WINDOW_DAYS), 'day');
  var windowEnd = ee.Date(ee.Number(windowStart.advance(WINDOW_DAYS, 'day').millis()).min(END.millis()));
  var no2 = meanColumn('COPERNICUS/S5P/OFFL/L3_NO2', 'tropospheric_NO2_column_number_density', windowStart, windowEnd, 'no2_column_ug_m2', 46.0055, false);
  var so2 = meanColumn('COPERNICUS/S5P/OFFL/L3_SO2', 'SO2_column_number_density', windowStart, windowEnd, 'so2_column_ug_m2', 64.066, true);
  var co = meanColumn('COPERNICUS/S5P/OFFL/L3_CO', 'CO_column_number_density', windowStart, windowEnd, 'co_column_ug_m2', 28.01, false);
  var combined = no2.addBands(so2).addBands(co);
  return combined.reduceRegions({collection: grids, reducer: ee.Reducer.mean(), scale: 1000, crs: 'EPSG:4326', tileScale: 4})
    .map(function(row) {
      return ee.Feature(null, {
        grid_id: row.get('grid_id'), row_idx: row.get('row_idx'), col_idx: row.get('col_idx'),
        centroid_lat: row.get('centroid_lat'), centroid_lng: row.get('centroid_lng'),
        captured_at: windowStart.format('YYYY-MM-dd'), window_end: windowEnd.format('YYYY-MM-dd'),
        year: windowStart.get('year'), no2_column_ug_m2: row.get('no2_column_ug_m2'),
        so2_column_ug_m2: row.get('so2_column_ug_m2'), co_column_ug_m2: row.get('co_column_ug_m2'),
        source: 'COPERNICUS/S5P/OFFL/L3_NO2;COPERNICUS/S5P/OFFL/L3_SO2;COPERNICUS/S5P/OFFL/L3_CO'
      });
    });
})).flatten().filter(ee.Filter.notNull(['no2_column_ug_m2', 'so2_column_ug_m2', 'co_column_ug_m2']));

// The proxy is relative to the full Ahmedabad 2021-2025 exported distribution, not CPCB AQI.
var no2P95 = ee.Number(rawRecords.reduceColumns(ee.Reducer.percentile([95]), ['no2_column_ug_m2']).get('p95'));
var so2P95 = ee.Number(rawRecords.reduceColumns(ee.Reducer.percentile([95]), ['so2_column_ug_m2']).get('p95'));
var coP95 = ee.Number(rawRecords.reduceColumns(ee.Reducer.percentile([95]), ['co_column_ug_m2']).get('p95'));
var records = rawRecords.map(function(row) {
  var ratio = ee.Number(row.get('no2_column_ug_m2')).divide(no2P95)
    .max(ee.Number(row.get('so2_column_ug_m2')).divide(so2P95))
    .max(ee.Number(row.get('co_column_ug_m2')).divide(coP95));
  return row.set({
    aqi_proxy: ratio.multiply(500).min(500),
    aqi_proxy_definition: '500*max(column_value/city_dataset_P95), capped at 500',
    data_quality: 1
  });
});

print('Pollution records after complete-observation filter', records.size());
print('City-dataset P95s in ug m^-2', {no2: no2P95, so2: so2P95, co: coP95});
print('Pollution sample', records.first());

var selectors = ['grid_id', 'row_idx', 'col_idx', 'centroid_lat', 'centroid_lng', 'captured_at', 'window_end', 'year', 'no2_column_ug_m2', 'so2_column_ug_m2', 'co_column_ug_m2', 'aqi_proxy', 'aqi_proxy_definition', 'data_quality', 'source'];
for (var year = 2021; year <= 2025; year++) {
  Export.table.toDrive({collection: records.filter(ee.Filter.eq('year', year)), description: 'bhoomi_pollution_ahmedabad_' + year, fileNamePrefix: 'bhoomi_pollution_ahmedabad_' + year, fileFormat: 'CSV', selectors: selectors});
}
