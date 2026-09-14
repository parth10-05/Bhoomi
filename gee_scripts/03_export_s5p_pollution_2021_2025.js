/** BHOOMI -- Script 03: 15-day Sentinel-5P column observations and AQI proxy. */

var START = ee.Date('2021-01-01');
var END = ee.Date('2026-01-01');
var WINDOW_DAYS = 15;
var CITY_CODE = 'GJ_AHM';
var CENTER_LON = 72.5714;
var CENTER_LAT = 23.0225;
var CELL_SIZE_M = 3000;
var BUFFER_M = 50000;
var UTM_43N = ee.Projection('EPSG:32643');
var centerPoint = ee.Geometry.Point([CENTER_LON, CENTER_LAT]);
var studyArea = centerPoint.buffer(BUFFER_M).bounds();

function buildGrid() {
  var rawGrid = studyArea.coveringGrid(UTM_43N, CELL_SIZE_M);
  var studyAreaUTM = studyArea.transform(UTM_43N, 1);
  var swCorner = ee.List(studyAreaUTM.coordinates().get(0)).get(0);
  var originX = ee.Number(ee.List(swCorner).get(0));
  var originY = ee.Number(ee.List(swCorner).get(1));
  return rawGrid.map(function(cell) {
      var centroidWGS = cell.geometry().centroid(1);
      var centroidUTM = centroidWGS.transform(UTM_43N, 1);
      var coords = centroidUTM.coordinates();
      var col = ee.Number(coords.get(0)).subtract(originX).divide(CELL_SIZE_M).floor().int();
      var row = ee.Number(coords.get(1)).subtract(originY).divide(CELL_SIZE_M).floor().int();
      var id = ee.String(CITY_CODE).cat('_R').cat(ee.String('00').cat(row.format('%d')).slice(-3)).cat('_C').cat(ee.String('00').cat(col.format('%d')).slice(-3));
      return cell.set({grid_id: id, row_idx: row, col_idx: col, centroid_lat: centroidWGS.coordinates().get(1), centroid_lng: centroidWGS.coordinates().get(0)});
    });
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
